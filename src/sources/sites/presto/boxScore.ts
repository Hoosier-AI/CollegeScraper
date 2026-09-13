// Presto box score parser (`/boxscores/<id>.xml?view=plays`): line score, per-team player and goalie
// tables, per-period team stat boxes, the Game Information block and the play-by-play tables.
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { EMPTY_PLAYER_LINE, EMPTY_TEAM_LINE, type BoxScore, type BoxScoreTeam, type EventType, type GameEvent, type PlayerStatLine } from '../../../model.js';
import { clockToSeconds, minutesFromClock } from '../../../normalize/clock.js';
import { nameKey, splitName, stripDiacritics } from '../../../normalize/names.js';
import { int } from '../../../normalize/num.js';
import { normalizePosition } from '../../../normalize/position.js';
import { teamKey } from '../../../normalize/teamIdentity.js';
import { allTables, colIndex, normHeader, parseDateText, playerKey, to24h, txt, ws, type ParsedTable } from './util.js';

type Side = 'home' | 'away';

interface TeamCtx {
  side: Side;
  name: string;
  aliases: Set<string>;
  logo: string | null;
  team: BoxScoreTeam;
}

const norm = (s: string) => stripDiacritics(ws(s)).toLowerCase().replace(/[^a-z0-9]/g, '');

function nameParts(raw: string): { first: string; last: string } {
  const { firstName, lastName } = splitName(raw.replace(/\s*\(.*?\)\s*$/, ''));
  return { first: firstName, last: lastName };
}

/**
 * Loose player match for play-by-play names, which differ from the box tables
 * ("Torres, Christian" vs "Cristian Torres", "Marin, Santiago" vs "Santiago Marin Gutierrez",
 * "Toftevaag, Herman" vs "Herman Toftevåg"): same first initial and last names equal, nested, or
 * sharing their first four letters.
 */
function looseMatch(a: { first: string; last: string }, b: { first: string; last: string }): boolean {
  const al = norm(a.last);
  const bl = norm(b.last);
  if (!al || !bl) return false;
  const af = norm(a.first);
  const bf = norm(b.first);
  if (af && bf && af[0] !== bf[0]) return false;
  if (al === bl) return true;
  if (al.includes(bl) || bl.includes(al)) return true;
  return al.length >= 4 && bl.length >= 4 && al.slice(0, 4) === bl.slice(0, 4);
}

function findPlayer(team: TeamCtx, raw: string): PlayerStatLine | null {
  const p = nameParts(raw);
  const exact = team.team.players.find((x) => nameKey(x.firstName, x.lastName) === nameKey(p.first, p.last));
  if (exact) return exact;
  const loose = team.team.players.filter((x) => looseMatch({ first: x.firstName, last: x.lastName }, p));
  return loose.length === 1 ? loose[0]! : null;
}

function addAlias(t: TeamCtx, s: string | null | undefined) {
  const n = norm(s ?? '');
  if (n) t.aliases.add(n);
}

function sideOf(teams: TeamCtx[], token: string | null | undefined): Side | null {
  const n = norm(token ?? '');
  if (!n) return null;
  const direct = teams.filter((t) => t.aliases.has(n));
  if (direct.length === 1) return direct[0]!.side;
  // Abbreviation heuristics: "UALB" → "ualbany".
  const pre = teams.filter((t) => [...t.aliases].some((a) => a.startsWith(n) || n.startsWith(a)));
  if (pre.length === 1) return pre[0]!.side;
  return null;
}

