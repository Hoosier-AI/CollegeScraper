// Pure: Plaibook Stats Pro page models (src/pro/queries.ts) -> <head> metadata and the escaped #ssr summary that
// search engines and no-JavaScript readers get. Same rules as the college pages: unplayed and score-only matches,
// players without an appearance and competitions without a match stay out of search (noindex,follow).
import type * as Q from '../../pro/queries.js';
import { abs, breadcrumbs, ld, NOINDEX, ogImage, SUFFIX, type HeadContext, type HeadMeta } from '../head.js';
import { a, n, table, tr, wrapBody } from '../body.js';
import { clip, esc, longDate, SITE_NAME } from '../util.js';

export type ProHomePage = Awaited<ReturnType<typeof Q.home>>;
export type ProLeaguesPage = Awaited<ReturnType<typeof Q.leagues>>;
export type ProLeaguePage = NonNullable<Awaited<ReturnType<typeof Q.league>>>;
export type ProTeamPage = NonNullable<Awaited<ReturnType<typeof Q.team>>>;
export type ProPlayerPage = NonNullable<Awaited<ReturnType<typeof Q.player>>>;
export type ProMatchPage = NonNullable<Awaited<ReturnType<typeof Q.match>>>;

const PRO = `${SITE_NAME} Pro`;
export const proPaths = {
  home: '/pro', leagues: '/pro/leagues', matches: '/pro/matches',
  league: (slug: string, season?: number | null, current?: number | null) => `/pro/leagues/${encodeURIComponent(slug)}${season && current && season !== current ? `?season=${season}` : ''}`,
  team: (slug: string, season?: number | null, latest?: number | null) => `/pro/teams/${encodeURIComponent(slug)}${season && latest && season !== latest ? `?season=${season}` : ''}`,
  player: (slug: string) => `/pro/players/${encodeURIComponent(slug)}`,
  match: (slug: string) => `/pro/matches/${encodeURIComponent(slug)}`,
};
const crumbsHome = [{ name: PRO, path: proPaths.home }];
const genderWord = (g: string | null | undefined) => (g === 'w' ? "women's" : "men's");
const where = (l: { country: string | null }) => (l.country && l.country !== 'World' ? l.country : 'International');
const day = (iso: string) => longDate(iso.slice(0, 10));
const teamLd = (ctx: HeadContext, t: { name: string; slug: string }) => ({ '@type': 'SportsTeam', name: t.name, sport: 'Soccer', url: abs(ctx, proPaths.team(t.slug)) });

// ---------- match helpers ----------
export const proIsFinal = (m: Q.ProMatchRow) => m.status === 'final' && m.home.score != null && m.away.score != null;
export const proIsUnplayed = (m: Q.ProMatchRow) => m.status !== 'live' && !proIsFinal(m);
const after = (m: Q.ProMatchRow) => (m.pen[0] != null ? ` (${m.pen[0]}-${m.pen[1]} on penalties)` : m.status_short === 'AET' ? ' (after extra time)' : '');
export const proScoreLine = (m: Q.ProMatchRow) => `${m.home.name} ${m.home.score}-${m.away.score} ${m.away.name}${after(m)}`;
const proMatchName = (m: Q.ProMatchRow) => `${m.home.name} vs ${m.away.name}`;

// ---------- home ----------
export function proHomeHead(h: ProHomePage, ctx: HeadContext): HeadMeta {
  const url = abs(ctx, proPaths.home);
  return {
    title: `${PRO}: Pro Soccer Scores, Tables and Player Stats Worldwide`,
    description: clip(`Live scores, results, league tables, lineups and player stats from ${h.counts.leagues || 'hundreds of'} professional soccer competitions, from MLS and the NWSL to the Premier League. College players linked to their pro careers.`),
    canonical: url, robots: null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [ld('CollectionPage', { '@id': `${url}#page`, name: PRO, url, isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: abs(ctx, '/') } })],
  };
}

