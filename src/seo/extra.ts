// The pages added on 2026-10-14 (Conferences, Leaders, Players, Transfers and coaches for college; clubs, club
// rankings and coaches for Pro), server-rendered for search engines and no-JavaScript readers like the older ones:
// a title, a canonical, breadcrumbs and an escaped summary with real names, numbers and links. Data from the same
// queries the app uses.
import type { Db } from '../db/client.js';
import { selectAll, selectIn } from '../db/client.js';
import type { SitemapEntry } from './types.js';
import * as q from '../ui/queries.js';
import * as pro from '../pro/queries.js';
import { collegeElo, proElo } from '../ui/elo.js';
import { rpiTable } from '../ui/rpi.js';
import { abs, breadcrumbs, ogImage, SUFFIX, type HeadContext, type HeadMeta } from './head.js';
import { a, n, table, tr, wrapBody } from './body.js';
import { clip, conferencePath, esc, playerPath, SITE_NAME, teamPath } from './util.js';
import { proPaths } from './pro/pages.js';
import { collegeReferee, collegeRefereeList, proReferee, proRefereeList } from '../referees.js';

const G = { m: "Men's", w: "Women's" } as const;
const month = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : null);
const many = (v: number | null | undefined, one: string) => `${v ?? 0} ${(v ?? 0) === 1 ? one : `${one}s`}`;
const page = (ctx: HeadContext, path: string, title: string, description: string, crumbs: { name: string; path: string }[]): HeadMeta => ({
  title, description: clip(description), canonical: abs(ctx, path), robots: null, ogType: 'website', image: ogImage(ctx), jsonLd: [breadcrumbs(ctx, crumbs)],
});
const college = [{ name: SITE_NAME, path: '/' }];
const proHome = [{ name: SITE_NAME, path: '/' }, { name: 'Pro', path: '/pro/matches' }];

/** Player slugs for links (the leaders view carries ids). */
async function slugs(db: Db, ids: string[]): Promise<Map<string, string>> {
  return new Map((ids.length ? await selectIn<any>(db, 'college_players', 'id,slug', 'id', [...new Set(ids)]) : []).filter((p) => p.slug).map((p) => [p.id, p.slug]));
}

