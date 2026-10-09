// asa-sync: American Soccer Analysis for the six US leagues it covers. Per league: clubs, players, grounds, managers,
// referees (5 requests). Per league season: games and their xG, player and keeper shooting, passing and goals added
// (split by club), club shooting, passing and goals added (10 requests). Current seasons every run; past seasons once
// (pro_source_seasons.synced_at), newest first, within the time budget.
// asa-shots: every shot of each final game (one request a game), newest seasons first, within the time budget.
// None of it touches the API-Football quota.
import { registerJob, type JobContext } from '../runner.js';
import { makeFetcher } from '../fetcher.js';
import { selectAll } from '../../db/client.js';
import { leagueIndex } from '../../db/proRepo.js';
import {
  patchSourceSeason, replaceShots, upsertAdvPlayerSeasons, upsertAdvTeamSeasons, upsertSrcGames, upsertSrcOfficials, upsertSrcPlayers, upsertSrcTeams, upsertSrcVenues,
} from '../../db/sourceRepo.js';
import { AsaClient } from '../../sources/asa/client.js';
import { ASA_LEAGUES, nameOfSeason, type AsaLeague } from '../../sources/asa/leagues.js';
import {
  mergePlayerSeasons, mergeTeamSeasons, parseGames, parseOfficials, parsePlayers, parseShots, parseStadia, parseTeams, SOURCE,
  type AsaGame, type AsaGameXg, type AsaKeeperXg, type AsaPerson, type AsaPlayer, type AsaPlayerGplus, type AsaPlayerXg, type AsaPlayerXpass, type AsaShot, type AsaStadium,
  type AsaTeam, type AsaTeamGplus, type AsaTeamXg, type AsaTeamXpass,
} from '../../sources/asa/parse.js';
import { log } from '../../log.js';

const now = () => new Date().toISOString();

async function syncLeague(ctx: JobContext, asa: AsaClient, l: AsaLeague): Promise<void> {
  const [teams, players, stadia, managers, referees] = [
    await asa.get<AsaTeam>(`${l.slug}/teams`), await asa.get<AsaPlayer>(`${l.slug}/players`), await asa.get<AsaStadium>(`${l.slug}/stadia`),
    await asa.get<AsaPerson>(`${l.slug}/managers`), await asa.get<AsaPerson>(`${l.slug}/referees`),
  ];
  const at = now();
  await upsertSrcTeams(ctx.db, parseTeams(teams, l.league, at));
  ctx.inc('players', await upsertSrcPlayers(ctx.db, parsePlayers(players, at)));
  await upsertSrcVenues(ctx.db, parseStadia(stadia, at));
  await upsertSrcOfficials(ctx.db, [...parseOfficials(managers, 'manager', at), ...parseOfficials(referees, 'referee', at)]);
}

async function syncSeason(ctx: JobContext, asa: AsaClient, l: AsaLeague, season: number): Promise<void> {
  const q = { season_name: nameOfSeason(l.slug, season) };
  const split = { ...q, split_by_teams: true };
  const before = asa.calls;
  const games = await asa.get<AsaGame>(`${l.slug}/games`, q);
  const gameXg = await asa.get<AsaGameXg>(`${l.slug}/games/xgoals`, q);
  const xgoals = await asa.get<AsaPlayerXg>(`${l.slug}/players/xgoals`, split);
  const xpass = await asa.get<AsaPlayerXpass>(`${l.slug}/players/xpass`, split);
  const gplus = await asa.get<AsaPlayerGplus>(`${l.slug}/players/goals-added`, split);
  const keepers = await asa.get<AsaKeeperXg>(`${l.slug}/goalkeepers/xgoals`, split);
  const keeperGplus = await asa.get<AsaPlayerGplus>(`${l.slug}/goalkeepers/goals-added`, split);
  const teamXg = await asa.get<AsaTeamXg>(`${l.slug}/teams/xgoals`, q);
  const teamXpass = await asa.get<AsaTeamXpass>(`${l.slug}/teams/xpass`, q);
  const teamGplus = await asa.get<AsaTeamGplus>(`${l.slug}/teams/goals-added`, q);
  const at = now();
  const g = parseGames(games, l.league, season, gameXg, at);
  const p = mergePlayerSeasons({ xgoals, xpass, gplus, keepers, keeperGplus }, l.league, season, at);
  await upsertSrcGames(ctx.db, g);
  await upsertAdvPlayerSeasons(ctx.db, p);
  await upsertAdvTeamSeasons(ctx.db, mergeTeamSeasons({ xgoals: teamXg, xpass: teamXpass, gplus: teamGplus }, l.league, season, at));
  await patchSourceSeason(ctx.db, SOURCE, l.league, season, { synced_at: at, games: g.length, player_rows: p.length, calls: asa.calls - before, last_error: null });
  ctx.inc('seasons');
  ctx.inc('games', g.length);
  ctx.inc('player_seasons', p.length);
}

