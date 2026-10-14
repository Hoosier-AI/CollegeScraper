// Pure: International (/intl) page models -> <head> metadata and the escaped #ssr summary search engines and
// no-JavaScript readers get. A tournament, team or match page is Pro's renderer (src/seo/pro/pages.ts), which puts it
// under /intl; these are the section's own pages: the front door, the scoreboard, the lists, rankings, a nation's
// history and a player's international career. Every block of open-source data credits its source.
import type * as I from '../../pro/intl.js';
import type * as Q from '../../pro/queries.js';
import { abs, breadcrumbs, ld, NOINDEX, ogImage, SUFFIX, type HeadContext, type HeadMeta } from '../head.js';
import { a, n, table, tr, wrapBody } from '../body.js';
import { clip, esc, longDate, SITE_NAME } from '../util.js';
import { proIsFinal, proPaths, proScoreLine } from '../pro/pages.js';

export type IntlHomePage = Awaited<ReturnType<typeof I.home>>;
export type IntlTournamentsPage = Awaited<ReturnType<typeof I.tournaments>>;
export type IntlNationsPage = Awaited<ReturnType<typeof I.nations>>;
export type IntlRankingsPage = Awaited<ReturnType<typeof I.rankings>>;
export type IntlHistoryPage = NonNullable<Awaited<ReturnType<typeof I.nationHistory>>>;
export type IntlLeadersPage = Awaited<ReturnType<typeof Q.leaders>>;

const INTL = `${SITE_NAME} International`;
const home = [{ name: INTL, path: '/intl' }];
const day = (iso: string) => longDate(iso.slice(0, 10));
const matchLine = (m: Q.ProMatchRow) => `${a(proPaths.match(m.slug, m.league.scope), proIsFinal(m) ? proScoreLine(m) : `${m.home.name} vs ${m.away.name}`)} (${esc(m.league.name)})`;
const resultLine = (r: I.IntlResult) => `${esc(day(r.date))}: ${r.match_slug ? a(proPaths.match(r.match_slug, 'intl'), `${r.home.name} ${r.home_score ?? ''}-${r.away_score ?? ''} ${r.away.name}`) : esc(`${r.home.name} ${r.home_score ?? ''}-${r.away_score ?? ''} ${r.away.name}`)} (${esc(r.tournament)})`;
const credits = (cs: { name: string; url: string; license: string }[]) => (cs.length ? `<p>Sources: ${cs.map((c) => `<a href="${esc(c.url)}" rel="noopener">${esc(c.name)}</a> (${esc(c.license)})`).join('; ')}.</p>` : '');
const page = (ctx: HeadContext, path: string, title: string, description: string, crumbs: { name: string; path: string }[], robots: string | null = null): HeadMeta => ({
  title, description: clip(description), canonical: abs(ctx, path), robots, ogType: 'website', image: ogImage(ctx), jsonLd: [breadcrumbs(ctx, crumbs)],
});

// ---------- front door and scoreboard ----------
export function intlHomeHead(h: IntlHomePage, ctx: HeadContext): HeadMeta {
  const url = abs(ctx, '/intl');
  return {
    title: `${INTL}: National Team Scores, Results, Rankings and History`,
    description: clip(`Live scores, results and fixtures for every national team: the World Cup, continental championships, qualifiers, nations leagues and friendlies, men's and women's. Every result since 1872, records, top scorers and Plaibook Elo rankings for ${h.counts.nations || 'every'} nations.`),
    canonical: url, robots: null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [ld('CollectionPage', { '@id': `${url}#page`, name: INTL, url, isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: abs(ctx, '/') } })],
  };
}
export function intlHomeBody(h: IntlHomePage): string {
  const today = h.matches.groups.map((g) => `<h3>${a(proPaths.league(g.league.slug), g.league.name)}</h3><ul>${g.matches.map((m) => `<li>${matchLine(m)}</li>`).join('')}</ul>`).join('');
  const next = h.upcoming.slice(0, 20).map((m) => `<li>${esc(day(m.kickoff))}: ${matchLine(m)}</li>`).join('');
  const recent = h.recent.slice(0, 20).map((m) => `<li>${esc(day(m.kickoff))}: ${matchLine(m)}</li>`).join('');
  const inner = `<h1>International Soccer</h1>
<p>National teams, men's and women's: ${esc(h.counts.tournaments)} competitions and ${esc(h.counts.nations)} nations. Browse ${a('/intl/tournaments', 'every tournament')}, ${a('/intl/teams', 'every national team')} or the ${a('/intl/rankings', 'rankings')}.</p>
${today ? `<h2>Today</h2>${today}` : ''}${next ? `<h2>Coming up</h2><ul>${next}</ul>` : ''}${recent ? `<h2>Latest results</h2><ul>${recent}</ul>` : ''}`;
  return wrapBody('intl', [], inner);
}
export function intlMatchesHead(h: IntlHomePage, ctx: HeadContext): HeadMeta {
  return page(ctx, '/intl/matches', `International Soccer Scores Today, ${longDate(h.date)}${SUFFIX}`, `${h.matches.total} national-team matches on ${longDate(h.date)}${h.matches.live ? `, ${h.matches.live} live now` : ''}, and the next international matches: live scores, results and kickoff times.`, [...home, { name: 'Matches', path: '/intl/matches' }]);
}
export function intlMatchesBody(h: IntlHomePage): string {
  const groups = h.matches.groups.map((g) => `<h2>${a(proPaths.league(g.league.slug), g.league.name)}</h2><ul>${g.matches.map((m) => `<li>${matchLine(m)}</li>`).join('')}</ul>`).join('');
  const next = h.upcoming.slice(0, 40).map((m) => `<li>${esc(day(m.kickoff))}: ${matchLine(m)}</li>`).join('');
  return wrapBody('intl', [...home, { name: 'Matches', path: '/intl/matches' }], `<h1>International Matches, ${esc(longDate(h.date))}</h1>${groups || '<p>No international matches today.</p>'}${next ? `<h2>Next international matches</h2><ul>${next}</ul>` : ''}`);
}