export function proHomeBody(h: ProHomePage): string {
  const groups = h.matches.groups.filter((g) => g.priority < 100).slice(0, 12).map((g) =>
    `<h3>${a(proPaths.league(g.league.slug), g.league.name)}</h3><ul>${g.matches.map((m) => `<li>${a(proPaths.match(m.slug), proIsFinal(m) || m.status === 'live' ? proScoreLine(m) : proMatchName(m))}</li>`).join('')}</ul>`).join('');
  const featured = h.featured.length ? `<h2>Competitions</h2><ul>${h.featured.map((l) => `<li>${a(proPaths.league(l.slug), l.name)} (${esc(where(l))}, ${esc(genderWord(l.gender))})</li>`).join('')}</ul>` : '';
  const inner = `<h1>Professional Soccer Stats</h1>
<p>Scores, lineups, league tables and player stats from ${esc(h.counts.leagues)} professional competitions: ${esc(h.counts.teams)} clubs, ${esc(h.counts.players)} players and ${esc(h.counts.matches)} matches. Browse ${a(proPaths.leagues, 'every competition')} or ${a(proPaths.matches, "today's matches")}.</p>
${groups ? `<h2>Matches on ${esc(longDate(h.date))}</h2>${groups}` : ''}${featured}`;
  return wrapBody('pro', [], inner);
}

// ---------- the scoreboard (/pro/matches) ----------
export function proMatchesHead(h: ProHomePage, ctx: HeadContext): HeadMeta {
  return {
    title: `Pro Soccer Scores Today, ${longDate(h.date)}: Live Results and Fixtures${SUFFIX}`,
    description: clip(`${h.matches.total} professional soccer matches on ${longDate(h.date)} across ${h.matches.groups.length} competitions${h.matches.live ? `, ${h.matches.live} live now` : ''}: live scores, results and kickoff times, men's and women's.`),
    canonical: abs(ctx, proPaths.matches), robots: null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [breadcrumbs(ctx, [...crumbsHome, { name: 'Matches', path: proPaths.matches }])],
  };
}

export function proMatchesBody(h: ProHomePage): string {
  const groups = h.matches.groups.map((g) => `<h2>${a(proPaths.league(g.league.slug), g.league.name)}</h2><ul>${g.matches.map((m) => `<li>${a(proPaths.match(m.slug), proIsFinal(m) || m.status === 'live' ? proScoreLine(m) : proMatchName(m))}</li>`).join('')}</ul>`).join('');
  return wrapBody('pro', [...crumbsHome, { name: 'Matches', path: proPaths.matches }], `<h1>Pro Soccer Matches, ${esc(longDate(h.date))}</h1><p>${esc(h.matches.total)} matches in ${esc(h.matches.groups.length)} competitions.</p>${groups}`);
}

// ---------- competitions ----------
export function proLeaguesHead(ls: ProLeaguesPage, ctx: HeadContext): HeadMeta {
  return {
    title: `Pro Soccer Leagues and Cups: ${ls.length} Competitions${SUFFIX}`,
    description: clip(`Every professional soccer league and cup on ${PRO}, men's and women's, by country: tables, results, fixtures and top scorers.`),
    canonical: abs(ctx, proPaths.leagues), robots: null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [breadcrumbs(ctx, [...crumbsHome, { name: 'Leagues', path: proPaths.leagues }])],
  };
}

export function proLeaguesBody(ls: ProLeaguesPage): string {
  const by = new Map<string, typeof ls>();
  for (const l of ls) { const k = where(l); by.set(k, [...(by.get(k) ?? []), l]); }
  const parts = [...by.entries()].map(([c, list]) => `<h2>${esc(c)}</h2><ul>${list.map((l) => `<li>${a(proPaths.league(l.slug), l.name)}${l.gender === 'w' ? " (women's)" : ''}</li>`).join('')}</ul>`).join('');
  return wrapBody('pro', [...crumbsHome, { name: 'Leagues', path: proPaths.leagues }], `<h1>Professional Soccer Competitions</h1><p>${esc(ls.length)} leagues and cups.</p>${parts}`);
}

export function proLeagueHead(p: ProLeaguePage, ctx: HeadContext): HeadMeta {
  const l = p.league;
  const path = proPaths.league(l.slug, p.season, l.current_season);
  const top = p.standings[0]?.rows[0];
  const scorer = p.scorers[0];
  const bits = [top ? `${top.team.name} top the table on ${top.points} points` : null, scorer ? `${scorer.player.name} leads the scorers with ${scorer.goals}` : null].filter(Boolean);
  const name = `${l.name}${p.season ? ` ${p.season}` : ''}`;
  return {
    title: `${name}: Table, Results, Fixtures and Top Scorers${SUFFIX}`,
    description: clip(`${name}, ${genderWord(l.gender)} ${l.type === 'cup' ? 'cup' : 'league'} soccer (${where(l)}).${bits.length ? ` ${bits.join('; ')}.` : ''} Standings, every result, upcoming fixtures and player stats.`),
    canonical: abs(ctx, path),
    robots: !p.results.length && !p.standings.length ? NOINDEX : null,
    ogType: 'website', image: ogImage(ctx),
    jsonLd: [
      ld('SportsOrganization', { '@id': `${abs(ctx, proPaths.league(l.slug))}#league`, name: l.name, sport: 'Soccer', url: abs(ctx, path), logo: l.logo ?? undefined, member: (p.standings[0]?.rows ?? []).slice(0, 40).map((r) => teamLd(ctx, r.team)) }),
      breadcrumbs(ctx, [...crumbsHome, { name: 'Leagues', path: proPaths.leagues }, { name: l.name, path }]),
    ],
  };
}