export function makeExtraSeo(db: Db) {
  return {
    async conferences(season: number) {
      const cs = await q.conferences(db, { season });
      return { season, conferences: cs };
    },
    async leaders(season: number) {
      const lists: { gender: 'm' | 'w'; stat: string; rows: any[] }[] = [];
      for (const gender of ['m', 'w'] as const) for (const stat of ['goals', 'assists', 'points']) lists.push({ gender, stat, rows: (await q.leaders(db, { season, gender, stat, limit: 25 })).rows });
      const sl = await slugs(db, lists.flatMap((l) => l.rows.map((r) => r.player_id)));
      return { season, lists, slugs: sl };
    },
    async players(season: number) {
      const lists: { gender: 'm' | 'w'; rows: any[] }[] = [];
      for (const gender of ['m', 'w'] as const) lists.push({ gender, rows: (await q.leaders(db, { season, gender, stat: 'minutes', limit: 100 })).rows });
      return { season, lists, slugs: await slugs(db, lists.flatMap((l) => l.rows.map((r) => r.player_id))) };
    },
    async transfers(season: number) {
      const lists: { gender: 'm' | 'w'; rows: any[] }[] = [];
      for (const gender of ['m', 'w'] as const) lists.push({ gender, rows: (await q.transfersFeed(db, { season, gender, limit: 100 })).rows });
      return { season, lists };
    },
    coach: (id: string) => q.coach(db, id),
    async proTeams() {
      return { m: await pro.teamsList(db, { gender: 'm', scope: 'us' }), w: await pro.teamsList(db, { gender: 'w', scope: 'us' }) };
    },
    async proRankings() {
      return { us: await proElo(db, { gender: 'm', country: 'USA', limit: 50 }), world: await proElo(db, { gender: 'm', limit: 50 }), women: await proElo(db, { gender: 'w', country: 'USA', limit: 30 }) };
    },
    proCoach: (id: number) => pro.proCoach(db, id),
    /** The /rankings page's live RPI and Plaibook Elo (Division I, top 25 each, men's and women's). */
    async collegeRatings() {
      const out: { gender: 'm' | 'w'; rpi: any[]; elo: any[] }[] = [];
      for (const gender of ['m', 'w'] as const) {
        const [r, e] = await Promise.all([rpiTable(db, { gender, division: 'd1', limit: 25 }), collegeElo(db, { gender, division: 'd1', limit: 25 })]);
        out.push({ gender, rpi: r.rows, elo: e.rows });
      }
      return out;
    },
    /** Referees (migration 187): the busiest this season, and one referee's page. */
    async proReferees() {
      const base = { league: null, season: null, current: true, q: null, min: 5, sort: 'matches', limit: 100, offset: 0 };
      return { m: await proRefereeList(db, { ...base, gender: 'm' }), w: await proRefereeList(db, { ...base, gender: 'w', limit: 40 }) };
    },
    proReferee: (slug: string) => proReferee(db, slug),
    async collegeReferees(season: number) {
      const base = { season, division: null, q: null, min: 5, sort: 'games', limit: 100, offset: 0 };
      return { season, m: await collegeRefereeList(db, { ...base, gender: 'm' }), w: await collegeRefereeList(db, { ...base, gender: 'w' }) };
    },
    collegeReferee: (slug: string) => collegeReferee(db, slug),
    /** College coaches of the last two seasons, pro coaches who have a club, and referees with enough matches to mean
     *  something (pro 10, college 5). */
    async sitemapCoaches(): Promise<SitemapEntry[]> {
      const season = Math.max(...(await selectAll<any>(db, 'college_coach_seasons', 'season', (qq) => qq.order('season', { ascending: false }).limit(1))).map((r) => r.season), 0);
      const [c, p] = await Promise.all([
        selectAll<any>(db, 'college_coach_seasons', 'coach_id', (qq) => qq.gte('season', season - 1).order('coach_id')),
        selectAll<any>(db, 'pro_coaches', 'id', (qq) => qq.not('team_id', 'is', null).order('id')),
      ]);
      const [pr, cr] = await Promise.all([
        selectAll<any>(db, 'pro_referees', 'slug', (qq) => qq.gte('matches', 10).order('slug')).catch(() => []),
        selectAll<any>(db, 'college_referees', 'slug', (qq) => qq.gte('games', 5).order('slug')).catch(() => []),
      ]);
      return [...[...new Set(c.map((r) => r.coach_id))].map((id) => ({ path: `/coaches/${id}` })), ...p.map((r) => ({ path: `/pro/coaches/${r.id}` })),
        ...pr.map((r) => ({ path: `/pro/referees/${r.slug}` })), ...cr.map((r) => ({ path: `/referees/${r.slug}` }))];
    },
  };
}
export type ExtraSeo = ReturnType<typeof makeExtraSeo>;
type P<K extends keyof ExtraSeo> = NonNullable<Awaited<ReturnType<ExtraSeo[K]>>>;

// ---------- college ----------
export function conferencesHead(d: P<'conferences'>, ctx: HeadContext) {
  return page(ctx, '/conferences', `College Soccer Conferences and Standings ${d.season}${SUFFIX}`, `All ${d.conferences.length} NCAA soccer conferences for ${d.season}, Division I to III, men's and women's: members, table leaders and full standings.`, [...college, { name: 'Conferences', path: '/conferences' }]);
}
export function conferencesBody(d: P<'conferences'>, ctx: HeadContext) {
  const parts: string[] = [];
  for (const div of ['d1', 'd2', 'd3']) {
    const list = d.conferences.filter((c) => c.division === div);
    if (!list.length) continue;
    parts.push(`<h2>Division ${div === 'd1' ? 'I' : div === 'd2' ? 'II' : 'III'}</h2><ul>${list.map((c) => {
      const top = (['m', 'w'] as const).map((g) => (c.table[g]?.top?.[0] ? `${G[g]} leader ${esc(c.table[g]!.top[0].name)}` : null)).filter(Boolean).join('; ');
      const members = (['m', 'w'] as const).filter((g) => c.members[g]).map((g) => `${c.members[g]} ${G[g].toLowerCase()}`).join(', ');
      return `<li>${c.ncaa_seo ? a(conferencePath(c.ncaa_seo, d.season, ctx.currentSeason), c.name) : esc(c.name)}: ${esc(members)} teams${top ? `. ${top}` : ''}</li>`;
    }).join('')}</ul>`);
  }
  return wrapBody('conference', [...college, { name: 'Conferences', path: '/conferences' }], `<h1>College Soccer Conferences ${esc(d.season)}</h1><p>Every NCAA soccer conference, with its members and who leads the table. Open one for its standings, matches, players and teams.</p>${parts.join('')}`);
}

