// openfootball-sync: results from openfootball (github.com/openfootball, public domain) for every league in
// OF_LEAGUES (MLS from 2005, the main European leagues and cups, Brazil, Argentina, Mexico), stored as source records
// (pro_src_games, clubs by name). source-map and source-check then match them to API-Football and compare scores on
// the seasons both have. Finished seasons are read once; the season in play on every run.
// history-fill: seasons a source has and API-Football does not (MLS 2005-2011 from openfootball, NWSL 2016-2018 from
// American Soccer Analysis) become ordinary pro matches (negative ids, fixtures.source = the source), with an overall
// table from the results, but only while that source agrees with API-Football on 99%+ of the scores both have. Clubs
// API-Football does not know get a negative-id club of their own.
import { createHash } from 'node:crypto';
import { registerJob, type JobContext } from '../runner.js';
import { makeFetcher } from '../fetcher.js';
import { selectAll, upsertChunked } from '../../db/client.js';
import { patchSeason, refreshAggregates, upsertFixtures, upsertStandings } from '../../db/proRepo.js';
import { patchSourceSeason, sourceIdMap, upsertSrcGames, upsertSrcTeams } from '../../db/sourceRepo.js';
import { finalScore, parseSeasonFile, type OfMatch } from '../../sources/openfootball/parse.js';
import { OF_LEAGUES, OF_RAW, ofClub, type OfLeague } from '../../sources/openfootball/leagues.js';
import { WIKI_TARGETS } from './wikipedia.js';
import { FD_LEAGUES } from '../../sources/footballData/parse.js';
import { sourcesOff } from '../../pro/sources.js';
import { isRegularRound } from './checks.js';
import type { SrcGameRow } from '../../sources/asa/parse.js';
import type { FixtureRow, StandingRow } from '../../sources/apiFootball/parse.js';
import { teamDisplayName } from '../../sources/apiFootball/leagues.js';

export const OF_SOURCE = 'openfootball';
const MLS = 253;
export const HISTORY_TRUST = 0.99;

/** A stable negative id from a key (never clashes with API-Football's positive ids). */
export const negativeId = (key: string, bits = 31): number => -(parseInt(createHash('sha1').update(key).digest('hex').slice(0, 8), 16) % 2 ** bits || 1);

/** ISO kickoff: openfootball times are local and zoneless; the league's usual offset keeps the date right. */
const kickoffOf = (m: OfMatch, tz = '-05:00') => new Date(`${m.date}T${m.time ?? '19:00'}:00${tz}`).toISOString();

/** l: the league (MLS keeps its plain ids and names from before the worldwide sync). */
export function toSrcGame(m: OfMatch, at: string, l: Pick<OfLeague, 'league' | 'country' | 'tz'> = { league: MLS, country: null, tz: '-05:00' }): SrcGameRow & Record<string, unknown> {
  const s = finalScore(m);
  const home = ofClub(m.home, l).ext_id, away = ofClub(m.away, l).ext_id;
  return {
    source: OF_SOURCE, ext_id: l.league === MLS ? `${m.season}|${m.date}|${m.home}|${m.away}` : `${l.league}|${m.season}|${m.date}|${home}|${away}`,
    league_id: l.league, season: m.season, kickoff: kickoffOf(m, l.tz), home_ext: home, away_ext: away,
    home_score: s?.[0] ?? null, away_score: s?.[1] ?? null, home_xg: null, away_xg: null, attendance: null, stadium_ext: null, referee_ext: null, home_manager_ext: null, away_manager_ext: null,
    matchday: null, knockout: m.playoffs, status: m.status === 'final' ? 'final' : m.status === 'cancelled' ? 'other' : 'scheduled', updated_at: at,
    round: m.round, ht_home: m.ht?.[0] ?? null, ht_away: m.ht?.[1] ?? null, et_home: m.aet?.[0] ?? null, et_away: m.aet?.[1] ?? null, pen_home: m.pen?.[0] ?? null, pen_away: m.pen?.[1] ?? null,
  };
}

