// openfootball-sync: MLS results from openfootball (github.com/openfootball/world, public domain) for every season it
// has (2005 on), stored as source records (pro_src_games, clubs by name). source-map and source-check then match them to
// API-Football and compare scores on the seasons both have (2012 on).
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
import type { SrcGameRow } from '../../sources/asa/parse.js';
import type { FixtureRow, StandingRow } from '../../sources/apiFootball/parse.js';
import { teamDisplayName } from '../../sources/apiFootball/leagues.js';

export const OF_SOURCE = 'openfootball';
const OF_BASE = 'https://raw.githubusercontent.com/openfootball/world/master/north-america/major-league-soccer';
const MLS = 253;
const FIRST = 2005;
export const HISTORY_TRUST = 0.99;

/** A stable negative id from a key (never clashes with API-Football's positive ids). */
export const negativeId = (key: string, bits = 31): number => -(parseInt(createHash('sha1').update(key).digest('hex').slice(0, 8), 16) % 2 ** bits || 1);

/** ISO kickoff: openfootball times are local and zoneless; US Eastern is close enough to keep the date right. */
const kickoffOf = (m: OfMatch) => new Date(`${m.date}T${m.time ?? '19:00'}:00-05:00`).toISOString();

export function toSrcGame(m: OfMatch, at: string): SrcGameRow & Record<string, unknown> {
  const s = finalScore(m);
  return {
    source: OF_SOURCE, ext_id: `${m.season}|${m.date}|${m.home}|${m.away}`, league_id: MLS, season: m.season, kickoff: kickoffOf(m), home_ext: m.home, away_ext: m.away,
    home_score: s?.[0] ?? null, away_score: s?.[1] ?? null, home_xg: null, away_xg: null, attendance: null, stadium_ext: null, referee_ext: null, home_manager_ext: null, away_manager_ext: null,
    matchday: null, knockout: m.playoffs, status: m.status === 'final' ? 'final' : m.status === 'cancelled' ? 'other' : 'scheduled', updated_at: at,
    round: m.round, ht_home: m.ht?.[0] ?? null, ht_away: m.ht?.[1] ?? null, et_home: m.aet?.[0] ?? null, et_away: m.aet?.[1] ?? null, pen_home: m.pen?.[0] ?? null, pen_away: m.pen?.[1] ?? null,
  };
}