const LABEL: Record<string, string> = { goals: 'Goals', assists: 'Assists', points: 'Points' };
export function leadersHead(d: P<'leaders'>, ctx: HeadContext) {
  const top = d.lists.find((l) => l.gender === 'm' && l.stat === 'goals')?.rows[0];
  return page(ctx, '/leaders', `College Soccer Stat Leaders ${d.season}: Goals, Assists, Points${SUFFIX}`, `NCAA soccer leaders for ${d.season}, men's and women's, every division${top ? `. ${top.display_name} of ${top.program_name} leads the men in goals with ${top.goals}` : ''}.`, [...college, { name: 'Leaders', path: '/leaders' }]);
}
export function leadersBody(d: P<'leaders'>, ctx: HeadContext) {
  const lists = d.lists.map((l) => `<h2>${G[l.gender]} ${LABEL[l.stat]}</h2>${table(`${G[l.gender]} ${LABEL[l.stat]!.toLowerCase()} leaders ${d.season}`, ['#', 'Player', 'Team', LABEL[l.stat]!, 'Games'],
    l.rows.map((r, i) => tr([n(i + 1), d.slugs.get(r.player_id) ? a(playerPath(d.slugs.get(r.player_id)!), r.display_name) : esc(r.display_name), r.school_seo ? a(teamPath({ school_seo: r.school_seo, gender: r.gender }, d.season, ctx.currentSeason), r.program_name) : esc(r.program_name), n(r[l.stat]), n(r.gp)])))}`).join('');
  return wrapBody('rankings', [...college, { name: 'Leaders', path: '/leaders' }], `<h1>College Soccer Leaders ${esc(d.season)}</h1><p>Goals, assists and points across every NCAA division, men's and women's. Every other stat, per 90 and by position or class, is on the page.</p>${lists}`);
}

export function playersHead(d: P<'players'>, ctx: HeadContext) {
  return page(ctx, '/players', `College Soccer Players ${d.season}${SUFFIX}`, `Every NCAA soccer player who has played in ${d.season}, men's and women's: minutes, goals, assists and points per 90, PPG and PPS.`, [...college, { name: 'Players', path: '/players' }]);
}
export function playersBody(d: P<'players'>, ctx: HeadContext) {
  const lists = d.lists.map((l) => `<h2>${G[l.gender]} players, most minutes</h2><ul>${l.rows.map((r) => `<li>${d.slugs.get(r.player_id) ? a(playerPath(d.slugs.get(r.player_id)!), r.display_name) : esc(r.display_name)}, ${r.school_seo ? a(teamPath({ school_seo: r.school_seo, gender: r.gender }, d.season, ctx.currentSeason), r.program_name) : esc(r.program_name)}: ${esc(r.minutes)} minutes, ${many(r.goals, 'goal')}, ${many(r.assists, 'assist')}</li>`).join('')}</ul>`).join('');
  return wrapBody('rankings', [...college, { name: 'Players', path: '/players' }], `<h1>College Soccer Players ${esc(d.season)}</h1>${lists}`);
}

export function transfersHead(d: P<'transfers'>, ctx: HeadContext) {
  const total = d.lists.reduce((s, l) => s + l.rows.length, 0);
  return page(ctx, '/transfers', `College Soccer Transfers ${d.season}${SUFFIX}`, `NCAA soccer players at a new school in ${d.season}, men's and women's: where they came from and what they have done since${total ? ` (${total} latest moves listed)` : ''}.`, [...college, { name: 'Transfers', path: '/transfers' }]);
}
export function transfersBody(d: P<'transfers'>, ctx: HeadContext) {
  const side = (s: any, season: number) => (s ? (s.seo ? a(teamPath({ school_seo: s.seo, gender: s.gender }, season, ctx.currentSeason), s.name) : esc(s.name)) : 'another school');
  const lists = d.lists.map((l) => `<h2>${G[l.gender]} transfers</h2><ul>${l.rows.map((r) => `<li>${r.player.slug ? a(playerPath(r.player.slug), r.player.name) : esc(r.player.name)}: ${side(r.from, r.from_season)} to ${side(r.to, r.to_season)}${r.line?.gp ? ` (${many(r.line.gp, 'game')}, ${many(r.line.goals, 'goal')}, ${many(r.line.assists, 'assist')})` : ''}</li>`).join('')}</ul>`).join('');
  return wrapBody('rankings', [...college, { name: 'Transfers', path: '/transfers' }], `<h1>College Soccer Transfers ${esc(d.season)}</h1><p>Players found at a new school this season, matched across rosters by name, hometown and bio.</p>${lists}`);
}