/** params: { league?: number, from?: number, to?: number, force?: boolean } */
export async function openfootballSync(ctx: JobContext): Promise<void> {
  const f = makeFetcher(ctx.db);
  const targets = OF_LEAGUES.filter((l) => !Number(ctx.params.league) || l.league === Number(ctx.params.league));
  const current = new Map((await selectAll<{ id: number; current_season: number | null }>(ctx.db, 'pro_leagues', 'id,current_season', (q) => q.in('id', targets.map((t) => t.league)))).map((l) => [l.id, l.current_season]));
  const done = new Set((await selectAll<{ league_id: number; season: number }>(ctx.db, 'pro_source_seasons', 'league_id,season', (q) => q.eq('source', OF_SOURCE).not('synced_at', 'is', null))).map((r) => `${r.league_id}|${r.season}`));
  for (const l of targets) {
    const cur = current.get(l.league) ?? new Date().getUTCFullYear();
    const to = Math.min(Number(ctx.params.to) || cur, cur);
    for (let season = Math.max(Number(ctx.params.from) || l.first, l.first); season <= to; season += 1) {
      if (await ctx.cancelled()) return;
      // A finished season is read once; the season in play (and the one before, for late corrections) every run.
      if (done.has(`${l.league}|${season}`) && season < cur - 1 && !ctx.params.force) continue;
      let res: Awaited<ReturnType<typeof f.get>>;
      try { res = await f.get(`${OF_RAW}/${l.path(season)}`, { accept: 'text/plain', noStore: true, skipCache: true, attempts: 2 }); }
      catch (err) {
        // No file for a season (not published yet, or never kept) is not an error.
        // A finished season's file that is not there is recorded as read with nothing in it, so it is not asked again.
        if ((err as { status?: number }).status === 404) {
          ctx.inc('seasons_missing');
          if (season < cur) await patchSourceSeason(ctx.db, OF_SOURCE, l.league, season, { synced_at: new Date().toISOString(), games: 0, player_rows: 0, calls: 1, last_error: null });
          continue;
        }
        ctx.inc('errors');
        await patchSourceSeason(ctx.db, OF_SOURCE, l.league, season, { last_error: String(err instanceof Error ? err.message : err).slice(0, 500) });
        continue;
      }
      const at = new Date().toISOString();
      const matches = parseSeasonFile(res.text, season);
      const clubs = new Map(matches.flatMap((m) => [ofClub(m.home, l), ofClub(m.away, l)]).map((c) => [c.ext_id, c]));
      await upsertSrcTeams(ctx.db, [...clubs.values()].map((c) => ({ source: OF_SOURCE, ext_id: c.ext_id, league_id: l.league, name: c.name, short_name: null, abbr: null, updated_at: at })));
      await upsertSrcGames(ctx.db, matches.map((m) => toSrcGame(m, at, l)));
      await patchSourceSeason(ctx.db, OF_SOURCE, l.league, season, { synced_at: at, games: matches.length, player_rows: 0, calls: 1, last_error: null });
      ctx.inc('seasons'); ctx.inc('games', matches.length);
      await ctx.heartbeat();
    }
  }
}

/** A regular season's overall table from its results: 3 points a win, then goal difference, then goals. */
export function tableFromResults(games: { home: number; away: number; hg: number; ag: number }[], league: number, season: number, group = 'Overall'): StandingRow[] {
  const t = new Map<number, { played: number; win: number; draw: number; lose: number; gf: number; ga: number }>();
  const row = (id: number) => { let r = t.get(id); if (!r) { r = { played: 0, win: 0, draw: 0, lose: 0, gf: 0, ga: 0 }; t.set(id, r); } return r; };
  for (const g of games) {
    const h = row(g.home), a = row(g.away);
    h.played += 1; a.played += 1; h.gf += g.hg; h.ga += g.ag; a.gf += g.ag; a.ga += g.hg;
    if (g.hg > g.ag) { h.win += 1; a.lose += 1; } else if (g.hg < g.ag) { a.win += 1; h.lose += 1; } else { h.draw += 1; a.draw += 1; }
  }
  return [...t.entries()].map(([team_id, r]) => ({ ...r, team_id, points: r.win * 3 + r.draw, gd: r.gf - r.ga }))
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf)
    .map((r, i) => ({ league_id: league, season, group_name: group, team_id: r.team_id, rank: i + 1, points: r.points, played: r.played, win: r.win, draw: r.draw, lose: r.lose, gf: r.gf, ga: r.ga, gd: r.gd, form: null, description: null }));
}