export function proLeagueBody(p: ProLeaguePage): string {
  const l = p.league;
  const tables = p.standings.map((g) => `<h2>${esc(g.name || `${l.name} table`)}</h2>${table(`${l.name} ${g.name} ${p.season ?? ''}`, ['#', 'Club', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'],
    g.rows.map((r) => tr([esc(r.rank ?? ''), a(proPaths.team(r.team.slug), r.team.name), n(r.played), n(r.win), n(r.draw), n(r.lose), n(r.gf), n(r.ga), n(r.gd), n(r.points)])))}`).join('');
  const list = (title: string, ms: Q.ProMatchRow[]) => (ms.length ? `<h2>${esc(title)}</h2><ul>${ms.map((m) => `<li>${esc(day(m.kickoff))}: ${a(proPaths.match(m.slug), proIsFinal(m) ? proScoreLine(m) : proMatchName(m))}</li>`).join('')}</ul>` : '');
  const leaders = p.scorers.length ? `<h2>Top scorers</h2>${table(`${l.name} top scorers`, ['Player', 'Club', 'Goals', 'Apps'], p.scorers.map((s) => tr([a(proPaths.player(s.player.slug), s.player.name), s.team ? a(proPaths.team(s.team.slug), s.team.name) : '', n(s.goals), n(s.apps)])))}` : '';
  const inner = `<h1>${esc(l.name)}${p.season ? ` ${esc(p.season)}` : ''}</h1>
<p>${esc(where(l))}, ${esc(genderWord(l.gender))} ${l.type === 'cup' ? 'cup competition' : 'league'}${p.teams ? `, ${esc(p.teams)} clubs` : ''}.${p.seasons.length > 1 ? ` Seasons: ${p.seasons.slice(0, 8).map((s) => a(proPaths.league(l.slug, s, l.current_season), String(s))).join(', ')}.` : ''}</p>${tables}${leaders}${list('Latest results', p.results.slice(0, 20))}${list('Upcoming fixtures', p.fixtures.slice(0, 20))}`;
  return wrapBody('pro', [...crumbsHome, { name: 'Leagues', path: proPaths.leagues }, { name: l.name, path: proPaths.league(l.slug) }], inner);
}

// ---------- clubs ----------
export function proTeamHead(p: ProTeamPage, ctx: HeadContext): HeadMeta {
  const t = p.team;
  const path = proPaths.team(t.slug, p.season, p.seasons[0]);
  const comp = p.competitions[0];
  const st = p.standings[0];
  const bits = [comp?.league ? `${comp.w}-${comp.d}-${comp.l} in the ${comp.league.name}` : null, st?.rank ? `${st.rank}${['th', 'st', 'nd', 'rd'][st.rank % 10 > 3 || Math.floor(st.rank / 10) === 1 ? 0 : st.rank % 10]} in the table` : null].filter(Boolean);
  return {
    title: `${t.name}${p.season ? ` ${p.season}` : ''}: Squad, Results, Fixtures and Stats${SUFFIX}`,
    description: clip(`${t.name}${t.country ? ` (${t.country})` : ''}${p.season ? ` ${p.season}` : ''}${bits.length ? `: ${bits.join(', ')}` : ''}. Squad with appearances, goals and ratings, every result and the next fixtures.`),
    canonical: abs(ctx, path), robots: !p.results.length && !p.fixtures.length ? NOINDEX : null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [
      ld('SportsTeam', { '@id': `${abs(ctx, proPaths.team(t.slug))}#team`, name: t.name, sport: 'Soccer', url: abs(ctx, path), logo: t.logo ?? undefined, gender: t.gender === 'w' ? 'Female' : t.gender === 'm' ? 'Male' : undefined, foundingDate: t.founded ? String(t.founded) : undefined,
        location: t.venue ? { '@type': 'Place', name: t.venue.name, address: t.venue.city ?? undefined } : undefined,
        memberOf: p.competitions.filter((c) => c.league).map((c) => ({ '@type': 'SportsOrganization', name: c.league!.name, url: abs(ctx, proPaths.league(c.league!.slug)) })),
        athlete: p.squad.slice(0, 40).map((s) => ({ '@type': 'Person', name: s.player.name, url: abs(ctx, proPaths.player(s.player.slug)) })) }),
      breadcrumbs(ctx, [...crumbsHome, ...(comp?.league ? [{ name: comp.league.name, path: proPaths.league(comp.league.slug) }] : []), { name: t.name, path: proPaths.team(t.slug) }]),
    ],
  };
}