export function coachHead(d: P<'coach'>, id: string, ctx: HeadContext) {
  const s = d.seasons[0];
  return page(ctx, `/coaches/${id}`, `${d.coach.name}${s?.program ? `, ${s.program.name} soccer` : ''}${SUFFIX}`, `${d.coach.name}: ${s?.title ?? 'coach'}${s?.program ? ` at ${s.program.name}` : ''}${d.head_record ? `, ${d.head_record.w}-${d.head_record.l}-${d.head_record.t} as head coach over ${d.head_record.seasons} seasons` : ''}.`, [...college, { name: d.coach.name, path: `/coaches/${id}` }]);
}
export function coachBody(d: P<'coach'>, id: string, ctx: HeadContext) {
  const rows = d.seasons.map((s) => tr([n(s.season), s.program?.seo ? a(teamPath({ school_seo: s.program.seo, gender: s.program.gender }, s.season, ctx.currentSeason), s.program.name) : esc(s.program?.name ?? ''), esc(s.title ?? ''), s.record ? esc(`${s.record.w}-${s.record.l}-${s.record.t}`) : '']));
  return wrapBody('team', [...college, { name: d.coach.name, path: `/coaches/${id}` }], `<h1>${esc(d.coach.name)}</h1>${d.head_record ? `<p>${esc(d.head_record.w)}-${esc(d.head_record.l)}-${esc(d.head_record.t)} as head coach over the ${esc(d.head_record.seasons)} seasons we hold.</p>` : ''}${table('Seasons', ['Season', 'Team', 'Title', 'Record'], rows)}`);
}

// ---------- pro ----------
export function proTeamsHead(d: P<'proTeams'>, ctx: HeadContext) {
  const n2 = d.m.groups.reduce((s, g) => s + g.teams.length, 0);
  return page(ctx, '/pro/teams', `US Pro Soccer Clubs: MLS, USL, NWSL and More${SUFFIX}`, `Every club in the US leagues we follow, ${n2} men's clubs and the women's: MLS, USL Championship, League One, MLS NEXT Pro, the NWSL and USL Super League.`, [...proHome, { name: 'Teams', path: '/pro/teams' }]);
}
export function proTeamsBody(d: P<'proTeams'>) {
  const groups = [...d.m.groups, ...d.w.groups].map((g) => `<h2>${a(proPaths.league(g.league.slug), g.league.name)}</h2><ul>${g.teams.map((t) => `<li>${a(proPaths.team(t.slug), t.name)}</li>`).join('')}</ul>`).join('');
  return wrapBody('pro', [...proHome, { name: 'Teams', path: '/pro/teams' }], `<h1>US Pro Soccer Clubs</h1>${groups}`);
}

export function proRankingsHead(d: P<'proRankings'>, ctx: HeadContext) {
  const top = d.us.rows[0];
  return page(ctx, '/pro/rankings', `Club Soccer Rankings: Plaibook Elo${SUFFIX}`, `Plaibook Elo for every professional club from every result since 2023${top ? `. Top US club: ${top.team.name}, ${top.rating}` : ''}.`, [...proHome, { name: 'Rankings', path: '/pro/rankings' }]);
}
export function proRankingsBody(d: P<'proRankings'>) {
  const t = (title: string, rows: any[], world: boolean) => table(title, ['#', 'Club', world ? 'Country' : 'World rank', 'Rating'], rows.map((r) => tr([n(r.rank), r.team.slug ? a(proPaths.team(r.team.slug), r.team.name) : esc(r.team.name), world ? esc(r.country ?? '') : n(r.world_rank), n(r.rating)])));
  return wrapBody('pro', [...proHome, { name: 'Rankings', path: '/pro/rankings' }], `<h1>Club Rankings: Plaibook Elo</h1><p>Our own rating, worked out from every club result since 2023 in every competition we follow.</p><h2>US men's clubs</h2>${t('US clubs', d.us.rows, false)}<h2>World</h2>${t('World', d.world.rows, true)}<h2>US women's clubs</h2>${t('US women\'s clubs', d.women.rows, false)}`);
}