// ---------- lists ----------
export function intlTournamentsHead(ts: IntlTournamentsPage, ctx: HeadContext): HeadMeta {
  return page(ctx, '/intl/tournaments', `International Soccer Tournaments: ${ts.length} Competitions${SUFFIX}`, 'Every national-team competition by confederation: the World Cup, the Euros, Copa América, the Gold Cup, AFCON, the Asian Cup, nations leagues, qualifiers, friendlies and youth championships.', [...home, { name: 'Tournaments', path: '/intl/tournaments' }]);
}
export function intlTournamentsBody(ts: IntlTournamentsPage): string {
  const by = new Map<string, IntlTournamentsPage>();
  for (const t of ts) by.set(t.confederation, [...(by.get(t.confederation) ?? []), t]);
  const parts = [...by.entries()].map(([c, list]) => `<h2>${esc(c === 'FIFA' ? 'Worldwide' : c)}</h2><ul>${list.map((t) => `<li>${a(proPaths.league(t.slug), t.name)}${t.level === 'youth' ? ' (youth)' : ''}${t.gender === 'w' ? " (women's)" : ''}</li>`).join('')}</ul>`).join('');
  return wrapBody('intl', [...home, { name: 'Tournaments', path: '/intl/tournaments' }], `<h1>International Tournaments</h1><p>${esc(ts.length)} national-team competitions.</p>${parts}`);
}
export function intlTeamsHead(ns: IntlNationsPage, ctx: HeadContext): HeadMeta {
  return page(ctx, '/intl/teams', `National Soccer Teams: ${ns.filter((x) => x.level === 'senior').length} Nations${SUFFIX}`, "Every men's and women's national team by confederation: results, fixtures, squads, all-time records, top scorers and most caps.", [...home, { name: 'Teams', path: '/intl/teams' }]);
}
export function intlTeamsBody(ns: IntlNationsPage): string {
  const senior = ns.filter((x) => x.level === 'senior');
  const by = new Map<string, IntlNationsPage>();
  for (const t of senior) by.set(t.confederation, [...(by.get(t.confederation) ?? []), t]);
  const parts = [...by.entries()].map(([c, list]) => `<h2>${esc(c)}</h2><ul>${list.map((t) => `<li>${a(`/intl/teams/${t.slug}`, `${t.name}${t.gender === 'w' ? " (women's)" : ''}`)}</li>`).join('')}</ul>`).join('');
  return wrapBody('intl', [...home, { name: 'Teams', path: '/intl/teams' }], `<h1>National Teams</h1>${parts}`);
}
export function intlRankingsHead(r: IntlRankingsPage, ctx: HeadContext): HeadMeta {
  const top = r.rows.slice(0, 3).map((x) => x.nation.name).join(', ');
  return page(ctx, '/intl/rankings', `${r.gender === 'w' ? "Women's " : ''}National Team Rankings: Plaibook Elo${SUFFIX}`, `Plaibook Elo ratings for every national team, worked out from every international result since 1872${top ? `. Top: ${top}` : ''}.`, [...home, { name: 'Rankings', path: '/intl/rankings' }], r.rows.length ? null : NOINDEX);
}
export function intlRankingsBody(r: IntlRankingsPage): string {
  const rows = r.rows.slice(0, 100).map((x) => tr([esc(x.rank), x.nation.slug ? a(`/intl/teams/${x.nation.slug}`, x.nation.name) : esc(x.nation.name), n(x.rating), x.change_1y == null ? '' : esc(`${x.change_1y > 0 ? '+' : ''}${x.change_1y}`), n(x.matches)]));
  return wrapBody('intl', [...home, { name: 'Rankings', path: '/intl/rankings' }], `<h1>National Team Rankings</h1><p>Plaibook Elo: our own rating, worked out from every result with the World Football Elo method (not FIFA's ranking).</p>${table('Plaibook Elo rankings', ['#', 'Nation', 'Rating', '1 year', 'Matches'], rows)}`);
}
export function intlLeadersHead(p: IntlLeadersPage, ctx: HeadContext): HeadMeta {
  return page(ctx, '/intl/players', `International Top Scorers and Player Stats${SUFFIX}`, 'Goals, assists and minutes for national-team players in the current international competitions, men\'s and women\'s.', [...home, { name: 'Players', path: '/intl/players' }], p.rows.length ? null : NOINDEX);
}
export function intlLeadersBody(p: IntlLeadersPage): string {
  const rows = p.rows.map((r) => tr([esc(r.rank), a(`/intl/players/${r.player.slug}`, r.player.name), r.team ? a(proPaths.team(r.team.slug), r.team.name) : '', r.league ? esc(r.league.name) : '', n(r.goals), n(r.assists), n(r.apps)]));
  return wrapBody('intl', [...home, { name: 'Players', path: '/intl/players' }], `<h1>International Top Scorers</h1>${table('International top scorers', ['#', 'Player', 'Nation', 'Competition', 'Goals', 'Assists', 'Apps'], rows)}`);
}

