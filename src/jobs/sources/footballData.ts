// football-data-sync: results and match stats (shots, shots on target, fouls, corners, cards, referee) from
// football-data.co.uk (free downloads, credited) for the main European leagues, one CSV per league and season.
// Finished seasons are read once; the season in play (and the one before) on every run. Stored as source records
// (pro_src_games, pro_src_game_stats); source-map and source-check match them to API-Football and compare scores.
// football-data-fill: copies the stats onto matched pro matches that have no team stats yet, so club pages show shots
// and corners without spending API-Football requests (match detail, when it comes, replaces them).
import { registerJob, type JobContext } from '../runner.js';
import { makeFetcher } from '../fetcher.js';
import { selectAll, upsertChunked } from '../../db/client.js';
import { selectIn } from './sourceMap.js';
import { negativeId } from './history.js';
import { sourcesOff } from '../../pro/sources.js';
import { patchSourceSeason, sourceIdMap, upsertSrcGames, upsertSrcTeams } from '../../db/sourceRepo.js';
import { refreshAggregates } from '../../db/proRepo.js';
import { FD_LEAGUES, fdUrl, parseFdCsv, type FdLeague, type FdMatch } from '../../sources/footballData/parse.js';
import type { SrcGameRow } from '../../sources/asa/parse.js';

export const FD_SOURCE = 'football-data';
export const FD_CREDIT = { name: 'football-data.co.uk', url: 'https://www.football-data.co.uk', license: 'free data, credited' };

const club = (l: Pick<FdLeague, 'country'>, name: string) => `${l.country}:${name}`;

export function fdGameId(l: Pick<FdLeague, 'league' | 'country'>, season: number, m: Pick<FdMatch, 'date' | 'home' | 'away'>): string {
  return `${l.league}|${season}|${m.date}|${club(l, m.home)}|${club(l, m.away)}`;
}

/** UK kickoff (the files' times are UK local; the date is what matching needs). */
const kickoffOf = (m: FdMatch) => new Date(`${m.date}T${m.time ?? '15:00'}:00+00:00`).toISOString();

export function toFdRows(l: FdLeague, season: number, matches: FdMatch[], at: string) {
  const games: (SrcGameRow & Record<string, unknown>)[] = [];
  const stats: Record<string, unknown>[] = [];
  for (const m of matches) {
    const ext_id = fdGameId(l, season, m);
    const final = m.hg != null && m.ag != null;
    games.push({
      source: FD_SOURCE, ext_id, league_id: l.league, season, kickoff: kickoffOf(m), home_ext: club(l, m.home), away_ext: club(l, m.away),
      home_score: m.hg, away_score: m.ag, home_xg: null, away_xg: null, attendance: null, stadium_ext: null, referee_ext: m.referee, home_manager_ext: null, away_manager_ext: null,
      matchday: null, knockout: false, status: final ? 'final' : 'scheduled', updated_at: at, ht_home: m.hthg, ht_away: m.htag,
    });
    if (m.stats) {
      const h = m.stats.home, a = m.stats.away;
      stats.push({
        source: FD_SOURCE, ext_id, league_id: l.league, season, referee: m.referee, updated_at: at,
        home_shots: h.shots, away_shots: a.shots, home_shots_on: h.shots_on, away_shots_on: a.shots_on, home_fouls: h.fouls, away_fouls: a.fouls,
        home_corners: h.corners, away_corners: a.corners, home_yellow: h.yellow, away_yellow: a.yellow, home_red: h.red, away_red: a.red,
      });
    }
  }
  return { games, stats };
}

/** params: { league?: number, from?: number, to?: number, force?: boolean } */
export async function footballDataSync(ctx: JobContext): Promise<void> {
  const f = makeFetcher(ctx.db);
  const targets = FD_LEAGUES.filter((l) => !Number(ctx.params.league) || l.league === Number(ctx.params.league));
  const current = new Map((await selectAll<{ id: number; current_season: number | null }>(ctx.db, 'pro_leagues', 'id,current_season', (q) => q.in('id', targets.map((t) => t.league)))).map((l) => [l.id, l.current_season]));
  const done = new Set((await selectAll<{ league_id: number; season: number }>(ctx.db, 'pro_source_seasons', 'league_id,season', (q) => q.eq('source', FD_SOURCE).not('synced_at', 'is', null))).map((r) => `${r.league_id}|${r.season}`));
  for (const l of targets) {
    const cur = current.get(l.league) ?? new Date().getUTCFullYear();
    const to = Math.min(Number(ctx.params.to) || cur, cur);
    for (let season = Math.max(Number(ctx.params.from) || l.first, l.first); season <= to; season += 1) {
      if (await ctx.cancelled()) return;
      if (done.has(`${l.league}|${season}`) && season < cur - 1 && !ctx.params.force) continue;
      let text: string;
      try { text = (await f.get(fdUrl(l, season), { accept: 'text/csv,text/plain', noStore: true, skipCache: true, attempts: 2 })).text; }
      catch (err) {
        if ((err as { status?: number }).status === 404) {
          ctx.inc('seasons_missing');
          if (season < cur) await patchSourceSeason(ctx.db, FD_SOURCE, l.league, season, { synced_at: new Date().toISOString(), games: 0, player_rows: 0, calls: 1, last_error: null });
          continue;
        }
        ctx.inc('errors');
        await patchSourceSeason(ctx.db, FD_SOURCE, l.league, season, { last_error: String(err instanceof Error ? err.message : err).slice(0, 500) });
        continue;
      }
      const at = new Date().toISOString();
      const matches = parseFdCsv(text);
      const { games, stats } = toFdRows(l, season, matches, at);
      const clubs = [...new Set(matches.flatMap((m) => [m.home, m.away]))];
      await upsertSrcTeams(ctx.db, clubs.map((n) => ({ source: FD_SOURCE, ext_id: club(l, n), league_id: l.league, name: n, short_name: null, abbr: null, updated_at: at })));
      await upsertSrcGames(ctx.db, games);
      if (stats.length) await upsertChunked(ctx.db, 'pro_src_game_stats', stats, { onConflict: 'source,ext_id' });
      await patchSourceSeason(ctx.db, FD_SOURCE, l.league, season, { synced_at: at, games: games.length, player_rows: 0, calls: 1, last_error: null });
      ctx.inc('seasons'); ctx.inc('games', games.length); ctx.inc('games_with_stats', stats.length);
      await ctx.heartbeat();
    }
  }
}

