// Legacy Sidearm box score template (about half of D1 tenants in 2026): server-rendered captioned
// tables instead of the embedded __NUXT_DATA__ game object. Captions: "Team Score By Period",
// "Scoring Summary", "Cautions and Ejections", "Team Statistics", "<Team> - Player Stats",
// "<Team> - Goalie Statistics".
import * as cheerio from 'cheerio';
import type { BoxScore, BoxScoreTeam, GameEvent, PlayerStatLine, SiteContext, TeamStatLine, EventType } from '../../../model.js';
import { EMPTY_PLAYER_LINE, EMPTY_TEAM_LINE } from '../../../model.js';
import { splitName } from '../../../normalize/names.js';
import { int } from '../../../normalize/num.js';
import { clockToSeconds, minutesFromClock } from '../../../normalize/clock.js';
import { normalizePosition } from '../../../normalize/position.js';
import { teamKey } from '../../../normalize/teamIdentity.js';

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

interface Table { caption: string; rows: string[][] }

function tables($: cheerio.CheerioAPI): Table[] {
  const out: Table[] = [];
  $('table').each((_, t) => {
    const caption = collapse($(t).find('caption').first().text());
    const rows: string[][] = [];
    $(t).find('tr').each((__, tr) => { const cells = $(tr).find('th,td').map((___, c) => collapse($(c).text())).get(); if (cells.length) rows.push(cells); });
    out.push({ caption, rows });
  });
  return out;
}

export function looksLikeLegacyBoxScore(html: string): boolean {
  return /<caption[^>]*>\s*Team Score By Period/i.test(html) && /Player Stats\s*<\/caption>/i.test(html);
}