export function proTeamBody(p: ProTeamPage): string {
  const t = p.team;
  const facts = [t.country, t.founded ? `founded ${t.founded}` : null, t.venue ? `home ground ${t.venue.name}${t.venue.city ? `, ${t.venue.city}` : ''}` : null].filter(Boolean).map((x) => esc(x)).join('; ');
  const comps = p.competitions.filter((c) => c.league).map((c) => `<li>${a(proPaths.league(c.league!.slug), c.league!.name)}: ${esc(`${c.w} won, ${c.d} drawn, ${c.l} lost, goals ${c.gf}-${c.ga}`)}</li>`).join('');
  const squad = p.squad.length ? `<h2>Squad${p.season ? ` ${esc(p.season)}` : ''}</h2>${table(`${t.name} squad`, ['Player', 'Pos', 'Apps', 'Min', 'G', 'A'], p.squad.map((s) => tr([a(proPaths.player(s.player.slug), s.player.name), esc(s.player.position ?? ''), n(s.apps), n(s.minutes), n(s.goals), n(s.assists)])))}` : '';
  const results = p.results.length ? `<h2>Results</h2><ul>${p.results.slice(0, 25).map((m) => `<li>${esc(day(m.kickoff))}: ${a(proPaths.match(m.slug), proScoreLine(m))} (${esc(m.league.name)})</li>`).join('')}</ul>` : '';
  const fixtures = p.fixtures.length ? `<h2>Fixtures</h2><ul>${p.fixtures.slice(0, 12).map((m) => `<li>${esc(day(m.kickoff))}: ${a(proPaths.match(m.slug), proMatchName(m))} (${esc(m.league.name)})</li>`).join('')}</ul>` : '';
  const inner = `<h1>${esc(t.name)}${p.season ? ` ${esc(p.season)}` : ''}</h1>${facts ? `<p>${facts}.</p>` : ''}${comps ? `<h2>Competitions</h2><ul>${comps}</ul>` : ''}${squad}${results}${fixtures}`;
  return wrapBody('pro', [...crumbsHome, { name: t.name, path: proPaths.team(t.slug) }], inner);
}

// ---------- players ----------
export function proPlayerHead(p: ProPlayerPage, ctx: HeadContext): HeadMeta {
  const pl = p.player;
  const canonical = abs(ctx, proPaths.player(pl.slug));
  const latest = p.seasons[0];
  const line = latest ? `${latest.season}${latest.league ? ` ${latest.league.name}` : ''}: ${latest.goals} goals, ${latest.assists} assists in ${latest.apps} appearances` : '';
  const college = p.college[0];
  const apps = p.seasons.reduce((s, x) => s + (x.apps ?? 0), 0);
  return {
    title: `${pl.name}${p.team ? ` (${p.team.name})` : ''}: Stats, Matches and Career${SUFFIX}`,
    description: clip(`${pl.name}${pl.position ? `, ${pl.position.toLowerCase()}` : ''}${p.team ? ` for ${p.team.name}` : ''}${pl.nationality ? `, ${pl.nationality}` : ''}.${line ? ` ${line}.` : ''}${college ? ` Played college soccer at ${college.college_name}.` : ''} Season-by-season stats and match ratings.`),
    canonical, robots: pl.noindex || apps === 0 ? NOINDEX : null, ogType: 'profile', image: ogImage(ctx),
    jsonLd: [
      ld('Person', { '@id': `${canonical}#person`, name: pl.name, url: canonical, birthDate: pl.birth_date ?? undefined, nationality: pl.nationality ?? undefined, height: pl.height_cm ? `${pl.height_cm} cm` : undefined,
        image: pl.photo && /^https:/.test(pl.photo) ? pl.photo : undefined, jobTitle: 'Professional soccer player',
        affiliation: p.team ? teamLd(ctx, p.team) : undefined,
        alumniOf: p.college.length ? p.college.map((c) => ({ '@type': 'CollegeOrUniversity', name: c.college_name })) : undefined }),
      breadcrumbs(ctx, [...crumbsHome, ...(p.team ? [{ name: p.team.name, path: proPaths.team(p.team.slug) }] : []), { name: pl.name, path: proPaths.player(pl.slug) }]),
    ],
  };
}

