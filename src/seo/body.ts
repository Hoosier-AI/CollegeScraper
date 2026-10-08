// Pure: page model -> an escaped, semantic HTML summary for crawlers and no-JavaScript readers. It is injected
// in <section id="ssr"> after #root; the single-page app removes it once it mounts. Every value is escaped.
import type { BoxLine, ConferencePage, HomePage, MatchPage, PlayerPage, Poll, RankingsPage, TeamLine, TeamPage, TeamsIndexPage } from './types.js';
import type { HeadContext } from './head.js';
import { extraTime, isFinal, matchName, teamTitle } from './head.js';
import { conferencePath, divisionLabel, esc, genderWord, longDate, matchPath, playerPath, rec, SITE_NAME, teamPath } from './util.js';

export type PageType = 'home' | 'team' | 'player' | 'match' | 'conference' | 'rankings' | 'teams' | 'not-found' | 'pro';

export const TEKKI_URL = 'https://www.plaibook.soccer/';
export const ctaHref = (page: PageType) => `${TEKKI_URL}?utm_source=stats&utm_medium=referral&utm_campaign=${encodeURIComponent(page)}`;

export const n = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(d));
const pct = (v: number | null | undefined) => (v == null ? '–' : `${(Number(v) * 100).toFixed(1)}%`);
export const a = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
const th = (cols: string[]) => `<thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>`;
export const table = (caption: string, cols: string[], rows: string[]) => `<table><caption>${esc(caption)}</caption>${th(cols)}<tbody>${rows.join('')}</tbody></table>`;
export const tr = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;

/** Site navigation, breadcrumbs, the page content and the Tekki footer link. */
export function wrapBody(page: PageType, crumbs: { name: string; path: string }[], inner: string): string {
  const nav = page === 'pro'
    ? `<nav aria-label="Site">${a('/pro', `${SITE_NAME} Pro`)} · ${a('/pro/matches', 'Matches')} · ${a('/pro/leagues', 'Leagues')} · ${a('/', 'College soccer')}</nav>`
    : `<nav aria-label="Site">${a('/', SITE_NAME)} · ${a('/teams', 'Teams')} · ${a('/rankings', 'Rankings')} · ${a('/matches', 'Matches')} · ${a('/pro', 'Pro soccer')}</nav>`;
  const bc = crumbs.length > 1
    ? `<nav aria-label="Breadcrumb"><ol>${crumbs.map((c, i) => `<li>${i === crumbs.length - 1 ? esc(c.name) : a(c.path, c.name)}</li>`).join('')}</ol></nav>`
    : '';
  const cta = `<aside class="ssr-cta"><p><a href="${esc(ctaHref(page))}">Coach with Tekki</a>, Plaibook's AI assistant for soccer coaches.</p></aside>`;
  return `<section id="ssr">${nav}${bc}<article>${inner}</article>${cta}</section>`;
}