/** Parse a legacy Sidearm box score page. `date` must be supplied by the caller (schedule) when the page lacks it. */
export function parseLegacyBoxScore(html: string, url: string, ctx: SiteContext, hint: { date?: string | null } = {}): BoxScore {
  const $ = cheerio.load(html);
  const tabs = tables($);
  const byCap = (re: RegExp) => tabs.find((t) => re.test(t.caption));
  const score = byCap(/team score by period/i);
  if (!score) throw new Error(`Legacy Sidearm box score: no score table at ${url}`);

  // Rows: [name(+abbr), p1, p2, ..., total]; first data row is the visiting team, second the home team.
  const teamRows = score.rows.slice(1).filter((r) => r.length >= 3);
  if (teamRows.length < 2) throw new Error(`Legacy Sidearm box score: unexpected score table at ${url}`);
  const nameOf = (cell: string) => collapse(cell.replace(/^winner\s*/i, ''));
  const abbrOf = (cell: string) => { const parts = nameOf(cell).split(' '); return parts.length > 1 ? parts[parts.length - 1]! : parts[0]!; };
  const teamName = (cell: string) => { const n = nameOf(cell); const a = abbrOf(cell); return n.endsWith(` ${a}`) ? n.slice(0, -a.length - 1) : n; };
  const away = { name: teamName(teamRows[0]![0]!), abbr: abbrOf(teamRows[0]![0]!), score: int(teamRows[0]![teamRows[0]!.length - 1]) };
  const home = { name: teamName(teamRows[1]![0]!), abbr: abbrOf(teamRows[1]![0]!), score: int(teamRows[1]![teamRows[1]!.length - 1]) };
  const periods = Math.max(1, teamRows[0]!.length - 2);
  const overtime = periods > 2;

  // Team statistics: "Statistic | 1 | 2 | T" with stat-name rows followed by one row per team (abbr first cell).
  const team = byCap(/team statistics/i);
  const totals: Record<string, TeamStatLine> = { [away.abbr]: EMPTY_TEAM_LINE(), [home.abbr]: EMPTY_TEAM_LINE() };
  const sideOf = (label: string): 'home' | 'away' | null => {
    const k = teamKey(label);
    if (!k) return null;
    if (k === teamKey(home.abbr) || k === teamKey(home.name) || teamKey(home.name).includes(k)) return 'home';
    if (k === teamKey(away.abbr) || k === teamKey(away.name) || teamKey(away.name).includes(k)) return 'away';
    return null;
  };
  const totalsFor = (side: 'home' | 'away') => totals[side === 'home' ? home.abbr : away.abbr]!;
  if (team) {
    let stat = '';
    for (const r of team.rows.slice(1)) {
      if (r.length === 1) { stat = r[0]!.toLowerCase(); continue; }
      const side = sideOf(r[0]!); if (!side) continue;
      const t = totalsFor(side);
      const total = r[r.length - 1]!;
      const m = total.match(/^(\d+)\s*(?:\((\d+)\))?/);
      const n = m ? Number(m[1]) : int(total);
      const paren = m?.[2] != null ? Number(m[2]) : null;
      if (stat.startsWith('shots')) { t.shots = n; if (paren != null) t.sog = paren; }
      else if (stat.startsWith('saves')) t.saves = n;
      else if (stat.startsWith('corner')) t.corners = n;
      else if (stat.startsWith('fouls')) t.fouls = n;
      else if (stat.startsWith('offside')) t.offsides = n;
      else if (stat.startsWith('penalty')) { if (paren != null) t.pkAttempts = paren; t.pkGoals = n; }
      // per-period lines
      const per = r.slice(1, -1).map((x) => int(x.match(/^\d+/)?.[0] ?? x));
      per.forEach((v, i) => { let pl = t.periodLines.find((p) => p.period === i + 1); if (!pl) { pl = { period: i + 1, score: null, shots: null, saves: null, fouls: null, corners: null, offsides: null }; t.periodLines.push(pl); } if (stat.startsWith('shots')) pl.shots = v; else if (stat.startsWith('saves')) pl.saves = v; else if (stat.startsWith('corner')) pl.corners = v; else if (stat.startsWith('fouls')) pl.fouls = v; else if (stat.startsWith('offside')) pl.offsides = v; });
    }
  }
  for (const [side, row] of [['away', teamRows[0]!], ['home', teamRows[1]!]] as const) {
    const t = totalsFor(side); t.goals = int(row[row.length - 1]);
    row.slice(1, -1).forEach((v, i) => { let pl = t.periodLines.find((p) => p.period === i + 1); if (!pl) { pl = { period: i + 1, score: null, shots: null, saves: null, fouls: null, corners: null, offsides: null }; t.periodLines.push(pl); } pl.score = int(v); });
    t.periodLines.sort((a, b) => a.period - b.period);
  }

  // Player tables: "<Team> - Player Stats" then "<Team> - Goalie Statistics".
  const players: Record<'home' | 'away', PlayerStatLine[]> = { home: [], away: [] };
  for (const t of tabs.filter((x) => /player stats/i.test(x.caption))) {
    const side = sideOf(t.caption.replace(/\s*-\s*player stats.*$/i, ''));
    if (!side) continue;
    let starter = false;
    for (const r of t.rows.slice(1)) {
      if (r.length === 1) { starter = /starter/i.test(r[0]!); continue; }
      if (r.length < 8) continue;
      const [pos, num, name, sh, sog, g, a, min] = r as [string, string, string, string, string, string, string, string];
      const cleanName = collapse(name.replace(/^\d+\s+/, ''));
      if (!cleanName || /^totals?$/i.test(cleanName) || /^team$/i.test(cleanName)) continue;
      const { firstName, lastName } = splitName(cleanName);
      const jersey = int(num);
      const line = EMPTY_PLAYER_LINE(`${lastName}|${firstName}|${jersey ?? ''}`.toLowerCase(), firstName, lastName);
      line.jersey = jersey; line.position = normalizePosition(pos) ?? (pos || null); line.starter = starter;
      line.shots = int(sh); line.sog = int(sog); line.goals = int(g); line.assists = int(a); line.minutes = int(min);
      line.points = line.goals != null || line.assists != null ? (line.goals ?? 0) * 2 + (line.assists ?? 0) : null;
      line.shotsOffTarget = line.shots != null && line.sog != null ? line.shots - line.sog : null;
      line.participated = (line.minutes ?? 0) > 0 || starter;
      line.isGoalie = /^gk/i.test(pos);
      players[side].push(line);
    }
  }
  for (const t of tabs.filter((x) => /goalie statistics/i.test(x.caption))) {
    const side = sideOf(t.caption.replace(/\s*-\s*goalie statistics.*$/i, ''));
    if (!side) continue;
    for (const r of t.rows.slice(1)) {
      if (r.length < 6 || /^totals?$/i.test(r[2] ?? '')) continue;
      const [, num, name, min, ga, sv] = r as [string, string, string, string, string, string];
      const { firstName, lastName } = splitName(collapse(name));
      const jersey = int(num);
      let line = players[side].find((p) => p.jersey === jersey && p.lastName.toLowerCase() === lastName.toLowerCase());
      if (!line) { line = EMPTY_PLAYER_LINE(`${lastName}|${firstName}|${jersey ?? ''}`.toLowerCase(), firstName, lastName); line.jersey = jersey; line.position = 'GK'; players[side].push(line); }
      line.isGoalie = true; line.gkMinutes = minutesFromClock(min); line.goalsAllowed = int(ga); line.saves = int(sv);
      if (line.minutes == null) line.minutes = line.gkMinutes;
      line.participated = true;
    }
    const t2 = totalsFor(side);
    const gks = players[side].filter((p) => p.isGoalie);
    t2.gkGoalsAllowed = gks.reduce((s, p) => s + (p.goalsAllowed ?? 0), 0);
    t2.gkSaves = gks.reduce((s, p) => s + (p.saves ?? 0), 0);
    t2.gkMinutes = gks.reduce((s, p) => s + (p.gkMinutes ?? 0), 0) || null;
  }

  // Events: scoring summary + cautions. Descriptions read like "Jessica Black (1) GOAL by Navy ... Assisted by X".
  const events: GameEvent[] = [];
  let seq = 0; let hs = 0; let as = 0;
  const periodOf = (clock: string) => { const s = clockToSeconds(clock) ?? 0; return s > 90 * 60 ? 3 + Math.floor((s - 90 * 60) / (10 * 60)) : s > 45 * 60 ? 2 : 1; };
  const scoring = byCap(/scoring summary/i);
  for (const r of scoring?.rows.slice(1) ?? []) {
    const [clock, teamLabel, desc] = r as [string, string, string];
    const side = sideOf(teamLabel);
    if (side === 'home') hs += 1; else if (side === 'away') as += 1;
    let scorer: string | null = desc.match(/^([^()]+?)\s*\(\d+\)/)?.[1] ?? desc.match(/GOAL by \w+\s+([A-Za-z'.-]+,\s*[A-Za-z'.-]+)/i)?.[1] ?? null;
    if (!scorer && side) { const hit = players[side].find((p) => p.lastName && new RegExp(`\\b${p.lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(desc)); if (hit) scorer = `${hit.firstName} ${hit.lastName}`; }
    const assist = desc.match(/Assist(?:ed)?\s*(?:by)?:?\s*([A-Za-z'.-]+(?:\s+[A-Za-z'.-]+)?)/i)?.[1] ?? null;
    events.push({ period: periodOf(clock), clock, clockSeconds: clockToSeconds(clock), seq: ++seq, side, type: 'goal', playerNameRaw: scorer ? collapse(scorer) : null, assistNameRaw: assist ? collapse(assist.replace(/\s*\(\d+\)\s*$/, '')) : null, homeScore: hs, awayScore: as, text: desc });
    if (scorer && side) { const s = splitName(collapse(scorer)); const p = players[side].find((x) => x.lastName.toLowerCase() === s.lastName.toLowerCase()); if (p && (p.goals ?? 0) === 0 && (p.goals === null)) p.goals = 1; }
  }
  const cautions = byCap(/cautions/i);
  for (const r of cautions?.rows.slice(1) ?? []) {
    const cells = r.filter((c) => c !== '');
    if (cells.length < 3) continue;
    const [clock, teamLabel, ...rest] = cells as [string, string, ...string[]];
    const player = rest[rest.length - 1]!;
    const typeText = rest.slice(0, -1).join(' ').toLowerCase() + ' ' + (r[0] ?? '').toLowerCase();
    const type: EventType = /red|ejection/.test(typeText) ? 'red' : 'yellow';
    const side = sideOf(teamLabel);
    const name = collapse(player.replace(/^#?\d+\s*/, ''));
    events.push({ period: periodOf(clock), clock, clockSeconds: clockToSeconds(clock), seq: ++seq, side, type, playerNameRaw: name, assistNameRaw: null, homeScore: null, awayScore: null, text: `${type} card ${name}` });
    if (side) { const s = splitName(name); const p = players[side].find((x) => x.lastName.toLowerCase() === s.lastName.toLowerCase()); if (p) { if (type === 'red') p.red = (p.red ?? 0) + 1; else p.yellow = (p.yellow ?? 0) + 1; } }
  }
  for (const side of ['home', 'away'] as const) { const t = totalsFor(side); t.yellow = players[side].reduce((s, p) => s + (p.yellow ?? 0), 0); t.red = players[side].reduce((s, p) => s + (p.red ?? 0), 0); t.assists = players[side].reduce((s, p) => s + (p.assists ?? 0), 0); }
  events.sort((a, b) => (a.clockSeconds ?? 0) - (b.clockSeconds ?? 0)).forEach((e, i) => { e.seq = i + 1; });

  const header = collapse($('body').text());
  const dateFromPage = header.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  const date = hint.date ?? (dateFromPage ? `${dateFromPage[3]}-${dateFromPage[1]!.padStart(2, '0')}-${dateFromPage[2]!.padStart(2, '0')}` : new Date().toISOString().slice(0, 10));
  const att = header.match(/Attendance:?\s*([\d,]+)/i);
  const mk = (side: 'home' | 'away'): BoxScoreTeam => ({ name: side === 'home' ? home.name : away.name, sourceTeamId: side === 'home' ? home.abbr : away.abbr, ncaaSeo: null, isHome: side === 'home', score: side === 'home' ? home.score : away.score, record: null, totals: totalsFor(side), players: players[side] });
  return {
    source: 'sidearm', sourceUrl: url, date, startTimeLocal: null, status: 'final', venueName: null, venueCity: null, attendance: att ? int(att[1]!.replace(/,/g, '')) : null,
    officials: [], neutral: false, conferenceGame: false, postseason: false, tournament: null, overtime, shootout: false, durationMin: null, periods,
    home: mk('home'), away: mk('away'), events, ncaaContestId: null,
  };
  void ctx;
}