// ---------- a nation's history (the team page's second half, or the whole page of a nation the provider lacks) ----------
export function intlHistoryHead(h: IntlHistoryPage, ctx: HeadContext): HeadMeta {
  const r = h.record, name = `${h.nation.name}${h.gender === 'w' ? " Women's" : ''} National Team`;
  return page(ctx, `/intl/teams/${h.nation.slug ?? h.nation.key}`, `${name}: Results, Record and Top Scorers${SUFFIX}`,
    `${name}: ${r.played} matches since ${h.first_match?.slice(0, 4) ?? 'its first'} (${r.w} won, ${r.d} drawn, ${r.l} lost), every result, top scorers, most caps${h.elo?.rank ? ` and Plaibook Elo rank ${h.elo.rank}` : ''}.`,
    [...home, { name: 'Teams', path: '/intl/teams' }, { name: h.nation.name, path: `/intl/teams/${h.nation.slug ?? h.nation.key}` }]);
}
export function intlHistorySection(h: IntlHistoryPage): string {
  const r = h.record;
  const comps = h.competitions.slice(0, 15).map((c) => tr([esc(c.name), n(c.played), n(c.w), n(c.d), n(c.l), n(c.gf), n(c.ga)]));
  const scorers = h.scorers.slice(0, 15).map((s) => tr([s.slug ? a(proPaths.player(s.slug), s.name) : esc(s.name), n(s.goals), esc(`${s.first.slice(0, 4)}-${s.last.slice(0, 4)}`)]));
  const caps = h.caps.slice(0, 15).map((c) => tr([c.slug ? a(proPaths.player(c.slug), c.name) : esc(c.name), n(c.caps), n(c.goals)]));
  return `<h2>All-time record</h2><p>${esc(r.played)} matches since ${esc(h.first_match ?? '')}: ${esc(r.w)} won, ${esc(r.d)} drawn, ${esc(r.l)} lost, ${esc(r.gf)} goals for and ${esc(r.ga)} against.${h.elo?.rank ? ` Plaibook Elo rank ${esc(h.elo.rank)} (${esc(Math.round(Number(h.elo.rating)))}).` : ''}${h.world_cups.editions ? ` ${esc(h.world_cups.editions)} World Cups.` : ''}</p>
${comps.length ? `<h2>By competition</h2>${table(`${h.nation.name} by competition`, ['Competition', 'P', 'W', 'D', 'L', 'GF', 'GA'], comps)}` : ''}
${scorers.length ? `<h2>Top scorers</h2>${table(`${h.nation.name} top scorers`, ['Player', 'Goals', 'Years'], scorers)}` : ''}
${caps.length ? `<h2>Most caps among the players we follow</h2>${table(`${h.nation.name} most caps`, ['Player', 'Caps', 'Goals'], caps)}` : ''}
${h.recent.length ? `<h2>Latest results</h2><ul>${h.recent.slice(0, 15).map((x) => `<li>${resultLine(x)}</li>`).join('')}</ul>` : ''}${credits(h.credits)}`;
}
export function intlHistoryBody(h: IntlHistoryPage): string {
  return wrapBody('intl', [...home, { name: 'Teams', path: '/intl/teams' }, { name: h.nation.name, path: `/intl/teams/${h.nation.slug ?? h.nation.key}` }], `<h1>${esc(h.nation.name)}${h.gender === 'w' ? " Women's" : ''} National Team</h1>${intlHistorySection(h)}`);
}