const ABBR = /^[A-Z][A-Z0-9&.'-]{1,7}$/;

/** "UALB Bruce, William" → { abbr: "UALB", rest: "Bruce, William" } when the first token is an all-caps code. */
function splitAbbr(s: string): { abbr: string | null; rest: string } {
  const m = ws(s).match(/^(\S+)\s+(.*)$/);
  if (m && ABBR.test(m[1]!) && m[1]!.toUpperCase() === m[1]) return { abbr: m[1]!, rest: ws(m[2]) };
  return { abbr: null, rest: ws(s) };
}

const DESCRIPTORS = /^(out|saved|save|blocked|wide|high|top|bottom|left|right|center|centre|woodwork|post|crossbar|hit|over|under|deflected|goal|header|volley|penalty|pk|free kick|corner|rebound|missed|on target|off target|low|far|near|upper|lower|unassisted|assist)/i;

/** Presto prints names "Last, First" in the play text; keep the first two comma pieces when the second looks like a first name. */
function leadingName(s: string): { name: string; tail: string } {
  const pieces = ws(s).split(/\s*,\s*/);
  const p0 = pieces[0] ?? '';
  const p1 = pieces[1];
  if (p1 && !DESCRIPTORS.test(p1) && /^[A-Za-zÀ-ž'.\- ]+$/.test(p1) && p1.split(' ').length <= 3) {
    return { name: `${p0}, ${p1}`.replace(/\.$/, ''), tail: pieces.slice(2).join(', ') };
  }
  return { name: p0.replace(/\.$/, ''), tail: pieces.slice(1).join(', ') };
}

interface RawEvent {
  period: number;
  clock: string | null;
  type: EventType;
  abbr: string | null;
  teamToken: string | null;
  player: string | null;
  assist: string | null;
  score: [number, number] | null;
  text: string;
  cls: string;
}

function periodFromLabel(label: string): number | null {
  const s = ws(label).toLowerCase();
  let m = s.match(/^(\d+)(?:st|nd|rd|th)?(?:\s+(?:period|half))?$/);
  if (m) return Number(m[1]);
  m = s.match(/^(?:(\d+)(?:st|nd|rd|th)?\s*)?(?:ot|overtime)\s*(\d+)?$/);
  if (m) return 2 + Number(m[1] ?? m[2] ?? 1);
  if (/^(first|1st) half$/.test(s)) return 1;
  if (/^(second|2nd) half$/.test(s)) return 2;
  return null;
}

function classify(play: string, cls: string): Omit<RawEvent, 'period' | 'clock' | 'text' | 'cls'> {
  const base = { abbr: null as string | null, teamToken: null as string | null, player: null as string | null, assist: null as string | null, score: null as [number, number] | null };
  let text = ws(play).replace(/^(Substitution|Goal|Foul|Shot|Save|Card)!\s*/i, '');
  let m: RegExpMatchArray | null;

  if ((m = text.match(/^(.+?)\s+at goalie for\s+(.+?)\.?$/i))) {
    return { ...base, type: 'goalie_change', player: ws(m[1]), teamToken: ws(m[2]) };
  }
  if ((m = text.match(/^GOAL by\s+(.+)$/i))) {
    let rest = ws(m[1]);
    let score: [number, number] | null = null;
    const sm = rest.match(/\(\s*(\d+)\s*-\s*(\d+)\s*\)\s*$/);
    if (sm) {
      score = [Number(sm[1]), Number(sm[2])];
      rest = ws(rest.slice(0, sm.index));
    }
    let assist: string | null = null;
    const am = rest.match(/\bAssist(?:ed)? by\s+(.+?)\.?$/i);
    if (am) {
      assist = ws(am[1]).replace(/\.$/, '');
      rest = ws(rest.slice(0, am.index));
    }
    const { abbr, rest: r2 } = splitAbbr(rest);
    const { name } = leadingName(r2.replace(/\s*\((?:penalty kick|pk|unassisted|header|own goal)[^)]*\)\s*/gi, '').replace(/,\s*unassisted\.?$/i, ''));
    return { ...base, type: 'goal', abbr, player: name || null, assist, score };
  }
  if ((m = text.match(/^Shot by\s+(.+)$/i))) {
    const { abbr, rest } = splitAbbr(ws(m[1]));
    const { name } = leadingName(rest);
    return { ...base, type: /penalty kick|\bPK\b/i.test(text) ? 'pk' : 'shot', abbr, player: name || null };
  }
  if ((m = text.match(/^Save(?:d)? by\s+(.+)$/i))) {
    const { abbr, rest } = splitAbbr(ws(m[1]));
    const { name } = leadingName(rest);
    return { ...base, type: 'save', abbr, player: name || null };
  }
  if ((m = text.match(/^(Yellow|Red|Green) card\s+(?:on|to|-|for)?\s*(.+?)\.?$/i))) {
    const color = m[1]!.toLowerCase() as 'yellow' | 'red' | 'green';
    const { abbr, rest } = splitAbbr(ws(m[2]));
    const { name } = leadingName(rest);
    return { ...base, type: color, abbr, player: name || null };
  }
  if ((m = text.match(/^Foul (?:on|by)\s+(.+?)\.?$/i))) {
    const { abbr, rest } = splitAbbr(ws(m[1]));
    const { name } = leadingName(rest);
    return { ...base, type: 'foul', abbr, player: name || null };
  }
  if ((m = text.match(/^Corner kick(?:\s+by\s+(.+?))?(?:\s*\[[^\]]*\])?\.?$/i))) {
    if (m[1]) {
      const { abbr, rest } = splitAbbr(ws(m[1]));
      const { name } = leadingName(rest);
      return { ...base, type: 'corner', abbr, player: name || null };
    }
    return { ...base, type: 'corner' };
  }
  if ((m = text.match(/^Offside(?:s)?\s+(?:against|on|by)\s+(.+?)\.?$/i))) {
    const { abbr, rest } = splitAbbr(ws(m[1]));
    return { ...base, type: 'offside', abbr, teamToken: abbr ? null : rest || null };
  }
  if ((m = text.match(/^(?:(\S+)\s+)?substitution:\s*(.+?)\s+for\s+(.+?)\.?$/i))) {
    const abbr = m[1] && ABBR.test(m[1]) ? m[1] : null;
    return { ...base, type: 'sub_in', abbr, player: ws(m[2]), assist: ws(m[3]) /* assist slot carries the player going out */ };
  }
  if ((m = text.match(/^(?:(\S+)\s+)?Sub (in|out)[:\s]+(.+?)\.?$/i))) {
    const abbr = m[1] && ABBR.test(m[1]) ? m[1] : null;
    return { ...base, type: m[2]!.toLowerCase() === 'in' ? 'sub_in' : 'sub_out', abbr, player: ws(m[3]) };
  }
  if (/penalty kick/i.test(text)) {
    return { ...base, type: 'pk' };
  }
  if (/\bsubstitut/i.test(cls) || /\bsubstitution\b/i.test(text)) return { ...base, type: 'other' };
  return { ...base, type: 'other' };
}