// ---------- team ----------
export function teamBody(t: TeamPage, ctx: HeadContext): string {
  const title = teamTitle(t);
  const head = t.coaches.find((c) => c.is_head);
  const facts: string[] = [];
  if (t.division) facts.push(esc(divisionLabel(t.division)));
  if (t.conference) facts.push(a(conferencePath(t.conference.seo, t.season, ctx.currentSeason), t.conference.name));
  if (t.record) facts.push(`${esc(rec(t.record.w, t.record.l, t.record.t))} overall`);
  if (t.record?.conf) facts.push(`${esc(rec(t.record.conf.w, t.record.conf.l, t.record.conf.t))} in conference`);
  if (t.standing?.rank) facts.push(`${esc(String(t.standing.rank))}${t.standing.pod ? ` in the ${esc(t.standing.pod)}` : ' in the conference table'}`);
  if (t.poll) facts.push(`No. ${esc(String(t.poll.rank))} in the United Soccer Coaches poll${t.poll.label ? ` (${esc(t.poll.label)})` : ''}`);
  if (head) facts.push(`head coach ${esc(head.name)}`);
  if (t.record && t.record.gf != null) facts.push(`${esc(String(t.record.gf))} goals for, ${esc(String(t.record.ga ?? 0))} against`);
  const other = t.seasons.filter((s) => s !== t.season).slice(0, 6);
  const seasons = other.length ? `<p>Other seasons: ${other.map((s) => a(teamPath(t, s, ctx.currentSeason), String(s))).join(', ')}</p>` : '';
  const hasGk = t.roster.some((r) => (r.saves ?? 0) > 0);
  const roster = t.roster.length
    ? table(`${title} roster, ${t.season}`, ['#', 'Player', 'Pos', 'Class', 'GP', 'GS', 'Min', 'G', 'A', 'Pts', ...(hasGk ? ['Saves', 'GA'] : [])],
      t.roster.map((r) => tr([esc(r.jersey ?? ''), r.slug ? a(playerPath(r.slug), r.name) : esc(r.name), esc(r.position ?? ''), esc(r.class_label ?? ''), n(r.gp), n(r.gs), n(r.minutes), n(r.goals), n(r.assists), n(r.points), ...(hasGk ? [r.saves ? n(r.saves) : '', r.saves ? n(r.ga) : ''] : [])])))
    : '<p>No roster collected for this season yet.</p>';
  const played = t.games.filter((g) => g.status === 'final' && g.score_for != null);
  const upcoming = t.games.filter((g) => g.status === 'scheduled');
  const opp = (g: TeamPage['games'][number]) => `${g.neutral ? 'vs' : g.home ? 'vs' : 'at'} ${g.opponent_team ? a(teamPath(g.opponent_team, t.season, ctx.currentSeason), g.opponent) : esc(g.opponent)}`;
  const result = (g: TeamPage['games'][number]) => {
    const r = g.score_for! > g.score_against! ? 'W' : g.score_for! < g.score_against! ? 'L' : 'T';
    const txt = `${r} ${g.score_for}-${g.score_against}${g.overtime ? ' (OT)' : ''}`;
    return g.slug ? a(matchPath(g.slug), txt) : esc(txt);
  };
  const results = played.length
    ? `<h2>Results</h2><ul>${[...played].reverse().map((g) => `<li>${esc(longDate(g.date))}: ${opp(g)}, ${result(g)}</li>`).join('')}</ul>`
    : '';
  const fixtures = upcoming.length
    ? `<h2>Upcoming matches</h2><ul>${upcoming.slice(0, 12).map((g) => `<li>${esc(longDate(g.date))}: ${opp(g)}${g.slug ? ` (${a(matchPath(g.slug), 'preview')})` : ''}</li>`).join('')}</ul>`
    : '';
  const coaches = t.coaches.length ? `<h2>Coaches</h2><ul>${t.coaches.map((c) => `<li>${esc(c.name)}${c.title ? `, ${esc(c.title)}` : ''}</li>`).join('')}</ul>` : '';
  const inner = `<h1>${esc(title)} ${esc(t.season)}</h1>
<p>${facts.join('; ')}.</p>${seasons}
<h2>Roster and season stats</h2>${roster}${results}${fixtures}${coaches}`;
  return wrapBody('team', [{ name: SITE_NAME, path: '/' }, { name: 'Teams', path: '/teams' }, { name: title, path: teamPath(t) }], inner);
}