/** params: { league?: number, season?: number, history?: boolean (default true), max_minutes?: number (default 9) } */
export async function asaSync(ctx: JobContext): Promise<void> {
  const deadline = Date.now() + (Number(ctx.params.max_minutes) || 9) * 60_000;
  const onlyLeague = Number(ctx.params.league) || null, onlySeason = Number(ctx.params.season) || null;
  const history = ctx.params.history !== false;
  const asa = new AsaClient(makeFetcher(ctx.db));
  const leagues = await leagueIndex(ctx.db);
  const done = new Set((await selectAll<{ league_id: number; season: number }>(ctx.db, 'pro_source_seasons', 'league_id,season', (q) => q.eq('source', SOURCE).not('synced_at', 'is', null)))
    .map((r) => `${r.league_id}|${r.season}`));
  for (const l of ASA_LEAGUES.filter((x) => !onlyLeague || x.league === onlyLeague)) {
    const current = leagues.get(l.league)?.current_season ?? new Date().getUTCFullYear();
    let seasons: number[];
    if (onlySeason) seasons = [onlySeason];
    else {
      seasons = [current];
      // Last season: once, and again through February for the late corrections after a calendar-year season ends.
      if (!done.has(`${l.league}|${current - 1}`) || new Date().getUTCMonth() < 2) seasons.push(current - 1);
      if (history) for (let s = current - 2; s >= l.first; s -= 1) if (!done.has(`${l.league}|${s}`)) seasons.push(s);
    }
    seasons = [...new Set(seasons)].filter((s) => s >= l.first);
    if (!seasons.length) continue;
    if (Date.now() >= deadline || (await ctx.cancelled())) break;
    try { await syncLeague(ctx, asa, l); } catch (err) { log.warn({ league: l.slug, err: String(err) }, 'asa league failed'); ctx.inc('errors'); continue; }
    for (const s of seasons) {
      if (Date.now() >= deadline || (await ctx.cancelled())) { ctx.note('stopped', 'time budget'); break; }
      try { await syncSeason(ctx, asa, l, s); }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.inc('errors');
        await patchSourceSeason(ctx.db, SOURCE, l.league, s, { last_error: msg.slice(0, 500) });
        log.warn({ league: l.slug, season: s, err: msg }, 'asa season failed');
      }
      await ctx.heartbeat();
    }
  }
  ctx.inc('asa_calls', asa.calls);
}

/** params: { max_minutes?: number (default 9), league?: number } */
export async function asaShots(ctx: JobContext): Promise<void> {
  const deadline = Date.now() + (Number(ctx.params.max_minutes) || 9) * 60_000;
  const asa = new AsaClient(makeFetcher(ctx.db));
  const slugOf = new Map(ASA_LEAGUES.map((l) => [l.league, l.slug]));
  while (Date.now() < deadline && !(await ctx.cancelled())) {
    let q = ctx.db.from('pro_src_games').select('ext_id,league_id').eq('source', SOURCE).eq('status', 'final').is('shots_at', null)
      .order('season', { ascending: false }).order('kickoff', { ascending: false }).limit(50);
    if (Number(ctx.params.league)) q = q.eq('league_id', Number(ctx.params.league));
    const { data, error } = await q;
    if (error) throw new Error(`shots queue: ${error.message}`);
    const batch = (data ?? []) as { ext_id: string; league_id: number }[];
    if (!batch.length) { ctx.note('idle', 'every final has its shots'); break; }
    for (const g of batch) {
      if (Date.now() >= deadline) break;
      const slug = slugOf.get(g.league_id);
      if (!slug) continue;
      try { ctx.inc('shots', await replaceShots(ctx.db, SOURCE, g.ext_id, parseShots(await asa.get<AsaShot>(`${slug}/games/shots`, { game_id: g.ext_id })))); ctx.inc('games'); }
      catch (err) {
        ctx.inc('errors');
        log.warn({ game: g.ext_id, err: String(err) }, 'asa shots failed');
        // Stamp it anyway so one bad game cannot block the queue; a re-run can clear shots_at to retry.
        await ctx.db.from('pro_src_games').update({ shots_at: now() }).eq('source', SOURCE).eq('ext_id', g.ext_id);
      }
      await ctx.heartbeat();
    }
  }
  ctx.inc('asa_calls', asa.calls);
}

registerJob('asa-sync', asaSync);
registerJob('asa-shots', asaShots);