/**
 * Seasons API-Football has: every season its catalog lists for the league (crawled yet or not), which history never
 * touches. A season row another source created carries coverage.source and does not count.
 */
export const apiSeasonsOf = (rows: { season: number; coverage: { source?: string } | null }[]): Set<number> =>
  new Set(rows.filter((r) => !r.coverage?.source).map((r) => r.season));

/** Where history can come from: a source and a league it has seasons of that API-Football does not. */
export const HISTORY_TARGETS: { source: string; league: number; minCompared: number; trust?: number }[] = [
  { source: OF_SOURCE, league: MLS, minCompared: 1000 },   // MLS 2005-2011 from openfootball
  { source: 'asa', league: 254, minCompared: 300 },        // NWSL 2016-2018 from American Soccer Analysis
  // Worldwide: football-data.co.uk first (its matches carry shots and corners), then openfootball for the leagues and
  // seasons it alone has. A season one source filled is never filled again by another.
  ...FD_LEAGUES.map((l) => ({ source: 'football-data', league: l.league, minCompared: 300, trust: 0.98 })),
  ...OF_LEAGUES.filter((l) => l.league !== MLS).map((l) => ({ source: OF_SOURCE, league: l.league, minCompared: 300, trust: 0.98 })),
];

/** params: { source?: string, league?: number } */
export async function historyFill(ctx: JobContext): Promise<void> {
  const { data, error } = await ctx.db.rpc('pro_source_agreement');
  if (error) throw new Error(error.message);
  // Scores only: history is results, so that is what the source has to get right.
  const agreement = ((data ?? []) as { source: string; league_id: number; kind: string; agree: number; differ: number }[]).filter((r) => r.kind === 'game');
  const off = await sourcesOff(ctx.db);
  for (const t of HISTORY_TARGETS) {
    if (off.has(t.source)) continue;
    if ((ctx.params.source && ctx.params.source !== t.source) || (Number(ctx.params.league) && Number(ctx.params.league) !== t.league)) continue;
    await fillFrom(ctx, t, agreement.filter((r) => r.source === t.source && r.league_id === t.league));
  }
  // Then the official tables (Wikipedia) for the same and earlier seasons: they replace a table worked out from results.
  const tableAgreement = ((data ?? []) as { source: string; league_id: number; kind: string; agree: number; differ: number }[]).filter((r) => r.kind === 'standing');
  for (const t of TABLE_TARGETS) {
    if (off.has(t.source)) continue;
    if ((ctx.params.source && ctx.params.source !== t.source) || (Number(ctx.params.league) && Number(ctx.params.league) !== t.league)) continue;
    await fillTables(ctx, t, tableAgreement.filter((r) => r.source === t.source && r.league_id === t.league));
  }
}

/**
 * League tables from Wikipedia, shown first: for seasons API-Football has none of (MLS 1996-2011, NWSL 2013-2018, USL
 * 2011-2014, the worldwide leagues before its catalog) and, once every club in it is matched, for seasons it has too
 * (its table then only lends form and notes). History seasons need the league's tables to agree with API-Football's
 * on the seasons both have; a season both have needs its own lines to agree (when compared) at TABLE_SEASON_TRUST.
 */
export const TABLE_TARGETS: { source: string; league: number; minCompared: number; trust?: number }[] = [
  { source: 'wikipedia', league: MLS, minCompared: 100 },
  { source: 'wikipedia', league: 254, minCompared: 40 },
  { source: 'wikipedia', league: 255, minCompared: 60 },
  // Pre-pro leagues: API-Football has their results but no table. Checked against those results (a forfeit or a
  // points deduction can differ), so 97%.
  { source: 'wikipedia', league: 256, minCompared: 100, trust: 0.97 },
  { source: 'wikipedia', league: 1118, minCompared: 40, trust: 0.97 },
  // Worldwide (wikipedia-sync's other targets).
  ...WIKI_TARGETS.filter((w) => w.byLeague).map((w) => ({ source: 'wikipedia', league: w.league, minCompared: 60, trust: 0.97 })),
];
export const TABLE_SEASON_TRUST = 0.9;