export function proCoachHead(d: P<'proCoach'>, id: number, ctx: HeadContext) {
  const now = d.career.find((c) => c.current);
  return page(ctx, `/pro/coaches/${id}`, `${d.coach.name}${now ? `, ${now.team.name} coach` : ''}${SUFFIX}`, `${d.coach.name}${now ? `, in charge of ${now.team.name}` : ''}${d.trophies.length ? `, ${many(d.trophies.length, 'trophy').replace('trophys', 'trophies')} as coach` : ''}. Every club managed, with dates.`, [...proHome, { name: d.coach.name, path: `/pro/coaches/${id}` }]);
}
export function proCoachBody(d: P<'proCoach'>, id: number) {
  const career = d.career.map((c) => `<li>${c.team.slug ? a(proPaths.team(c.team.slug), c.team.name) : esc(c.team.name)}: ${esc(month(c.start) ?? 'unknown')} to ${esc(month(c.end) ?? 'now')}</li>`).join('');
  const trophies = d.trophies.map((t) => `<li>${esc(t.league)}${t.country ? `, ${esc(t.country)}` : ''} ${esc(t.season)}</li>`).join('');
  return wrapBody('pro', [...proHome, { name: d.coach.name, path: `/pro/coaches/${id}` }], `<h1>${esc(d.coach.name)}</h1>${career ? `<h2>Career</h2><ul>${career}</ul>` : ''}${trophies ? `<h2>Trophies as coach</h2><ul>${trophies}</ul>` : ''}`);
}

// ---------- referees ----------
const pct = (v: number | null | undefined) => (v == null ? '' : `${Math.round(Number(v) * 100)}%`);
const dec = (v: number | null | undefined, d = 2) => (v == null ? '' : Number(v).toFixed(d));