function lineScore($: CheerioAPI, tables: ParsedTable[]): { rows: { name: string; scores: (number | null)[]; total: number | null; link: string | null }[]; periods: number } | null {
  const t = tables.find((x) => x.rows.length >= 2 && x.rows.every((r) => $(r.el).find('td.score, .score').length > 0)) ?? tables.find((x) => $(x.el).closest('.linescore').length > 0);
  if (!t) return null;
  const $t = $(t.el);
  const headTr = $t.find('tr').first();
  const heads = headTr
    .children('th, td')
    .toArray()
    .map((c) => ws($(c).text()));
  const periodHeads = heads.slice(1).filter((h) => !/^(t|total|f|final)$/i.test(h));
  const rows = t.rows
    .filter((r) => r.el !== headTr.get(0))
    .map((r) => {
      const nameCell = r.cells[0]!;
      const link = $(nameCell).find('a[href]').first().attr('href') ?? null;
      const nums = r.texts.slice(1).map((x) => int(x));
      const totalCell = $(r.el).find('.total').last();
      const total = totalCell.length ? int(ws(totalCell.text())) : nums[nums.length - 1] ?? null;
      const scores = totalCell.length ? nums.slice(0, -1) : nums;
      return { name: ws(r.texts[0]), scores, total, link };
    })
    .filter((r) => r.name);
  return { rows, periods: Math.max(periodHeads.length, 2) };
}