export function proPlayerBody(p: ProPlayerPage): string {
  const pl = p.player;
  const bio = [pl.position, pl.nationality, pl.birth_date ? `born ${longDate(pl.birth_date)}${pl.birth_place ? ` in ${pl.birth_place}` : ''}` : null, pl.height_cm ? `${pl.height_cm} cm` : null].filter(Boolean).map((x) => esc(x)).join(', ');
  const college = p.college.map((c) => `<p>Played college soccer at ${c.school_seo ? a(`/teams/${c.school_seo}/${pl.gender === 'w' ? 'women' : 'men'}`, c.college_name) : esc(c.college_name)}${c.first_season || c.last_season ? ` (${esc([c.first_season, c.last_season].filter(Boolean).join('-'))})` : ''}${c.college_player_slug ? `; ${a(`/players/${c.college_player_slug}`, 'college stats')}` : ''}.</p>`).join('');
  const seasons = p.seasons.length ? table(`${pl.name} season by season`, ['Season', 'Club', 'Competition', 'Apps', 'Min', 'G', 'A'], p.seasons.map((s) => tr([esc(s.season), s.team ? a(proPaths.team(s.team.slug), s.team.name) : '', s.league ? a(proPaths.league(s.league.slug), s.league.name) : '', n(s.apps), n(s.minutes), n(s.goals), n(s.assists)]))) : '<p>No season stats yet.</p>';
  const recent = p.matches.length ? `<h2>Recent matches</h2><ul>${p.matches.slice(0, 15).map((r) => `<li>${esc(day(r.match.kickoff))}: ${a(proPaths.match(r.match.slug), proIsFinal(r.match) ? proScoreLine(r.match) : proMatchName(r.match))}${r.minutes != null ? `, ${esc(r.minutes)} minutes` : ''}${r.goals ? `, ${esc(r.goals)} goal${r.goals > 1 ? 's' : ''}` : ''}</li>`).join('')}</ul>` : '';
  const inner = `<h1>${esc(pl.name)}</h1>${bio ? `<p>${bio}.</p>` : ''}${p.team ? `<p>Club: ${a(proPaths.team(p.team.slug), p.team.name)}.</p>` : ''}${college}<h2>Season stats</h2>${seasons}${recent}`;
  return wrapBody('pro', [...crumbsHome, ...(p.team ? [{ name: p.team.name, path: proPaths.team(p.team.slug) }] : []), { name: pl.name, path: proPaths.player(pl.slug) }], inner);
}

// ---------- matches ----------
const EVENT_STATUS: Record<string, string> = { postponed: 'https://schema.org/EventPostponed', cancelled: 'https://schema.org/EventCancelled' };
/** A final with only the score (no events, lineups or stats): kept for links, out of search. */
export const proIsThin = (p: ProMatchPage) => proIsFinal(p.match) && !p.events.length && !p.home.starters.length && !p.away.starters.length && !p.home.stats && !p.away.stats;

export function proMatchHead(p: ProMatchPage, ctx: HeadContext): HeadMeta {
  const m = p.match;
  const canonical = abs(ctx, proPaths.match(m.slug));
  const final = proIsFinal(m);
  const when = day(m.kickoff);
  const scorers = p.events.filter((e) => e.type === 'goal' && e.detail !== 'Missed Penalty' && e.player_name).map((e) => `${e.player_name} ${e.minute ?? ''}'`.trim()).slice(0, 6);
  const title = final ? `${proScoreLine(m)}, ${m.league.name}, ${when}${SUFFIX}` : `${proMatchName(m)}, ${m.league.name}, ${when}${SUFFIX}`;
  const description = clip(final
    ? `${proScoreLine(m)} in the ${m.league.name}${m.round ? ` (${m.round})` : ''}, ${when}${m.venue ? ` at ${m.venue}` : ''}. ${scorers.length ? `Goals: ${scorers.join('; ')}. ` : ''}Lineups, ratings and match stats.`
    : `${proMatchName(m)}, ${m.league.name}${m.round ? `, ${m.round}` : ''}, ${when}${m.venue ? ` at ${m.venue}` : ''}. Kickoff time, form and earlier meetings.`);
  const side = (s: Q.ProMatchSide) => teamLd(ctx, s);
  return {
    title, description, canonical,
    robots: proIsUnplayed(m) || proIsThin(p) ? NOINDEX : null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [
      ld('SportsEvent', { '@id': `${canonical}#event`, name: `${proMatchName(m)} (${m.league.name})`, sport: 'Soccer', url: canonical, startDate: m.kickoff,
        eventStatus: EVENT_STATUS[m.status] ?? 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: m.venue ? { '@type': 'Place', name: m.venue } : undefined, homeTeam: side(m.home), awayTeam: side(m.away), competitor: [side(m.home), side(m.away)],
        superEvent: { '@type': 'SportsEvent', name: m.league.name, url: abs(ctx, proPaths.league(m.league.slug)) }, description: final ? `Final: ${proScoreLine(m)}` : undefined }),
      breadcrumbs(ctx, [...crumbsHome, { name: m.league.name, path: proPaths.league(m.league.slug) }, { name: proMatchName(m), path: proPaths.match(m.slug) }]),
    ],
  };
}