// ---------- player ----------
export function playerBody(p: PlayerPage): string {
  const latest = p.seasons[0] ?? null;
  const team = latest?.team ?? null;
  const isGk = p.seasons.some((s) => (s.saves ?? 0) > 0 || /^g/i.test(s.position ?? ''));
  const bio = [
    latest?.position ? esc(latest.position) : null,
    latest?.class_label ? esc(latest.class_label) : null,
    team ? `${a(teamPath(team), teamTitle(team))}${latest?.jersey != null ? `, No. ${esc(latest.jersey)}` : ''}` : null,
  ].filter(Boolean).join(', ');
  const from = [p.hometown ? `From ${esc(p.hometown)}` : null, p.high_school ? esc(p.high_school) : null].filter(Boolean).join('; ');
  const cols = ['Season', 'Team', 'GP', 'GS', 'Min', 'G', 'A', 'Pts', 'Sh', 'SOG', ...(isGk ? ['Saves', 'GA', 'GAA', 'Save %', 'SHO'] : [])];
  const rows = p.seasons.map((s) => tr([esc(s.season), a(teamPath(s.team), s.team.name), n(s.gp), n(s.gs), n(s.minutes), n(s.goals), n(s.assists), n(s.points), n(s.shots), n(s.sog), ...(isGk ? [n(s.saves), n(s.ga), n(s.gaa, 2), pct(s.save_pct), n(s.shutouts)] : [])]));
  const honors = p.honors.length ? `<h2>Honors</h2><ul>${p.honors.slice(0, 20).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '';
  const inner = `<h1>${esc(p.name)}</h1>
${bio ? `<p>${bio}.</p>` : ''}${from ? `<p>${from}.</p>` : ''}
<h2>Season stats</h2>${p.seasons.length ? table(`${p.name} season by season`, cols, rows) : '<p>No seasons recorded yet.</p>'}${honors}`;
  const crumbs = [{ name: SITE_NAME, path: '/' }, { name: 'Teams', path: '/teams' }, ...(team ? [{ name: teamTitle(team), path: teamPath(team) }] : []), { name: p.name, path: playerPath(p.slug) }];
  return wrapBody('player', crumbs, inner);
}

// ---------- match ----------
function teamStatsTable(m: MatchPage): string {
  const h = m.team_stats.home, w = m.team_stats.away;
  if (!h && !w) return '';
  const row = (label: string, k: keyof TeamLine) => tr([esc(label), n(w?.[k]), n(h?.[k])]);
  return `<h2>Team stats</h2>${table('Team stats', ['', m.away.name, m.home.name], [row('Shots', 'shots'), row('Shots on goal', 'sog'), row('Corners', 'corners'), row('Fouls', 'fouls'), row('Saves', 'saves'), row('Yellow cards', 'yc'), row('Red cards', 'rc')])}`;
}

function boxTable(side: string, lines: BoxLine[]): string {
  if (!lines.length) return '';
  const rows = lines.map((l) => tr([esc(l.jersey ?? ''), l.slug ? a(playerPath(l.slug), l.name) : esc(l.name), esc(l.is_goalie ? 'GK' : l.position ?? ''), l.starter ? 'Yes' : '', n(l.minutes), n(l.goals), n(l.assists), n(l.shots), l.is_goalie ? n(l.saves) : '']));
  return table(`${side} box score`, ['#', 'Player', 'Pos', 'Started', 'Min', 'G', 'A', 'Sh', 'Saves'], rows);
}

export function matchBody(m: MatchPage, ctx: HeadContext): string {
  const final = isFinal(m);
  const sideLink = (s: MatchPage['home']) => (s.team ? a(teamPath(s.team, m.season, ctx.currentSeason), s.name) : esc(s.name));
  const h1 = final ? `${esc(m.away.name)} ${esc(m.away.score)}, ${esc(m.home.name)} ${esc(m.home.score)}${esc(extraTime(m))}` : esc(matchName(m));
  const facts = [
    `${esc(genderWord(m.gender))} soccer${m.division ? `, ${esc(divisionLabel(m.division))}` : ''}`,
    esc(longDate(m.date)),
    m.venue_name || m.venue_city ? esc([m.venue_name, m.venue_city].filter(Boolean).join(', ')) : null,
    m.neutral_site ? 'neutral site' : null,
    m.conference_game ? 'conference match' : null,
    m.tournament ? esc(m.tournament) : m.postseason ? 'postseason' : null,
    m.attendance ? `attendance ${esc(m.attendance)}` : null,
    m.status === 'postponed' || m.status === 'cancelled' ? esc(m.status) : null,
  ].filter(Boolean);
  const events = m.events.length
    ? `<h2>Goals and cards</h2><ol>${m.events.map((e) => {
        const who = e.side === 'home' ? m.home.name : e.side === 'away' ? m.away.name : '';
        const what = e.type === 'goal' ? 'Goal' : e.type === 'yellow' ? 'Yellow card' : 'Red card';
        return `<li>${e.minute ? `${esc(e.minute)} ` : ''}${what}${who ? ` (${esc(who)})` : ''}: ${esc(e.player ?? 'unknown')}${e.assist ? `, assisted by ${esc(e.assist)}` : ''}</li>`;
      }).join('')}</ol>`
    : '';
  const box = m.players.away.length || m.players.home.length
    ? `<h2>Box score</h2>${boxTable(m.away.name, m.players.away)}${boxTable(m.home.name, m.players.home)}`
    : '';
  const inner = `<h1>${h1}</h1>
<p>${sideLink(m.away)} at ${sideLink(m.home)}. ${facts.join('; ')}.</p>${events}${teamStatsTable(m)}${box}`;
  const crumbs = [{ name: SITE_NAME, path: '/' }, ...(m.home.team ? [{ name: teamTitle(m.home.team), path: teamPath(m.home.team) }] : []), { name: matchName(m), path: matchPath(m.slug) }];
  return wrapBody('match', crumbs, inner);
}

// ---------- conference ----------
export function conferenceBody(c: ConferencePage, ctx: HeadContext): string {
  const tables = c.tables.map((t) => {
    const label = `${genderWord(t.gender)} standings`;
    if (!t.rows.length) {
      return `<h2>${esc(label)}</h2>${t.members.length ? `<p>Members: ${t.members.map((m) => a(teamPath(m, c.season, ctx.currentSeason), m.name)).join(', ')}.</p>` : '<p>No table yet.</p>'}`;
    }
    const rows = t.rows.map((r) => tr([esc(r.rank ?? ''), `${a(teamPath(r.team, c.season, ctx.currentSeason), r.team.name)}${r.pod ? ` (${esc(r.pod)})` : ''}`, esc(rec(r.conf.w, r.conf.l, r.conf.t)), n(r.conf_pts, r.conf_pts != null && r.conf_pts % 1 ? 1 : 0), r.overall ? esc(rec(r.overall.w, r.overall.l, r.overall.t)) : '–', r.gf != null ? `${esc(r.gf)}-${esc(r.ga ?? 0)}` : '–']));
    return `<h2>${esc(label)}</h2>${table(`${c.name} ${label}, ${c.season}${t.source === 'computed' ? ' (computed from results)' : ''}`, ['#', 'Team', 'Conf', 'Pts', 'Overall', 'GF-GA'], rows)}`;
  }).join('');
  const inner = `<h1>${esc(c.name)} Soccer Standings ${esc(c.season)}</h1>
<p>${esc(c.division ? divisionLabel(c.division) : 'NCAA')} conference. Official conference tables where the conference publishes one, checked against the records computed from every result.</p>${tables}`;
  return wrapBody('conference', [{ name: SITE_NAME, path: '/' }, { name: 'Rankings', path: '/rankings' }, { name: c.name, path: conferencePath(c.seo) }], inner);
}

// ---------- rankings / teams / home ----------
function pollBlock(p: Poll, season: number, ctx: HeadContext, limit = 25): string {
  const heading = `${divisionLabel(p.division)} ${genderWord(p.gender)}: United Soccer Coaches poll${p.label ? `, ${p.label}` : ''}`;
  const rows = p.rows.slice(0, limit).map((r) => tr([esc(r.rank), r.team ? a(teamPath(r.team, season, ctx.currentSeason), r.name) : esc(r.name), esc(r.record ?? ''), n(r.points), r.previous_rank ? esc(r.previous_rank) : 'NR']));
  return `<h2>${esc(heading)}</h2>${table(`${heading} (week of ${longDate(p.week_of)})`, ['Rank', 'Team', 'Record', 'Points', 'Previous'], rows)}`;
}

export function rankingsBody(r: RankingsPage, ctx: HeadContext): string {
  const inner = `<h1>College Soccer Rankings ${esc(r.season)}</h1>
<p>The latest United Soccer Coaches polls for NCAA men's and women's soccer, Division I to III.</p>${r.polls.length ? r.polls.map((p) => pollBlock(p, r.season, ctx)).join('') : '<p>No polls published yet this season.</p>'}`;
  return wrapBody('rankings', [{ name: SITE_NAME, path: '/' }, { name: 'Rankings', path: '/rankings' }], inner);
}

export function teamsBody(t: TeamsIndexPage, ctx: HeadContext): string {
  const parts: string[] = [];
  for (const g of ['m', 'w'] as const) {
    for (const d of ['d1', 'd2', 'd3']) {
      const list = t.teams.filter((x) => x.team.gender === g && x.division === d).sort((x, y) => x.team.name.localeCompare(y.team.name));
      if (!list.length) continue;
      parts.push(`<h2>${esc(`${divisionLabel(d)} ${genderWord(g)} soccer`)}</h2><ul>${list.map((x) => `<li>${a(teamPath(x.team, t.season, ctx.currentSeason), x.team.name)}${x.conference ? ` (${a(conferencePath(x.conference.seo, t.season, ctx.currentSeason), x.conference.short_name ?? x.conference.name)})` : ''}</li>`).join('')}</ul>`);
    }
  }
  const inner = `<h1>NCAA Soccer Teams ${esc(t.season)}</h1>
<p>${esc(t.teams.length)} men's and women's programs across Division I, II and III.</p>${parts.join('')}`;
  return wrapBody('teams', [{ name: SITE_NAME, path: '/' }, { name: 'Teams', path: '/teams' }], inner);
}

export function homeBody(h: HomePage, ctx: HeadContext): string {
  const polls = h.polls.filter((p) => p.division === 'd1').map((p) => pollBlock(p, h.season, ctx, 10)).join('');
  const confs = h.conferences.length
    ? `<h2>Conferences</h2><ul>${h.conferences.map((c) => `<li>${a(conferencePath(c.seo, h.season, ctx.currentSeason), c.name)}${c.division ? ` (${esc(divisionLabel(c.division))})` : ''}</li>`).join('')}</ul>`
    : '';
  const inner = `<h1>NCAA College Soccer Stats</h1>
<p>Every NCAA soccer program, Division I to III, men's and women's: ${esc(h.teams)} teams with rosters, box scores, season stats, conference standings and the United Soccer Coaches polls for ${esc(h.season)}. Browse ${a('/teams', 'all teams')} or the ${a('/rankings', 'rankings')}.</p>${polls}${confs}`;
  return wrapBody('home', [], inner);
}

export function notFoundBody(): string {
  return wrapBody('not-found', [], `<h1>Page not found</h1><p>There is no page at this address. It may have moved, or the link was cut short. Try ${a('/teams', 'the team list')} or ${a('/rankings', 'the rankings')}.</p>`);
}