function playerFromCell($: CheerioAPI, cell: AnyNode): { position: string | null; jersey: number | null; name: string; cards: { color: 'yellow' | 'red' | 'green'; time: string | null }[] } | null {
  const C = $(cell);
  const cards: { color: 'yellow' | 'red' | 'green'; time: string | null }[] = [];
  C.find('.penalty-card').each((_, pc) => {
    const cls = ($(pc).attr('class') ?? '').toLowerCase();
    const t = ws($(pc).text());
    const color: 'yellow' | 'red' | 'green' | null = /red/.test(cls) || /red card/i.test(t) ? 'red' : /green/.test(cls) || /green card/i.test(t) ? 'green' : /yellow/.test(cls) || /yellow card/i.test(t) ? 'yellow' : null;
    if (!color) return;
    const time = ws($(pc).find('.time').text()) || (t.match(/(\d{1,3}:\d{2})/)?.[1] ?? null);
    cards.push({ color, time: time || null });
  });
  const pos = ws(C.find('.position').first().text()) || null;
  const uni = ws(C.find('.uniform').first().text());
  const nameEl = C.find('.player-name').first();
  let name = ws(nameEl.text());
  let jersey = uni ? int(uni.replace(/[^\d]/g, '')) : null;
  if (!name) {
    const clone = C.clone();
    clone.find('.penalty-card-list, .penalty-card, .position, .uniform').remove();
    let t = ws(clone.text());
    const m = t.match(/^(?:(gk|g|d|def|m|mid|f|fwd|tm)\s+)?#?(\d{1,2})\s*[-–]?\s+(.+)$/i);
    if (m) {
      jersey = jersey ?? Number(m[2]);
      t = ws(m[3]);
    }
    name = t;
  }
  name = name.replace(/\s*\(.*?\)\s*$/, '').trim();
  if (!name) return null;
  return { position: pos, jersey, name, cards };
}

const TEAM_ROW = /^(team|tm|totals?)$/i;

export function parseBoxScore(html: string, sourceUrl: string): BoxScore {
  const $ = cheerio.load(html);
  const article = $('article.game-boxscore, .game-boxscore, main, body').first();
  const tables = allTables($, article);

  // ---- teams & scores ---------------------------------------------------------------------
  const ls = lineScore($, tables);
  const visitorDiv = $('.team.visitor, .team.away').first();
  const homeDiv = $('.team.home').first();
  const h1Spans = $('h1')
    .first()
    .children('span')
    .toArray()
    .map((s) => ws($(s).text()));
  const h1Text = ws($('h1').first().text());
  let awayName = ls?.rows[0]?.name ?? '';
  let homeName = ls?.rows[1]?.name ?? '';
  if ((!awayName || !homeName) && h1Spans.length >= 3) {
    awayName = awayName || h1Spans[0]!;
    homeName = homeName || h1Spans[2]!;
  }
  if (!awayName || !homeName) {
    const m = h1Text.match(/^(.+?)\s+(?:at|vs\.?)\s+(.+?)(?:\s+[A-Z][a-z]+ \d{1,2}, \d{4})?$/);
    if (m) {
      awayName = awayName || ws(m[1]);
      homeName = homeName || ws(m[2]);
    }
  }
  const neutral = /\bvs\.?\b/i.test(h1Spans[1] ?? '') || (!/\bat\b/i.test(h1Text) && /\bvs\.?\b/i.test(h1Text));

  const mkTeam = (side: Side, name: string): TeamCtx => ({
    side,
    name,
    aliases: new Set<string>(),
    logo: null,
    team: { name, sourceTeamId: null, ncaaSeo: null, isHome: side === 'home', score: null, record: null, totals: EMPTY_TEAM_LINE(), players: [] },
  });
  const away = mkTeam('away', awayName);
  const home = mkTeam('home', homeName);
  const teams = [away, home];
  addAlias(away, awayName);
  addAlias(home, homeName);

  const recordOf = (div: Cheerio<AnyNode>): string | null => {
    const r = ws(div.find('.team-record').first().text()).replace(/[()]/g, '');
    const m = r.match(/(\d+-\d+(?:-\d+)?)/);
    return m ? m[1]! : null;
  };
  away.team.record = recordOf(visitorDiv);
  home.team.record = recordOf(homeDiv);
  away.logo = visitorDiv.find('img[src]').first().attr('src') ?? null;
  home.logo = homeDiv.find('img[src]').first().attr('src') ?? null;
  away.team.score = int(ws(visitorDiv.find('.team-score').first().text())) ?? ls?.rows[0]?.total ?? int(ws($('.v-score').first().text()));
  home.team.score = int(ws(homeDiv.find('.team-score').first().text())) ?? ls?.rows[1]?.total ?? int(ws($('.h-score').first().text()));
  if (ls) {
    const idFrom = (link: string | null) => link?.match(/[?&]id=([a-z0-9]+)/i)?.[1] ?? null;
    away.team.sourceTeamId = idFrom(ls.rows[0]?.link ?? null);
    home.team.sourceTeamId = idFrom(ls.rows[1]?.link ?? null);
  }
  const periods = ls?.periods ?? 2;
  for (const t of teams) {
    const row = ls?.rows[t.side === 'away' ? 0 : 1];
    t.team.totals.periodLines = Array.from({ length: periods }, (_, i) => ({ period: i + 1, score: row?.scores[i] ?? null, shots: null, saves: null, fouls: null, corners: null, offsides: null }));
  }

  const teamByName = (label: string): TeamCtx | null => {
    const n = norm(label);
    if (!n) return null;
    const hit = teams.find((t) => t.aliases.has(n) || norm(t.name) === n || teamKey(t.name) === teamKey(label));
    if (hit) return hit;
    return teams.find((t) => n.startsWith(norm(t.name)) || norm(t.name).startsWith(n)) ?? null;
  };

  // ---- player tables ----------------------------------------------------------------------
  const playerTables = tables.filter((t) => colIndex(t.headers, 'player', 'players', 'name') >= 0 && !/goalie/i.test(t.caption) && colIndex(t.headers, 'goalies', 'goalie', 'goalkeepers') < 0);
  playerTables.forEach((t, idx) => {
    const label = t.caption || ws($(t.el).closest('section, div').find('h2, h3').first().text());
    const ctx = teamByName(label) ?? teams[idx] ?? null;
    if (!ctx) return;
    addAlias(ctx, label);
    const cols = (...names: string[]) => colIndex(t.headers, ...names);
    const ci = { sh: cols('sh', 'shots'), sog: cols('sog'), g: cols('g', 'goals'), a: cols('a', 'ast'), min: cols('min', 'minutes'), gs: cols('gs'), f: cols('fouls', 'f', 'fo'), yc: cols('yc'), rc: cols('rc'), ck: cols('ck', 'corners'), off: cols('off', 'offsides', 'os'), pk: cols('pk', 'pkatt', 'pk-att') };
    const n = (row: string[], i: number) => (i >= 0 ? int(row[i] ?? null) : null);
    for (const row of t.rows) {
      const first = ws(row.texts[0] ?? '');
      if (TEAM_ROW.test(first) || /^totals?\b/i.test(first)) {
        if (/^totals?/i.test(first)) {
          ctx.team.totals.shots = n(row.texts, ci.sh);
          ctx.team.totals.sog = n(row.texts, ci.sog);
          ctx.team.totals.goals = n(row.texts, ci.g);
          ctx.team.totals.assists = n(row.texts, ci.a);
        }
        continue;
      }
      const cell = row.cells[0];
      if (!cell) continue;
      const p = playerFromCell($, cell);
      if (!p || TEAM_ROW.test(p.name) || /^tm$/i.test(p.position ?? '')) continue;
      const { first: fn, last: ln } = nameParts(p.name);
      const line = EMPTY_PLAYER_LINE(playerKey(ln, fn, p.jersey), fn, ln);
      line.jersey = p.jersey;
      line.position = p.position ? p.position.toUpperCase() : null;
      line.isGoalie = normalizePosition(p.position) === 'GK';
      const starterMark = $(cell).find('.starter').length > 0 || /\*$/.test(ws($(cell).text()));
      line.starter = starterMark;
      line.shots = n(row.texts, ci.sh);
      line.sog = n(row.texts, ci.sog);
      line.goals = n(row.texts, ci.g);
      line.assists = n(row.texts, ci.a);
      if (line.goals != null || line.assists != null) line.points = (line.goals ?? 0) * 2 + (line.assists ?? 0);
      if (line.shots != null && line.sog != null) line.shotsOffTarget = line.shots - line.sog;
      line.minutes = ci.min >= 0 ? minutesFromClock(row.texts[ci.min] ?? null) : null;
      if (ci.gs >= 0 && int(row.texts[ci.gs] ?? null)) line.starter = true;
      line.fouls = n(row.texts, ci.f);
      line.corners = n(row.texts, ci.ck);
      line.offsides = n(row.texts, ci.off);
      line.yellow = p.cards.filter((c) => c.color === 'yellow').length || n(row.texts, ci.yc) || 0;
      line.red = p.cards.filter((c) => c.color === 'red').length || n(row.texts, ci.rc) || 0;
      line.green = p.cards.filter((c) => c.color === 'green').length || 0;
      if (ci.pk >= 0) {
        const m = (row.texts[ci.pk] ?? '').match(/(\d+)\s*-\s*(\d+)/);
        if (m) {
          line.pkGoals = Number(m[1]);
          line.pkAttempts = Number(m[2]);
        }
      }
      line.hatTrick = (line.goals ?? 0) >= 3;
      ctx.team.players.push(line);
    }
  });

  // ---- goalie tables ----------------------------------------------------------------------
  const goalieTables = tables.filter((t) => colIndex(t.headers, 'goalies', 'goalie', 'goalkeepers', 'gk') >= 0 || /goalies|goalkeep/i.test(t.caption));
  goalieTables.forEach((t, idx) => {
    const label = ws(t.caption.replace(/goalies|goalkeepers|goalkeeping/i, ''));
    const ctx = teamByName(label) ?? teams[idx] ?? null;
    if (!ctx) return;
    const ci = { sog: colIndex(t.headers, 'sog', 'sf', 'shotsfaced'), ga: colIndex(t.headers, 'ga'), sv: colIndex(t.headers, 'sv', 'saves'), min: colIndex(t.headers, 'min', 'minutes') };
    for (const row of t.rows) {
      const cell = row.cells[0];
      if (!cell) continue;
      const p = playerFromCell($, cell);
      if (!p || TEAM_ROW.test(p.name)) continue;
      const recordText = ws($(cell).text()).match(/\(([WLT]),?\s*[\d-]+\)/i)?.[1] ?? null;
      const { first: fn, last: ln } = nameParts(p.name);
      let line = ctx.team.players.find((x) => (p.jersey != null && x.jersey === p.jersey) || nameKey(x.firstName, x.lastName) === nameKey(fn, ln)) ?? findPlayer(ctx, p.name);
      if (!line) {
        line = EMPTY_PLAYER_LINE(playerKey(ln, fn, p.jersey), fn, ln);
        line.jersey = p.jersey;
        line.position = 'GK';
        line.yellow = 0;
        line.red = 0;
        line.green = 0;
        ctx.team.players.push(line);
      }
      line.isGoalie = true;
      const mins = ci.min >= 0 ? minutesFromClock(row.texts[ci.min] ?? null) : null;
      line.gkMinutes = mins;
      if (line.minutes == null) line.minutes = mins;
      line.goalsAllowed = ci.ga >= 0 ? int(row.texts[ci.ga] ?? null) : null;
      line.saves = ci.sv >= 0 ? int(row.texts[ci.sv] ?? null) : null;
      void recordText;
      const tot = ctx.team.totals;
      tot.gkMinutes = (tot.gkMinutes ?? 0) + (mins ?? 0);
      tot.gkGoalsAllowed = (tot.gkGoalsAllowed ?? 0) + (line.goalsAllowed ?? 0);
      tot.gkSaves = (tot.gkSaves ?? 0) + (line.saves ?? 0);
      const shotsFaced = ci.sog >= 0 ? int(row.texts[ci.sog] ?? null) : null;
      void shotsFaced;
    }
  });

  // ---- per-period team boxes (SHOTS / SAVES / CORNER KICKS / FOULS / OFFSIDES) --------------
  for (const t of tables) {
    const label = normHeader(t.rawHeaders[0] ?? '');
    const stat: 'shots' | 'saves' | 'corners' | 'fouls' | 'offsides' | null =
      label === 'shots' ? 'shots' : label === 'saves' ? 'saves' : /^corner/.test(label) ? 'corners' : label === 'fouls' ? 'fouls' : /^offside/.test(label) ? 'offsides' : null;
    if (!stat) continue;
    const totIdx = t.headers.findIndex((h) => h === 'total' || h === 't');
    for (const row of t.rows) {
      const ctx = teamByName(row.texts[0] ?? '');
      if (!ctx) continue;
      const vals = row.texts.slice(1).map((x) => int(x));
      const total = totIdx >= 0 ? int(row.texts[totIdx] ?? null) : vals[vals.length - 1] ?? null;
      const perPeriod = totIdx >= 0 ? vals.slice(0, totIdx - 1) : vals.slice(0, -1);
      ctx.team.totals[stat] = total;
      perPeriod.forEach((v, i) => {
        const pl = ctx.team.totals.periodLines[i];
        if (pl) pl[stat] = v;
      });
    }
  }

  // ---- game information -------------------------------------------------------------------
  let date: string | null = null;
  let startTimeLocal: string | null = null;
  let venueName: string | null = null;
  let venueCity: string | null = null;
  let attendance: number | null = null;
  let durationMin: number | null = null;
  const officials: { title: string; name: string }[] = [];
  const infoTable = tables.find((t) => /game information|game info/i.test(t.caption)) ?? tables.find((t) => t.rows.some((r) => /^date/i.test(r.texts[0] ?? '')));
  if (infoTable) {
    for (const row of infoTable.rows) {
      const k = ws(row.texts[0] ?? '').replace(/:\s*$/, '');
      const v = ws(row.texts.slice(1).join(' '));
      if (!k) continue;
      if (/^date/i.test(k)) {
        date = parseDateText(v);
        const tm = v.match(/-\s*(\d{1,2}:\d{2}\s*(?:[AaPp]\.?[Mm]\.?)?)/) ?? v.match(/(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?)/);
        if (tm) startTimeLocal = to24h(tm[1]);
      } else if (/^(location|site|city)$/i.test(k)) venueCity = v || null;
      else if (/^(stadium|venue|field|arena)$/i.test(k)) venueName = v || null;
      else if (/^attend/i.test(k)) attendance = int(v.replace(/[^\d]/g, ''));
      else if (/game length|duration/i.test(k)) durationMin = minutesFromClock(v) ?? int(v);
      else if (/referee|official|linesman|umpire|judge|ar\b|4th/i.test(k) && v) officials.push({ title: k, name: v });
    }
  }
  if (!date) date = parseDateText($('span.date').first().text()) ?? parseDateText(h1Text) ?? (sourceUrl.match(/(\d{4})(\d{2})(\d{2})_/) ? sourceUrl.replace(/.*?(\d{4})(\d{2})(\d{2})_.*/, '$1-$2-$3') : null);
  if (!date) date = '1970-01-01';

  // ---- play-by-play -----------------------------------------------------------------------
  const raws: RawEvent[] = [];
  const pbpTables = tables.filter((t) => {
    if (!t.rows.some((r) => $(r.el).find('td.time, .time').length > 0 && $(r.el).find('td.play, .play').length > 0)) return false;
    return true;
  });
  pbpTables.forEach((t, idx) => {
    const label = t.caption || ws($(t.el).prevAll('h2, h3').first().text()) || ws($(t.el).closest('section, div').find('h2, h3').first().text());
    const period = periodFromLabel(label) ?? idx + 1;
    for (const row of t.rows) {
      const R = $(row.el);
      const timeCell = R.find('td.time, .time').first();
      const playCell = R.find('td.play, .play').first();
      if (!timeCell.length || !playCell.length) continue;
      const clone = playCell.clone();
      const actionTitle = ws(clone.find('.action-title').text());
      clone.find('.action-title').remove();
      const text = ws(clone.text());
      if (!text) continue;
      const clock = ws(timeCell.text()) || null;
      const c = classify(text, `${R.attr('class') ?? ''} ${actionTitle}`);
      raws.push({ period, clock, text, cls: R.attr('class') ?? '', ...c });
    }
  });

  // Learn team abbreviations / long names from events that carry a player we can place.
  for (const r of raws) {
    const tok = r.abbr ?? r.teamToken;
    if (!tok || sideOf(teams, tok)) continue;
    if (!r.player) continue;
    const owners = teams.filter((t) => findPlayer(t, r.player!));
    if (owners.length === 1) addAlias(owners[0]!, tok);
  }
  // Logo → team (scoring / penalty summaries mark rows with the team logo, but their alt text is unreliable).
  const logoSide = (src: string | null | undefined): Side | null => {
    if (!src) return null;
    if (away.logo && src === away.logo) return 'away';
    if (home.logo && src === home.logo) return 'home';
    return null;
  };

  const events: GameEvent[] = [];
  let hs = 0;
  let as = 0;
  let seq = 0;
  const pushEvent = (r: RawEvent, type: EventType, player: string | null, side: Side | null, assist: string | null) => {
    events.push({
      period: r.period,
      clock: r.clock,
      clockSeconds: clockToSeconds(r.clock),
      seq: seq++,
      side,
      type,
      playerNameRaw: player,
      assistNameRaw: assist,
      homeScore: hs,
      awayScore: as,
      text: r.text,
    });
  };
  const goalieStarters = new Set<PlayerStatLine>();
  for (const r of raws) {
    let side: Side | null = sideOf(teams, r.abbr) ?? sideOf(teams, r.teamToken);
    if (!side && r.player) {
      const owners = teams.filter((t) => findPlayer(t, r.player!));
      if (owners.length === 1) side = owners[0]!.side;
    }
    if (r.type === 'goal') {
      if (r.score) {
        as = r.score[0];
        hs = r.score[1];
      } else if (side === 'home') hs++;
      else if (side === 'away') as++;
      pushEvent(r, 'goal', r.player, side, r.assist);
      continue;
    }
    if (r.type === 'sub_in' && r.assist) {
      pushEvent(r, 'sub_in', r.player, side, null);
      pushEvent(r, 'sub_out', r.assist, side, null);
      continue;
    }
    if (r.type === 'goalie_change') {
      if (r.period === 1 && (r.clock === '00:00' || r.clock === '0:00') && side) {
        const ctx = teams.find((t) => t.side === side)!;
        const gk = findPlayer(ctx, r.player ?? '');
        if (gk) goalieStarters.add(gk);
      }
      pushEvent(r, 'goalie_change', r.player, side, null);
      continue;
    }
    pushEvent(r, r.type, r.player, side, r.assist);
  }
  for (const gk of goalieStarters) gk.starter = true;

  // Fall back to the scoring summary when the page had no play-by-play.
  if (!events.some((e) => e.type === 'goal')) {
    const scoring = tables.find((t) => /scoring summary/i.test(t.caption) || (colIndex(t.headers, 'play') >= 0 && colIndex(t.headers, 'v-h', 'vh') >= 0));
    if (scoring) {
      const pi = colIndex(scoring.headers, 'play');
      const ti = colIndex(scoring.headers, 'time');
      const si = colIndex(scoring.headers, 'v-h', 'vh', 'score');
      for (const row of scoring.rows) {
        const play = ws(row.texts[pi] ?? '');
        if (!play) continue;
        const period = periodFromLabel(ws($(row.cells[0]!).find('.period').text()) || ws(row.texts[0] ?? '')) ?? 1;
        const sm = (row.texts[si] ?? '').match(/(\d+)\s*-\s*(\d+)/);
        const m = play.match(/^(.+?)\s*\(\d+\)\s*(?:\((.+?)\))?/);
        const scorer = ws(m?.[1] ?? play);
        const assist = m?.[2] ? ws(m[2]).replace(/^unassisted$/i, '') || null : null;
        const logo = $(row.cells[0]!).find('[style*="background-image"]').attr('style')?.match(/url\(\s*['"]?([^'")]+)/)?.[1] ?? null;
        let side = logoSide(logo);
        if (!side) {
          const owners = teams.filter((t) => findPlayer(t, scorer));
          if (owners.length === 1) side = owners[0]!.side;
        }
        if (sm) {
          as = Number(sm[1]);
          hs = Number(sm[2]);
        } else if (side === 'home') hs++;
        else if (side === 'away') as++;
        const clock = ti >= 0 ? ws(row.texts[ti] ?? '') || null : null;
        events.push({ period, clock, clockSeconds: clockToSeconds(clock), seq: seq++, side, type: 'goal', playerNameRaw: scorer, assistNameRaw: assist, homeScore: hs, awayScore: as, text: play });
      }
      events.sort((a, b) => a.period - b.period || (a.clockSeconds ?? 0) - (b.clockSeconds ?? 0) || a.seq - b.seq);
      events.forEach((e, i) => (e.seq = i));
    }
  }

  // ---- team totals derived from players / events --------------------------------------------
  for (const t of teams) {
    const tot = t.team.totals;
    tot.yellow = t.team.players.reduce((s, p) => s + (p.yellow ?? 0), 0);
    tot.red = t.team.players.reduce((s, p) => s + (p.red ?? 0), 0);
    if (tot.goals == null) tot.goals = t.team.score;
    if (tot.shots != null && tot.sog != null) tot.shotsOffTarget = tot.shots - tot.sog;
    const offs = events.filter((e) => e.type === 'offside' && e.side === t.side).length;
    if (tot.offsides == null && (offs > 0 || events.length > 0)) tot.offsides = offs;
    if (tot.offsides != null) {
      for (const pl of tot.periodLines) {
        const n = events.filter((e) => e.type === 'offside' && e.side === t.side && e.period === pl.period).length;
        if (pl.offsides == null && events.length > 0) pl.offsides = n;
      }
    }
    const pks = t.team.players.reduce((s, p) => s + (p.pkGoals ?? 0), 0);
    if (t.team.players.some((p) => p.pkGoals != null)) {
      tot.pkGoals = pks;
      tot.pkAttempts = t.team.players.reduce((s, p) => s + (p.pkAttempts ?? 0), 0);
    }
    if (tot.gkMinutes == null && t.team.players.some((p) => p.isGoalie)) tot.gkMinutes = null;
  }

  const finalText = ws($('.linescore th, .status, .game-status').first().text());
  const status: BoxScore['status'] = /final/i.test(finalText) || (home.team.score != null && away.team.score != null) ? 'final' : 'scheduled';

  return {
    source: 'presto',
    sourceUrl,
    date,
    startTimeLocal,
    status,
    venueName,
    venueCity,
    attendance,
    officials,
    neutral,
    conferenceGame: false,
    postseason: false,
    tournament: null,
    overtime: periods > 2,
    shootout: /shootout|penalty kicks?\s*[:(]/i.test(txt($('body'))) && periods > 2,
    durationMin,
    periods,
    home: home.team,
    away: away.team,
    events,
    ncaaContestId: null,
  };
}