export function proMatchBody(p: ProMatchPage): string {
  const m = p.match;
  const final = proIsFinal(m);
  const h1 = final || m.status === 'live' ? proScoreLine(m) : proMatchName(m);
  const facts = [a(proPaths.league(m.league.slug), m.league.name), m.round ? esc(m.round) : null, esc(day(m.kickoff)), m.venue ? esc(m.venue) : null, m.referee ? `referee ${esc(m.referee)}` : null, m.ht[0] != null && final ? `half-time ${esc(m.ht[0])}-${esc(m.ht[1])}` : null].filter(Boolean).join('; ');
  const events = p.events.filter((e) => e.type === 'goal' || e.type === 'card').map((e) => `<li>${esc(e.minute ?? '')}' ${e.type === 'goal' ? (e.detail === 'Missed Penalty' ? 'Missed penalty' : 'Goal') : esc(e.detail ?? 'Card')} (${esc(e.side === 'home' ? m.home.name : m.away.name)}): ${esc(e.player_name ?? '')}${e.type === 'goal' && e.assist_name && e.detail !== 'Own Goal' ? `, assisted by ${esc(e.assist_name)}` : ''}${e.detail === 'Own Goal' ? ' (own goal)' : e.detail === 'Penalty' ? ' (penalty)' : ''}</li>`).join('');
  const lineup = (name: string, s: ProMatchPage['home']) => (s.starters.length ? `<h3>${esc(name)}${s.formation ? ` (${esc(s.formation)})` : ''}</h3>${table(`${name} lineup`, ['#', 'Player', 'Pos', 'Min', 'G', 'A', 'Rating'], [...s.starters, ...s.bench.filter((b) => (b.minutes ?? 0) > 0)].map((l) => tr([esc(l.number ?? ''), l.slug ? a(proPaths.player(l.slug), l.display) : esc(l.display), esc(l.pos ?? ''), n(l.minutes), n(l.goals), n(l.assists), l.rating != null ? esc(Number(l.rating).toFixed(1)) : '–'])))}` : '');
  const stat = (k: string, label: string) => (p.home.stats?.[k] != null || p.away.stats?.[k] != null ? tr([esc(label), n(p.home.stats?.[k] as number | null), n(p.away.stats?.[k] as number | null)]) : '');
  const stats = p.home.stats || p.away.stats ? `<h2>Team stats</h2>${table('Team stats', ['', m.home.name, m.away.name], [stat('possession', 'Possession %'), stat('shots', 'Shots'), stat('shots_on', 'Shots on target'), stat('corners', 'Corners'), stat('fouls', 'Fouls'), stat('yellow', 'Yellow cards'), stat('red', 'Red cards')].filter(Boolean))}` : '';
  const h2h = p.h2h.length ? `<h2>Earlier meetings</h2><ul>${p.h2h.map((x) => `<li>${esc(day(x.kickoff))}: ${a(proPaths.match(x.slug), proScoreLine(x))} (${esc(x.league.name)})</li>`).join('')}</ul>` : '';
  const inner = `<h1>${esc(h1)}</h1><p>${a(proPaths.team(m.home.slug), m.home.name)} vs ${a(proPaths.team(m.away.slug), m.away.name)}. ${facts}.</p>${events ? `<h2>Goals and cards</h2><ol>${events}</ol>` : ''}${stats}${p.home.starters.length || p.away.starters.length ? `<h2>Lineups</h2>${lineup(m.home.name, p.home)}${lineup(m.away.name, p.away)}` : ''}${h2h}`;
  return wrapBody('pro', [...crumbsHome, { name: m.league.name, path: proPaths.league(m.league.slug) }, { name: proMatchName(m), path: proPaths.match(m.slug) }], inner);
}