// ---------- a player's international career ----------
export function intlPlayerHead(p: { player: NonNullable<Awaited<ReturnType<typeof Q.player>>>; intl: Awaited<ReturnType<typeof I.playerInternational>> }, ctx: HeadContext): HeadMeta {
  const pl = p.player.player;
  const caps = p.intl.caps[0];
  const path = `/intl/players/${pl.slug}`;
  return page(ctx, path, `${pl.name}: International Career, Caps and Goals${SUFFIX}`,
    `${pl.name}'s international career${caps?.nation ? ` with ${caps.nation.name}` : ''}${caps?.caps != null ? `: ${caps.caps} caps, ${caps.goals ?? 0} goals` : ''}${p.intl.world_cups.length ? `, ${p.intl.world_cups.length} World Cup${p.intl.world_cups.length > 1 ? 's' : ''}` : ''}.`,
    [...home, { name: 'Players', path: '/intl/players' }, { name: pl.name, path }], pl.noindex || (!p.intl.caps.length && !p.intl.world_cups.length && !p.player.seasons.some((s) => s.team?.national)) ? NOINDEX : null);
}
export function intlPlayerBody(p: { player: NonNullable<Awaited<ReturnType<typeof Q.player>>>; intl: Awaited<ReturnType<typeof I.playerInternational>> }): string {
  const pl = p.player.player;
  const caps = p.intl.caps.map((c) => tr([c.nation ? a(`/intl/teams/${c.nation.slug}`, c.nation.name) : '', n(c.caps), n(c.goals), esc(`${c.first_year ?? ''}-${c.last_year ?? ''}`)]));
  const seasons = p.player.seasons.filter((s) => s.team?.national).map((s) => tr([esc(s.season), s.league ? a(proPaths.league(s.league.slug), s.league.name) : '', s.team ? a(proPaths.team(s.team.slug), s.team.name) : '', n(s.apps), n(s.goals), n(s.assists)]));
  const wcs = p.intl.world_cups.map((w) => `<li>${esc(w.year)} World Cup${w.nation ? ` with ${esc(w.nation.name)}` : ''}${w.shirt ? `, shirt ${esc(w.shirt)}` : ''}</li>`).join('');
  return wrapBody('intl', [...home, { name: 'Players', path: '/intl/players' }, { name: pl.name, path: `/intl/players/${pl.slug}` }],
    `<h1>${esc(pl.name)}: International Career</h1><p>${a(proPaths.player(pl.slug), `${pl.name}'s club career`)}.</p>${caps.length ? `<h2>Caps</h2>${table(`${pl.name} caps`, ['Nation', 'Caps', 'Goals', 'Years'], caps)}` : ''}${seasons.length ? `<h2>By competition</h2>${table(`${pl.name} international competitions`, ['Season', 'Competition', 'Team', 'Apps', 'Goals', 'Assists'], seasons)}` : ''}${wcs ? `<h2>World Cups</h2><ul>${wcs}</ul>` : ''}${credits(p.intl.credits)}`);
}

/** Today's (or the next) national-team matches for the one home page (/). */
export function intlTodayBlock(h: IntlHomePage): string {
  const today = h.matches.groups.flatMap((g) => g.matches).slice(0, 20).map((m) => `<li>${matchLine(m)}</li>`).join('');
  const next = today ? '' : h.upcoming.slice(0, 10).map((m) => `<li>${esc(day(m.kickoff))}: ${matchLine(m)}</li>`).join('');
  return `<h2>International soccer</h2><p>National teams, men's and women's: ${esc(h.counts.tournaments)} competitions and ${esc(h.counts.nations)} nations, every result since 1872. See ${a('/intl/matches', 'the international scoreboard')} or the ${a('/intl/rankings', 'Plaibook Elo rankings')}.</p>${today ? `<h3>International matches today</h3><ul>${today}</ul>` : next ? `<h3>Coming up</h3><ul>${next}</ul>` : ''}`;
}