export function proRefereesHead(d: P<'proReferees'>, ctx: HeadContext) {
  const top = d.m.rows[0];
  return page(ctx, '/pro/referees', `Soccer Referee Stats: Cards, Penalties, VAR${SUFFIX}`, `Referees in every competition we follow this season: cards, penalties, fouls and VAR checks a match, and how often the home side wins${top ? `. ${top.name} has refereed ${top.matches} matches` : ''}.`, [...proHome, { name: 'Referees', path: '/pro/referees' }]);
}
export function proRefereesBody(d: P<'proReferees'>) {
  const t = (title: string, rows: any[]) => table(title, ['Referee', 'Country', 'Matches', 'Cards a match', 'Penalties a match', 'Home wins'], rows.map((r) => tr([a(`/pro/referees/${r.slug}`, r.name), esc(r.country ?? ''), n(r.matches), esc(dec(r.cards_pg)), esc(dec(r.pens_pg)), esc(pct(r.home_pct))])));
  return wrapBody('pro', [...proHome, { name: 'Referees', path: '/pro/referees' }], `<h1>Referee Stats</h1><p>Every referee with five or more matches this season, from the referee named on each match and its card, penalty and VAR events.</p><h2>Men's</h2>${t("Men's referees", d.m.rows)}${d.w.rows.length ? `<h2>Women's</h2>${t("Women's referees", d.w.rows)}` : ''}`);
}
export function proRefereeHead(d: P<'proReferee'>, slug: string, ctx: HeadContext) {
  const c = d.career, main = d.seasons[0]?.league?.name;
  return page(ctx, `/pro/referees/${slug}`, `${d.referee.name}, Referee Stats${SUFFIX}`, `${d.referee.name}${d.referee.country ? ` (${d.referee.country})` : ''}${main ? `, mostly ${main}` : ''}: ${c.matches} matches, ${dec(c.cards_pg)} cards and ${dec(c.pens_pg)} penalties a match, home side wins ${pct(c.home_pct)}.`, [...proHome, { name: 'Referees', path: '/pro/referees' }, { name: d.referee.name, path: `/pro/referees/${slug}` }]);
}
export function proRefereeBody(d: P<'proReferee'>, slug: string) {
  const c = d.career;
  const seasons = table('By competition and season', ['Competition', 'Season', 'Matches', 'Cards a match', 'Average'], d.seasons.slice(0, 30).map((s: any) => tr([s.league ? a(proPaths.league(s.league.slug), s.league.name) : '', n(s.season), n(s.matches), esc(dec(s.cards_pg)), esc(dec(s.average?.cards_pg))])));
  const recent = d.recent.slice(0, 15).map((x: any) => `<li>${a(proPaths.match(x.match.slug), `${x.match.home.name} ${x.match.home.score ?? ''}-${x.match.away.score ?? ''} ${x.match.away.name}`)}, ${esc(x.match.league?.name ?? '')}${x.yellow != null ? `: ${many(x.yellow, 'yellow card')}` : ''}</li>`).join('');
  return wrapBody('pro', [...proHome, { name: 'Referees', path: '/pro/referees' }, { name: d.referee.name, path: `/pro/referees/${slug}` }], `<h1>${esc(d.referee.name)}</h1><p>${esc(c.matches)} matches in our records: ${esc(dec(c.cards_pg))} cards (average ${esc(dec(d.peer?.cards_pg))}), ${esc(dec(c.pens_pg))} penalties and ${esc(dec(c.fouls_pg, 1))} fouls a match; the home side won ${esc(pct(c.home_pct))}.</p>${seasons}${recent ? `<h2>Latest matches</h2><ul>${recent}</ul>` : ''}`);
}

export function collegeRefereesHead(d: P<'collegeReferees'>, ctx: HeadContext) {
  return page(ctx, '/referees', `College Soccer Referee Stats ${d.season}${SUFFIX}`, `NCAA soccer referees in ${d.season}, men's and women's: cards, fouls and penalty kicks a game and how often the home side wins, from the box scores that name them.`, [...college, { name: 'Referees', path: '/referees' }]);
}
export function collegeRefereesBody(d: P<'collegeReferees'>) {
  const t = (title: string, rows: any[]) => table(title, ['Referee', 'Games', 'Cards a game', 'Fouls a game', 'Home wins'], rows.map((r) => tr([a(`/referees/${r.slug}`, r.name), n(r.games), esc(dec(r.cards_pg)), esc(dec(r.fouls_pg, 1)), esc(pct(r.home_pct))])));
  return wrapBody('rankings', [...college, { name: 'Referees', path: '/referees' }], `<h1>College Soccer Referees ${esc(d.season)}</h1><p>Referees with five or more games this season whose box scores name them.</p>${d.m.rows.length ? `<h2>Men's</h2>${t("Men's referees", d.m.rows)}` : ''}${d.w.rows.length ? `<h2>Women's</h2>${t("Women's referees", d.w.rows)}` : ''}`);
}
export function collegeRefereeHead(d: P<'collegeReferee'>, slug: string, ctx: HeadContext) {
  const c = d.career;
  return page(ctx, `/referees/${slug}`, `${d.referee.name}, College Soccer Referee${SUFFIX}`, `${d.referee.name}: ${c.games} college games, ${dec(c.cards_pg)} cards and ${dec(c.fouls_pg, 1)} fouls a game, home side wins ${pct(c.home_pct)}.`, [...college, { name: 'Referees', path: '/referees' }, { name: d.referee.name, path: `/referees/${slug}` }]);
}
export function collegeRefereeBody(d: P<'collegeReferee'>, slug: string) {
  const c = d.career;
  const recent = d.recent.slice(0, 15).map((x: any) => `<li>${a(`/matches/${x.match.id}`, `${x.match.away.name} ${x.match.away.score ?? ''} at ${x.match.home.name} ${x.match.home.score ?? ''}`)}, ${esc(x.match.game_date)}</li>`).join('');
  return wrapBody('rankings', [...college, { name: 'Referees', path: '/referees' }, { name: d.referee.name, path: `/referees/${slug}` }], `<h1>${esc(d.referee.name)}</h1><p>${esc(c.games)} games in our records: ${esc(dec(c.cards_pg))} cards (average ${esc(dec(d.peer?.cards_pg))}) and ${esc(dec(c.fouls_pg, 1))} fouls a game; the home side won ${esc(pct(c.home_pct))}.</p>${recent ? `<h2>Latest games</h2><ul>${recent}</ul>` : ''}`);
}

/** Appended to the /rankings page: live RPI and Plaibook Elo, Division I. */
export function collegeRatingsBody(d: P<'collegeRatings'>): string {
  const team = (p: { name: string; seo: string | null }, g: 'm' | 'w') => (p.seo ? a(teamPath({ school_seo: p.seo, gender: g }), p.name) : esc(p.name));
  return d.map((x) => `${x.rpi.length ? `<h2>${G[x.gender]} Division I RPI (live)</h2>${table(`${G[x.gender]} Division I RPI`, ['#', 'Team', 'Record', 'RPI'], x.rpi.map((r) => tr([n(r.rank), team(r.program, x.gender), esc(`${r.record.w}-${r.record.l}-${r.record.t}`), n(r.rpi, 4)])))}` : ''}${x.elo.length ? `<h2>${G[x.gender]} Division I Plaibook Elo</h2>${table(`${G[x.gender]} Division I Plaibook Elo`, ['#', 'Team', 'Rating'], x.elo.map((r) => tr([n(r.division_rank), team(r.program, x.gender), n(r.rating)])))}` : ''}`).join('');
}