async function fillTables(ctx: JobContext, t: (typeof TABLE_TARGETS)[number], agreement: { agree: number; differ: number }[]): Promise<void> {
  const db = ctx.db;
  const tag = `${t.source}_${t.league}_tables`;
  const agree = agreement.reduce((n, r) => n + Number(r.agree), 0), compared = agree + agreement.reduce((n, r) => n + Number(r.differ), 0);
  const rate = compared ? agree / compared : 0;
  ctx.note(`${tag}_agreement`, `${(rate * 100).toFixed(2)}% of ${compared}`);
  const trust = t.trust ?? HISTORY_TRUST;
  const historyOk = compared >= t.minCompared && rate >= trust;
  // Each season's own table lines against API-Football's (when it has a table for that season).
  const seasonRate = new Map<number, number>();
  for (const r of agreement as { season?: number; agree: number; differ: number }[]) {
    if (r.season == null) continue;
    const n = Number(r.agree) + Number(r.differ);
    if (n) seasonRate.set(r.season, Number(r.agree) / n);
  }

  const seasonRows = await selectAll<{ season: number; fixtures_synced_at: string | null; coverage: { source?: string; standings?: boolean } | null }>(db, 'pro_seasons', 'season,fixtures_synced_at,coverage', (q) => q.eq('league_id', t.league));
  const apiSeasons = apiSeasonsOf(seasonRows);
  // Also API-Football seasons it has no table for (results only): unless it has one after all.
  const apiTables = new Set((await selectAll<{ season: number }>(db, 'pro_standings', 'season', (q) => q.eq('league_id', t.league).eq('source', 'api-football'))).map((r) => r.season));
  const noTable = new Set(seasonRows.filter((r) => !r.coverage?.source && r.coverage?.standings === false && !apiTables.has(r.season)).map((r) => r.season));
  const all = await selectAll<any>(db, 'pro_src_standings', '*', (q) => q.eq('source', t.source).eq('league_id', t.league));
  const teamMap = await sourceIdMap(db, t.source, 'team');
  const history = (season: number) => !apiSeasons.has(season) || noTable.has(season);
  // A season API-Football has: Wikipedia's table goes first once every club in it is matched and its lines agree.
  const bySeason = new Map<number, any[]>();
  for (const r of all) bySeason.set(r.season, [...(bySeason.get(r.season) ?? []), r]);
  const shared = [...bySeason].filter(([season, rs]) => !history(season) && rs.every((r) => teamMap.has(r.team_ext)) && (seasonRate.get(season) ?? 1) >= TABLE_SEASON_TRUST).map(([season]) => season);
  if (!historyOk) ctx.note(`${tag}_history_skipped`, `history needs ${trust * 100}% agreement on ${t.minCompared}+ compared table lines first`);
  const rows = all.filter((r) => (history(r.season) && historyOk) || shared.includes(r.season));
  ctx.inc(`${tag}_shared_seasons`, shared.length);
  if (!rows.length) { ctx.note(`${tag}_idle`, 'no tables to fill'); return; }

  const missing = [...new Set(rows.filter((r) => history(r.season)).map((r) => r.team_ext as string))].filter((n) => !teamMap.has(n));
  if (missing.length) {
    const at = new Date().toISOString();
    const lg = (await db.from('pro_leagues').select('country,gender').eq('id', t.league).maybeSingle()).data as { country: string | null; gender: string | null } | null;
    const gender = lg?.gender === 'w' || t.league === 254 ? 'w' : 'm';
    const clubName = (ext: string) => (/^\d+:/.test(ext) ? ext.slice(ext.indexOf(':') + 1) : ext);
    const clubs = missing.map((ext) => ({ ext, row: { id: negativeId(`team|${t.source}|${ext}`), name: clubName(ext), display_name: teamDisplayName(clubName(ext)), country: lg?.country ?? 'USA', gender, national: false, source: t.source, updated_at: at } }));
    await upsertChunked(db, 'pro_teams', clubs.map((c) => c.row), { onConflict: 'id' });
    await upsertChunked(db, 'pro_source_ids', clubs.map((c) => ({ source: t.source, kind: 'team', ext_id: c.ext, pro_id: c.row.id, method: 'created', confidence: 1, updated_at: at })), { onConflict: 'source,kind,ext_id' });
    for (const c of clubs) teamMap.set(c.ext, c.row.id);
    ctx.inc('clubs_created', clubs.length);
  }
  // API-Football's form guide and notes stay on a table Wikipedia now supplies.
  const apiExtra = new Map<string, { form: string | null; description: string | null }>();
  for (const season of shared) {
    for (const r of await selectAll<{ team_id: number; form: string | null; description: string | null }>(db, 'pro_standings', 'team_id,form,description', (q) => q.eq('league_id', t.league).eq('season', season))) {
      apiExtra.set(`${season}|${r.team_id}`, { form: r.form, description: r.description });
    }
  }
  const at = new Date().toISOString();
  const existing = new Map(seasonRows.map((r) => [r.season, r]));
  for (const season of [...new Set(rows.map((r) => r.season as number))].sort()) {
    const lines: StandingRow[] = rows.filter((r) => r.season === season).map((r) => ({
      league_id: t.league, season, group_name: r.group_name, team_id: teamMap.get(r.team_ext)!, rank: r.rank, points: r.points, played: r.played, win: r.win, draw: r.draw, lose: r.lose,
      gf: r.gf, ga: r.ga, gd: r.gd, form: apiExtra.get(`${season}|${teamMap.get(r.team_ext)}`)?.form ?? null,
      description: r.shootout_wins ? `${r.shootout_wins} shootout wins` : apiExtra.get(`${season}|${teamMap.get(r.team_ext)}`)?.description ?? null,
    }));
    // Two lines for one club in one table cannot be stored: keep the first.
    const uniq = [...new Map(lines.map((l) => [`${l.group_name}|${l.team_id}`, l])).values()];
    await upsertStandings(db, uniq, undefined, t.source);
    const prev = existing.get(season);
    // An API-Football season keeps its own season row; only a history season gets one marked with the source.
    if (history(season) && !noTable.has(season)) await patchSeason(db, t.league, season, { fixtures_synced_at: prev?.fixtures_synced_at ?? at, is_current: false, coverage: { source: prev?.coverage?.source ?? t.source }, backfilled_at: at });
    ctx.inc('tables');
    await ctx.heartbeat();
  }
}