// ---------- v2: directory, leaders, countries, College to Pro, transfers ----------
export type ProLeadersPage = Awaited<ReturnType<typeof Q.leaders>>;
export type ProCountriesPage = Awaited<ReturnType<typeof Q.countries>>;
export type ProCountryPage = NonNullable<Awaited<ReturnType<typeof Q.country>>>;
export type ProCollegePage = Awaited<ReturnType<typeof Q.collegeHub>>;
export type ProTransfersPage = Awaited<ReturnType<typeof Q.transfersFeed>>;

const leaderRows = (rows: ProLeadersPage['rows'], valueLabel: string) => table(valueLabel, ['#', 'Player', 'Club', 'Competition', 'Apps', valueLabel],
  rows.map((r) => tr([esc(r.rank), a(proPaths.player(r.player.slug), r.player.name), r.team ? a(proPaths.team(r.team.slug), r.team.name) : '', r.league ? a(proPaths.league(r.league.slug), r.league.name) : '', n(r.apps), n(r.value, r.value != null && r.value % 1 ? 2 : 0)])));

export function proDirectoryHead(kind: 'players' | 'leaders', p: ProLeadersPage, ctx: HeadContext): HeadMeta {
  const path = kind === 'players' ? '/pro/players' : '/pro/leaders';
  const top = p.rows.slice(0, 3).map((r) => r.player.name).join(', ');
  return {
    title: kind === 'players' ? `Pro Soccer Players: Find Any Player by Nationality, Position and Age${SUFFIX}` : `Pro Soccer Leaders: Goals, Assists and 20+ Stats${SUFFIX}`,
    description: clip(kind === 'players'
      ? `Every professional soccer player we follow, men's and women's, filtered by nationality, position, age and competition. Most minutes this season: ${top}.`
      : `This season's leaders across every professional competition: goals, assists, ratings, key passes, tackles, saves and more, in totals or per 90. Top scorers: ${top}.`),
    canonical: abs(ctx, path), robots: null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [ld('ItemList', { name: kind === 'players' ? 'Pro soccer players' : 'Pro soccer leaders', itemListElement: p.rows.slice(0, 20).map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(ctx, proPaths.player(r.player.slug)), name: r.player.name })) }),
      breadcrumbs(ctx, [...crumbsHome, { name: kind === 'players' ? 'Players' : 'Leaders', path }])],
  };
}
export function proDirectoryBody(kind: 'players' | 'leaders', p: ProLeadersPage): string {
  const label = kind === 'players' ? 'Minutes' : 'Goals';
  return wrapBody('pro', [...crumbsHome, { name: kind === 'players' ? 'Players' : 'Leaders', path: `/pro/${kind}` }],
    `<h1>${kind === 'players' ? 'Professional Soccer Players' : 'Professional Soccer Leaders'}</h1><p>${esc(p.total)} player seasons across every competition we follow.</p>${leaderRows(p.rows, label)}`);
}

export function proCountriesHead(cs: ProCountriesPage, ctx: HeadContext): HeadMeta {
  return { title: `Soccer by Country: Leagues, Clubs and Players${SUFFIX}`, description: clip(`Professional soccer in ${cs.length} countries and regions: every league, club and national player we follow, and who plays abroad.`),
    canonical: abs(ctx, '/pro/countries'), robots: null, ogType: 'website', image: ogImage(ctx), jsonLd: [breadcrumbs(ctx, [...crumbsHome, { name: 'Countries', path: '/pro/countries' }])] };
}
export function proCountriesBody(cs: ProCountriesPage): string {
  return wrapBody('pro', [...crumbsHome, { name: 'Countries', path: '/pro/countries' }], `<h1>Soccer by Country</h1><ul>${cs.map((c) => `<li>${a(`/pro/countries/${c.slug}`, c.name)}${c.leagues ? ` (${esc(c.leagues)} competitions)` : ''}</li>`).join('')}</ul>`);
}