type StatRow = { ext_id: string; league_id: number; season: number; home_shots: number | null; away_shots: number | null; home_shots_on: number | null; away_shots_on: number | null; home_fouls: number | null; away_fouls: number | null; home_corners: number | null; away_corners: number | null; home_yellow: number | null; away_yellow: number | null; home_red: number | null; away_red: number | null };

/** params: { league?: number } — copies football-data match stats onto matched pro matches without team stats. */
export async function footballDataFill(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  if ((await sourcesOff(db)).has(FD_SOURCE)) { ctx.note('idle', 'football-data.co.uk is switched off in the hub'); return; }
  const [games, teams] = await Promise.all([sourceIdMap(db, FD_SOURCE, 'game'), sourceIdMap(db, FD_SOURCE, 'team')]);
  const leagues = FD_LEAGUES.filter((l) => !Number(ctx.params.league) || l.league === Number(ctx.params.league));
  for (const l of leagues) {
    const stats = await selectAll<StatRow & { home_ext?: string }>(db, 'pro_src_game_stats', '*', (q) => q.eq('source', FD_SOURCE).eq('league_id', l.league));
    // Matches it supplied itself (history seasons API-Football does not have) carry their own negative id.
    const own = new Map(stats.map((s) => [s.ext_id, negativeId(`fixture|${FD_SOURCE}|${s.ext_id}`, 40)]));
    const ownIds = new Set((await selectIn<{ id: number }>(db, 'pro_fixtures', 'id', 'id', [...own.values()])).map((f) => f.id));
    for (const [ext, id] of own) if (ownIds.has(id) && !games.has(ext)) games.set(ext, id);
    const matched = stats.filter((s) => games.has(s.ext_id));
    if (!matched.length) continue;
    // The league's games read whole (a list of tens of thousands of long ids does not fit in a request).
    const src = new Map((await selectAll<{ ext_id: string; home_ext: string }>(db, 'pro_src_games', 'ext_id,home_ext', (q) => q.eq('source', FD_SOURCE).eq('league_id', l.league))).map((g) => [g.ext_id, g.home_ext]));
    const fixtureIds = matched.map((s) => games.get(s.ext_id)!);
    const fx = new Map((await selectIn<{ id: number; home_team_id: number; away_team_id: number; season: number }>(db, 'pro_fixtures', 'id,home_team_id,away_team_id,season', 'id', fixtureIds)).map((f) => [f.id, f]));
    // Matches that already have team stats (API-Football's match detail, or an earlier fill) are left alone.
    const has = new Set((await selectIn<{ fixture_id: number }>(db, 'pro_fixture_team_stats', 'fixture_id', 'fixture_id', fixtureIds)).map((r) => r.fixture_id));
    const rows: Record<string, unknown>[] = [];
    const seasons = new Set<number>();
    for (const s of matched) {
      const id = games.get(s.ext_id)!; const f = fx.get(id);
      if (!f || has.has(id)) continue;
      // Home and away as API-Football has them (a swapped fixture keeps each club's own numbers).
      const swapped = teams.get(src.get(s.ext_id) ?? '') === f.away_team_id;
      const side = (home: boolean) => ({ shots: home ? s.home_shots : s.away_shots, shots_on: home ? s.home_shots_on : s.away_shots_on, fouls: home ? s.home_fouls : s.away_fouls, corners: home ? s.home_corners : s.away_corners, yellow: home ? s.home_yellow : s.away_yellow, red: home ? s.home_red : s.away_red });
      const extra = { source: FD_SOURCE };
      rows.push({ fixture_id: id, team_id: f.home_team_id, ...side(!swapped), shots_off: null, extra });
      rows.push({ fixture_id: id, team_id: f.away_team_id, ...side(swapped), shots_off: null, extra });
      seasons.add(f.season);
    }
    if (rows.length) await upsertChunked(db, 'pro_fixture_team_stats', rows, { onConflict: 'fixture_id,team_id' });
    ctx.inc('matches_filled', rows.length / 2);
    for (const season of seasons) { await refreshAggregates(db, l.league, season); ctx.inc('aggregates_refreshed'); }
    await ctx.heartbeat();
  }
}

registerJob('football-data-sync', footballDataSync);
registerJob('football-data-fill', footballDataFill);