async function fillFrom(ctx: JobContext, t: (typeof HISTORY_TARGETS)[number], agreement: { agree: number; differ: number }[]): Promise<void> {
  const db = ctx.db;
  const tag = `${t.source}_${t.league}`;
  // The gate: the source must agree with API-Football on the seasons both have.
  const agree = agreement.reduce((n, r) => n + Number(r.agree), 0), compared = agree + agreement.reduce((n, r) => n + Number(r.differ), 0);
  const rate = compared ? agree / compared : 0;
  ctx.note(`${tag}_agreement`, `${(rate * 100).toFixed(2)}% of ${compared}`);
  const trust = t.trust ?? HISTORY_TRUST;
  if (compared < t.minCompared || rate < trust) { ctx.note(`${tag}_skipped`, `needs ${trust * 100}% agreement on ${t.minCompared}+ compared scores first`); return; }

  const seasonRows = await selectAll<{ season: number; coverage: { source?: string } | null }>(db, 'pro_seasons', 'season,coverage', (q) => q.eq('league_id', t.league));
  const apiSeasons = apiSeasonsOf(seasonRows);
  // A history season another source already filled stays that source's (no second copy of its matches).
  const otherSource = new Set(seasonRows.filter((r) => r.coverage?.source && r.coverage.source !== t.source).map((r) => r.season));
  const teamMap = await sourceIdMap(db, t.source, 'team');
  const games = (await selectAll<any>(db, 'pro_src_games', '*', (q) => q.eq('source', t.source).eq('league_id', t.league))).filter((g) => !apiSeasons.has(g.season) && !otherSource.has(g.season));
  if (!games.length) { ctx.note(`${tag}_idle`, 'no history seasons to fill'); return; }

  // Clubs API-Football does not know: one negative-id club each, kept in the id map so the next run finds them.
  const missing = [...new Set(games.flatMap((g) => [g.home_ext, g.away_ext]))].filter((n) => !teamMap.has(n));
  if (missing.length) {
    const at = new Date().toISOString();
    const names = new Map((await selectAll<{ ext_id: string; name: string }>(db, 'pro_src_teams', 'ext_id,name', (q) => q.eq('source', t.source))).map((r) => [r.ext_id, r.name]));
    const lg = (await db.from('pro_leagues').select('country,gender').eq('id', t.league).maybeSingle()).data as { country: string | null; gender: string | null } | null;
    const gender = lg?.gender === 'w' || t.league === 254 ? 'w' : 'm';
    // A European cup's clubs are from many countries: no country rather than a wrong one.
    const country = lg?.country && lg.country !== 'World' ? lg.country : null;
    const clubs = missing.map((ext) => { const name = names.get(ext) ?? ext; return { ext, row: { id: negativeId(`team|${t.source}|${ext}`), name, display_name: teamDisplayName(name), country, gender, national: false, source: t.source, updated_at: at } }; });
    await upsertChunked(db, 'pro_teams', clubs.map((c) => c.row), { onConflict: 'id' });
    await upsertChunked(db, 'pro_source_ids', clubs.map((c) => ({ source: t.source, kind: 'team', ext_id: c.ext, pro_id: c.row.id, method: 'created', confidence: 1, updated_at: at })), { onConflict: 'source,kind,ext_id' });
    for (const c of clubs) teamMap.set(c.ext, c.row.id);
    ctx.inc('clubs_created', clubs.length);
  }

  const at = new Date().toISOString();
  const fixtures = games.filter((g) => g.status === 'final' || g.status === 'other').map((g) => {
    const final = g.status === 'final';
    const pen = g.pen_home != null;
    const winner: FixtureRow['winner'] = !final ? null : pen ? (g.pen_home > g.pen_away ? 'home' : 'away') : g.home_score > g.away_score ? 'home' : g.home_score < g.away_score ? 'away' : 'draw';
    return {
      id: negativeId(`fixture|${t.source}|${g.ext_id}`, 40), league_id: t.league, season: g.season, round: g.round ?? (g.matchday ? `Matchday ${g.matchday}` : null), kickoff: g.kickoff,
      status: final ? 'final' : 'cancelled', status_short: final ? (pen ? 'PEN' : g.et_home != null ? 'AET' : 'FT') : 'CANC',
      elapsed: null, elapsed_extra: null, home_team_id: teamMap.get(g.home_ext)!, away_team_id: teamMap.get(g.away_ext)!,
      home_goals: g.home_score, away_goals: g.away_score, ht_home: g.ht_home ?? null, ht_away: g.ht_away ?? null, et_home: g.et_home ?? null, et_away: g.et_away ?? null, pen_home: g.pen_home ?? null, pen_away: g.pen_away ?? null,
      winner, venue_name: null, venue_city: null, referee: null,
      // No lineups or events exist for these: never ask API-Football for detail.
      source: t.source, detail_fetched_at: at, final_at: final ? g.kickoff : null,
    };
  });
  ctx.inc('matches', await upsertFixtures(db, fixtures as unknown as FixtureRow[]));
  for (const season of [...new Set(games.map((g) => g.season))].sort()) {
    const regular = games.filter((g) => g.season === season && g.status === 'final' && !g.knockout && g.home_score != null);
    await upsertStandings(db, tableFromResults(regular.map((g) => ({ home: teamMap.get(g.home_ext)!, away: teamMap.get(g.away_ext)!, hg: g.home_score, ag: g.away_score })), t.league, season, 'Overall (from results)'), undefined, 'results');
    // coverage.source marks a season API-Football does not have: the planner and the backfill leave it alone.
    await patchSeason(db, t.league, season, { fixtures_synced_at: at, is_current: false, coverage: { source: t.source }, backfilled_at: at });
    await refreshAggregates(db, t.league, season);
    ctx.inc('seasons');
    await ctx.heartbeat();
  }
}