/** params: { from?: number, to?: number } */
export async function openfootballSync(ctx: JobContext): Promise<void> {
  const f = makeFetcher(ctx.db);
  const to = Number(ctx.params.to) || new Date().getUTCFullYear();
  for (let season = Number(ctx.params.from) || FIRST; season <= to; season += 1) {
    if (await ctx.cancelled()) return;
    const res = await f.get(`${OF_BASE}/${season}_mls.txt`, { accept: 'text/plain', noStore: true, skipCache: true });
    if (res.status === 404) { ctx.inc('seasons_missing'); continue; }
    if (res.status !== 200) { ctx.inc('errors'); await patchSourceSeason(ctx.db, OF_SOURCE, MLS, season, { last_error: `HTTP ${res.status}` }); continue; }
    const at = new Date().toISOString();
    const matches = parseSeasonFile(res.text, season);
    const names = [...new Set(matches.flatMap((m) => [m.home, m.away]))];
    await upsertSrcTeams(ctx.db, names.map((n) => ({ source: OF_SOURCE, ext_id: n, league_id: MLS, name: n, short_name: null, abbr: null, updated_at: at })));
    await upsertSrcGames(ctx.db, matches.map((m) => toSrcGame(m, at)));
    await patchSourceSeason(ctx.db, OF_SOURCE, MLS, season, { synced_at: at, games: matches.length, player_rows: 0, calls: 1, last_error: null });
    ctx.inc('seasons'); ctx.inc('games', matches.length);
    await ctx.heartbeat();
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

/** Where history can come from: a source and a league it has seasons of that API-Football does not. */
export const HISTORY_TARGETS: { source: string; league: number; minCompared: number }[] = [
  { source: OF_SOURCE, league: MLS, minCompared: 1000 },   // MLS 2005-2011 from openfootball
  { source: 'asa', league: 254, minCompared: 300 },        // NWSL 2016-2018 from American Soccer Analysis
];

/** params: { source?: string, league?: number } */
export async function historyFill(ctx: JobContext): Promise<void> {
  const { data, error } = await ctx.db.rpc('pro_source_agreement');
  if (error) throw new Error(error.message);
  // Scores only: history is results, so that is what the source has to get right.
  const agreement = ((data ?? []) as { source: string; league_id: number; kind: string; agree: number; differ: number }[]).filter((r) => r.kind === 'game');
  for (const t of HISTORY_TARGETS) {
    if ((ctx.params.source && ctx.params.source !== t.source) || (Number(ctx.params.league) && Number(ctx.params.league) !== t.league)) continue;
    await fillFrom(ctx, t, agreement.filter((r) => r.source === t.source && r.league_id === t.league));
  }
}

async function fillFrom(ctx: JobContext, t: (typeof HISTORY_TARGETS)[number], agreement: { agree: number; differ: number }[]): Promise<void> {
  const db = ctx.db;
  const tag = `${t.source}_${t.league}`;
  // The gate: the source must agree with API-Football on the seasons both have.
  const agree = agreement.reduce((n, r) => n + Number(r.agree), 0), compared = agree + agreement.reduce((n, r) => n + Number(r.differ), 0);
  const rate = compared ? agree / compared : 0;
  ctx.note(`${tag}_agreement`, `${(rate * 100).toFixed(2)}% of ${compared}`);
  if (compared < t.minCompared || rate < HISTORY_TRUST) { ctx.note(`${tag}_skipped`, `needs ${HISTORY_TRUST * 100}% agreement on ${t.minCompared}+ compared scores first`); return; }

  // Seasons API-Football has (its own fixtures), which history never touches.
  const apiSeasons = new Set((await selectAll<{ season: number; coverage: { source?: string } | null }>(db, 'pro_seasons', 'season,coverage', (q) => q.eq('league_id', t.league).not('fixtures_synced_at', 'is', null)))
    .filter((r) => !r.coverage?.source).map((r) => r.season));
  const teamMap = await sourceIdMap(db, t.source, 'team');
  const games = (await selectAll<any>(db, 'pro_src_games', '*', (q) => q.eq('source', t.source).eq('league_id', t.league))).filter((g) => !apiSeasons.has(g.season));
  if (!games.length) { ctx.note(`${tag}_idle`, 'no history seasons to fill'); return; }

  // Clubs API-Football does not know: one negative-id club each, kept in the id map so the next run finds them.
  const missing = [...new Set(games.flatMap((g) => [g.home_ext, g.away_ext]))].filter((n) => !teamMap.has(n));
  if (missing.length) {
    const at = new Date().toISOString();
    const names = new Map((await selectAll<{ ext_id: string; name: string }>(db, 'pro_src_teams', 'ext_id,name', (q) => q.eq('source', t.source))).map((r) => [r.ext_id, r.name]));
    const gender = t.league === 254 ? 'w' : 'm';
    const clubs = missing.map((ext) => { const name = names.get(ext) ?? ext; return { ext, row: { id: negativeId(`team|${t.source}|${ext}`), name, display_name: teamDisplayName(name), country: 'USA', gender, national: false, source: t.source, updated_at: at } }; });
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
    await upsertStandings(db, tableFromResults(regular.map((g) => ({ home: teamMap.get(g.home_ext)!, away: teamMap.get(g.away_ext)!, hg: g.home_score, ag: g.away_score })), t.league, season, 'Overall (from results)'));
    // coverage.source marks a season API-Football does not have: the planner and the backfill leave it alone.
    await patchSeason(db, t.league, season, { fixtures_synced_at: at, is_current: false, coverage: { source: t.source }, backfilled_at: at });
    await refreshAggregates(db, t.league, season);
    ctx.inc('seasons');
    await ctx.heartbeat();
  }
}

registerJob('openfootball-sync', openfootballSync);
registerJob('history-fill', historyFill);