export function proCountryHead(p: ProCountryPage, ctx: HeadContext): HeadMeta {
  const path = `/pro/countries/${p.country.slug}`;
  const abroad = p.abroad.slice(0, 3).map((r) => r.player.name).join(', ');
  return {
    title: `${p.country.name} Soccer: Leagues, Clubs and ${p.country.name} Players Abroad${SUFFIX}`,
    description: clip(`${p.country.name}: ${p.leagues.length} professional competitions and ${p.clubs.length} clubs we follow, and ${p.country.name} players at home and abroad${abroad ? `, including ${abroad}` : ''}.`),
    canonical: abs(ctx, path), robots: !p.leagues.length && !p.players.length ? NOINDEX : null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [breadcrumbs(ctx, [...crumbsHome, { name: 'Countries', path: '/pro/countries' }, { name: p.country.name, path }])],
  };
}
export function proCountryBody(p: ProCountryPage): string {
  const c = p.country.name;
  const leagues = p.leagues.length ? `<h2>Competitions</h2><ul>${p.leagues.map((l) => `<li>${a(proPaths.league(l.slug), l.name)}</li>`).join('')}</ul>` : '';
  const clubs = p.clubs.length ? `<h2>Clubs</h2><ul>${p.clubs.slice(0, 200).map((t) => `<li>${a(proPaths.team(t.slug), t.name)}</li>`).join('')}</ul>` : '';
  const abroad = p.abroad.length ? `<h2>${esc(c)} players abroad</h2>${leaderRows(p.abroad, 'Minutes')}` : '';
  return wrapBody('pro', [...crumbsHome, { name: 'Countries', path: '/pro/countries' }, { name: c, path: `/pro/countries/${p.country.slug}` }], `<h1>${esc(c)} Soccer</h1>${leagues}${abroad}${clubs}`);
}

export function proCollegeHead(p: ProCollegePage, ctx: HeadContext): HeadMeta {
  const top = p.groups.slice(0, 4).map((g) => g.school.name).join(', ');
  return {
    title: `College to Pro: ${p.total} Professional Soccer Players from NCAA Programs${SUFFIX}`,
    description: clip(`${p.total} professional soccer players who played NCAA college soccer, from ${p.schools} schools${top ? ` including ${top}` : ''}. Their pro clubs, stats and college careers.`),
    canonical: abs(ctx, '/pro/college'), robots: p.total ? null : NOINDEX, ogType: 'website', image: ogImage(ctx),
    jsonLd: [ld('ItemList', { name: 'College to Pro', itemListElement: p.groups.flatMap((g) => g.players).slice(0, 30).map((pl, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(ctx, proPaths.player(pl.slug)), name: pl.name })) }),
      breadcrumbs(ctx, [...crumbsHome, { name: 'College to Pro', path: '/pro/college' }])],
  };
}
export function proCollegeBody(p: ProCollegePage): string {
  const groups = p.groups.map((g) => `<h2>${g.school.seo ? a(`/teams/${g.school.seo}/${g.players[0]?.gender === 'w' ? 'women' : 'men'}`, g.school.name) : esc(g.school.name)}</h2><ul>${g.players.map((pl) => `<li>${a(proPaths.player(pl.slug), pl.name)}${pl.team ? `, ${a(proPaths.team(pl.team.slug), pl.team.name)}` : ''}${pl.college_years.length ? ` (college ${esc(pl.college_years.join('-'))})` : ''}</li>`).join('')}</ul>`).join('');
  return wrapBody('pro', [...crumbsHome, { name: 'College to Pro', path: '/pro/college' }], `<h1>College to Pro</h1><p>${esc(p.total)} professional players who played NCAA soccer, from ${esc(p.schools)} schools.</p>${groups}`);
}

export function proTransfersHead(rows: ProTransfersPage, ctx: HeadContext): HeadMeta {
  return { title: `Latest Soccer Transfers${SUFFIX}`, description: clip(`The latest professional soccer transfers and loans${rows[0] ? `, most recently ${rows[0].player.name} to ${rows[0].to.name}` : ''}.`),
    canonical: abs(ctx, '/pro/transfers'), robots: rows.length ? null : NOINDEX, ogType: 'website', image: ogImage(ctx), jsonLd: [breadcrumbs(ctx, [...crumbsHome, { name: 'Transfers', path: '/pro/transfers' }])] };
}
export function proTransfersBody(rows: ProTransfersPage): string {
  return wrapBody('pro', [...crumbsHome, { name: 'Transfers', path: '/pro/transfers' }], `<h1>Latest Transfers</h1><ul>${rows.map((r) => `<li>${esc(longDate(r.date))}: ${r.player.slug ? a(proPaths.player(r.player.slug), r.player.name) : esc(r.player.name)} from ${esc(r.from.name ?? 'unknown')} to ${esc(r.to.name ?? 'unknown')}${r.type ? ` (${esc(r.type)})` : ''}</li>`).join('')}</ul>`);
}