/**
 * Tables from results when no source has one (WPSL, and leagues API-Football has no table for): the clubs that met in
 * the regular season, split into the groups they actually played in (regional conferences never meet before the
 * playoffs), one table each. One group is "Table (from results)"; several are numbered, largest first.
 */
export function tablesFromResults(games: { home: number; away: number; hg: number; ag: number }[], league: number, season: number): StandingRow[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  for (const g of games) for (const id of [g.home, g.away]) if (!parent.has(id)) parent.set(id, id);
  for (const g of games) { const a = find(g.home), b = find(g.away); if (a !== b) parent.set(a, b); }
  const groups = new Map<number, typeof games>();
  for (const g of games) { const r = find(g.home); groups.set(r, [...(groups.get(r) ?? []), g]); }
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
  return sorted.flatMap((gs, i) => tableFromResults(gs, league, season, sorted.length === 1 ? 'Table (from results)' : `Group ${i + 1} (from results)`));
}

/**
 * Names for groups worked out from results: the Wikipedia division or conference most of a group's clubs are listed in
 * (more than half of them), else the group keeps its number. The numbers stay the results' own.
 */
export function nameGroups(rows: StandingRow[], wikiGroupOf: Map<number, string>): StandingRow[] {
  const byGroup = new Map<string, StandingRow[]>();
  for (const r of rows) byGroup.set(r.group_name, [...(byGroup.get(r.group_name) ?? []), r]);
  const rename = new Map<string, string>(), used = new Set<string>();
  for (const [g, list] of byGroup) {
    const votes = new Map<string, number>();
    for (const r of list) { const w = wikiGroupOf.get(r.team_id); if (w) votes.set(w, (votes.get(w) ?? 0) + 1); }
    const best = [...votes].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > list.length / 2 && !used.has(best[0])) { rename.set(g, best[0]); used.add(best[0]); }
  }
  return rows.map((r) => (rename.has(r.group_name) ? { ...r, group_name: rename.get(r.group_name)! } : r));
}

