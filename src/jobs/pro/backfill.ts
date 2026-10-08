// pro-backfill: history, a league season at a time, on the backfill quota floor so today's results never wait.
// Order: every enabled league's current season by priority (US pyramid first), then the season before, and so on
// back PRO_BACKFILL_SEASONS seasons. For each league season:
//   1. fixtures?league&season           every match of the season (1 request; re-read weekly while current)
//   2. teams?league&season              club profiles: country, founded, ground (1 request)
//   3. fixtures?ids= (20 per request)   detail for finals that lack it, unless the provider covers none
//   4. standings?league&season          the table (1 request), when covered
//   5. season totals, then backfilled_at
// A run stops at the quota floor or after max_minutes; the next hourly run continues where it stopped.
// pro-players: profiles (full name, birth date, height, photo) for players first seen in a match, newest first.
import { registerJob, type JobContext } from '../runner.js';
import { selectAll } from '../../db/client.js';
import { loadConfig } from '../../config.js';
import { parseProfile, parseTeams, type AfFixtureItem, type AfProfile, type AfTeamItem } from '../../sources/apiFootball/parse.js';
import { leagueIndex, markNoDetail, patchSeason, refreshAggregates, upsertPlayerProfiles, upsertTeamProfiles, type LeagueInfo } from '../../db/proRepo.js';
import { withApi } from './shared.js';
import { storeFixtures } from './scoreboard.js';
import { fetchDetails, pendingDetail } from './detail.js';
import { fetchStandings } from './standings.js';

interface SeasonState { league_id: number; season: number; is_current: boolean; coverage: { fixtures?: { events?: boolean; lineups?: boolean; statistics_players?: boolean }; standings?: boolean } | null; fixtures_synced_at: string | null; teams_synced_at: string | null; standings_synced_at: string | null; backfilled_at: string | null }

const WEEK = 7 * 86400_000;

/** The league seasons still to do, in the order they will be done. Pure. */
export function backfillQueue(seasons: SeasonState[], leagues: Map<number, LeagueInfo>, depth: number, now = Date.now(), only?: number | null): SeasonState[] {
  const out: { s: SeasonState; age: number; priority: number }[] = [];
  for (const s of seasons) {
    const l = leagues.get(s.league_id);
    if (!l?.enabled || (only && s.league_id !== only)) continue;
    const current = l.current_season ?? s.season;
    const age = current - s.season;
    if (age < 0 || age >= depth) continue;
    const stale = s.is_current && (!s.fixtures_synced_at || now - Date.parse(s.fixtures_synced_at) > WEEK);
    if (s.backfilled_at && !stale) continue;
    out.push({ s, age, priority: l.priority });
  }
  return out.sort((a, b) => a.age - b.age || a.priority - b.priority || a.s.league_id - b.s.league_id).map((x) => x.s);
}

const coversDetail = (c: SeasonState['coverage']): boolean => {
  const f = c?.fixtures;
  // No coverage record at all: try (the provider answers with whatever it has).
  return !f || !!(f.events || f.lineups || f.statistics_players);
};

/** params: { league?: number, seasons?: number, max_minutes?: number } */
export async function proBackfill(ctx: JobContext): Promise<void> {
  const cfg = loadConfig();
  const depth = Number(ctx.params.seasons) || cfg.PRO_BACKFILL_SEASONS;
  const deadline = Date.now() + (Number(ctx.params.max_minutes) || 50) * 60_000;
  await withApi(ctx, async (api) => {
    const leagues = await leagueIndex(ctx.db);
    const seasons = await selectAll<SeasonState>(ctx.db, 'pro_seasons', 'league_id,season,is_current,coverage,fixtures_synced_at,teams_synced_at,standings_synced_at,backfilled_at');
    const queue = backfillQueue(seasons, leagues, depth, Date.now(), Number(ctx.params.league) || null);
    ctx.inc('queue', queue.length);
    for (const s of queue) {
      if (Date.now() > deadline || (await ctx.cancelled())) { ctx.note('stopped', 'time budget'); return; }
      if (api.headroom('backfill') < 3) { ctx.note('stopped', 'backfill quota floor'); return; }
      const { league_id: league, season } = s;
      const now = new Date().toISOString();
      if (!s.fixtures_synced_at || (s.is_current && Date.now() - Date.parse(s.fixtures_synced_at) > WEEK)) {
        const res = await api.get<AfFixtureItem>('fixtures', { league, season }, 'backfill');
        const r = await storeFixtures(ctx.db, res.response, leagues);
        ctx.inc('fixtures', r.stored);
        await patchSeason(ctx.db, league, season, { fixtures_synced_at: now });
      }
      if (!s.teams_synced_at) {
        const res = await api.get<AfTeamItem>('teams', { league, season }, 'backfill');
        ctx.inc('teams', await upsertTeamProfiles(ctx.db, parseTeams(res.response, leagues.get(league)?.gender ?? null, now)));
        await patchSeason(ctx.db, league, season, { teams_synced_at: now });
      }
      if (coversDetail(s.coverage)) {
        const pending = await pendingDetail(ctx, leagues, { limit: 5000, league, season });
        // Stop between batches when the budget runs out; the rest waits for the next run.
        const affordable = Math.max(0, Math.floor(Math.min(api.headroom('backfill'), 1e9))) * 20;
        await fetchDetails(ctx, api, pending.slice(0, affordable), leagues, 'backfill');
        if (pending.length > affordable) { ctx.note('stopped', `quota during ${league}/${season}`); await refreshAggregates(ctx.db, league, season); return; }
      } else {
        ctx.inc('finals_without_detail', await markNoDetail(ctx.db, league, season));
      }
      if (s.coverage?.standings !== false && (!s.standings_synced_at || s.is_current)) {
        ctx.inc('standings_rows', await fetchStandings(ctx, api, league, season, leagues, 'backfill'));
      }
      await refreshAggregates(ctx.db, league, season);
      await patchSeason(ctx.db, league, season, { backfilled_at: new Date().toISOString() });
      ctx.inc('seasons_done');
      await ctx.heartbeat();
    }
  });
}

/** params: { limit?: number } */
export async function proPlayers(ctx: JobContext): Promise<void> {
  const limit = Math.min(1000, Number(ctx.params.limit) || 60);
  await withApi(ctx, async (api) => {
    const { data, error } = await ctx.db.from('pro_players').select('id').is('profile_synced_at', null).order('created_at', { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: number }[]) {
      if (await ctx.cancelled()) return;
      if (api.headroom('backfill') < 1) { ctx.note('stopped', 'backfill quota floor'); return; }
      const res = await api.get<AfProfile>('players/profiles', { player: r.id }, 'backfill');
      const at = new Date().toISOString();
      const p = res.response[0];
      if (p?.player?.id === r.id) { await upsertPlayerProfiles(ctx.db, [parseProfile(p, at)]); ctx.inc('profiles'); }
      else {
        // Nothing to learn: remember that we asked, so the player is not asked for again every run.
        await ctx.db.from('pro_players').update({ profile_synced_at: at }).eq('id', r.id);
        ctx.inc('no_profile');
      }
      await ctx.heartbeat();
    }
  });
}

registerJob('pro-backfill', proBackfill);
registerJob('pro-players', proPlayers);