/** params: { league?: number } — enabled leagues' seasons with results and no table from anywhere. */
export async function resultsTables(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const leagues = await selectAll<{ id: number; type: string; current_season: number | null; country: string | null }>(db, 'pro_leagues', 'id,type,current_season,country', (q) => {
    let x = q.eq('enabled', true).eq('type', 'league');
    if (Number(ctx.params.league)) x = x.eq('id', Number(ctx.params.league));
    return x;
  });
  const ids = leagues.map((l) => l.id);
  const seasons = await selectAll<{ league_id: number; season: number; coverage: { standings?: boolean; source?: string } | null }>(db, 'pro_seasons', 'league_id,season,coverage', (q) => q.in('league_id', ids.length ? ids : [-1]));
  const byId = new Map(leagues.map((l) => [l.id, l]));
  // US leagues every season; elsewhere the current and the last.
  const want = seasons.filter((s) => s.coverage?.standings === false && !s.coverage?.source).filter((s) => {
    const l = byId.get(s.league_id)!;
    return l.country === 'USA' || (l.current_season != null && s.season >= l.current_season - 1);
  });
  for (const s of want) {
    if (await ctx.cancelled()) return;
    const { data: existing } = await db.from('pro_standings').select('source').eq('league_id', s.league_id).eq('season', s.season).neq('source', 'results').limit(1);
    if ((existing ?? []).length) continue;
    const games = (await selectAll<{ home_team_id: number; away_team_id: number; home_goals: number | null; away_goals: number | null; round: string | null }>(db, 'pro_fixtures', 'home_team_id,away_team_id,home_goals,away_goals,round',
      (q) => q.eq('league_id', s.league_id).eq('season', s.season).eq('status', 'final').eq('source', 'api-football')))
      .filter((g) => isRegularRound(g.round) && g.home_goals != null && g.away_goals != null);
    if (games.length < 10) continue;
    let rows = tablesFromResults(games.map((g) => ({ home: g.home_team_id, away: g.away_team_id, hg: g.home_goals!, ag: g.away_goals! })), s.league_id, s.season);
    // Division names from Wikipedia's tables for the season, when it has them.
    const wiki = await selectAll<{ group_name: string; team_ext: string }>(db, 'pro_src_standings', 'group_name,team_ext', (q) => q.eq('source', 'wikipedia').eq('league_id', s.league_id).eq('season', s.season));
    if (wiki.length) {
      const ids = await sourceIdMap(db, 'wikipedia', 'team');
      rows = nameGroups(rows, new Map(wiki.filter((w) => ids.has(w.team_ext)).map((w) => [ids.get(w.team_ext)!, w.group_name])));
    }
    await upsertStandings(db, rows, undefined, 'results');
    ctx.inc('tables'); ctx.inc('rows', rows.length);
    await ctx.heartbeat();
  }
}

registerJob('results-tables', resultsTables);
registerJob('openfootball-sync', openfootballSync);
registerJob('history-fill', historyFill);
