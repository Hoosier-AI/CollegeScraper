// Clubs fetched when someone opens their page (or one of their players') and we have little on them yet:
//   match detail for this season's finals that lack it (20 a request), then the club's season totals
//   transfers (transfers?team), squad (players/squads), coaches (coachs?team)
//   season stats for its main competition this season (teams/statistics)
// At most once every 14 days a club, within the shared on-view cap and the everyday quota floor (onView.ts); the page
// waits a few seconds at most. Never for bots or the server-rendered pages.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { getApiFootball, saveQuota } from '../jobs/pro/shared.js';
import { fetchDetails, refreshTouched } from '../jobs/pro/detail.js';
import { leagueIndex, replaceSquad, upsertCoaches, upsertTeamSeasonDetail, upsertTransfers } from '../db/proRepo.js';
import { parseCoaches, parseSquad, parseTeamStatistics, parseTransfers, type AfCoach, type AfSquad, type AfTeamStatistics, type AfTransferItem } from '../sources/apiFootball/parse.js';
import { reserveCalls, viewContext, within } from './onView.js';
import { log } from '../log.js';

const EVERY_DAYS = 14;
const inFlight = new Map<number, Promise<string>>();

export async function teamRefreshDue(db: Db, teamId: number): Promise<boolean> {
  if (teamId <= 0) return false;
  const { data } = await db.from('pro_team_refresh').select('refreshed_at').eq('team_id', teamId).maybeSingle();
  const at = (data as { refreshed_at?: string } | null)?.refreshed_at;
  return !at || Date.now() - Date.parse(at) > EVERY_DAYS * 86400_000;
}

/** Finals of the club's current seasons (the last 13 months) that have no detail yet, newest first. */
async function finalsWithoutDetail(db: Db, teamId: number): Promise<number[]> {
  const since = new Date(Date.now() - 400 * 86400_000).toISOString();
  const { data, error } = await db.from('pro_fixtures').select('id').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq('status', 'final').eq('source', 'api-football').is('detail_fetched_at', null).gte('kickoff', since).order('kickoff', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: number }[]).map((r) => r.id);
}

async function refresh(db: Db, teamId: number): Promise<string> {
  const api = getApiFootball();
  if (!api) return 'no key';
  const leagues = await leagueIndex(db);
  const ids = await finalsWithoutDetail(db, teamId);
  // The club's main competition this season: a league it plays in, the best-known first.
  const memberships = await selectAll<{ league_id: number; season: number }>(db, 'pro_league_teams', 'league_id,season', (q) => q.eq('team_id', teamId));
  const main = memberships.map((m) => ({ ...m, l: leagues.get(m.league_id) })).filter((m) => m.l?.type === 'league' && m.season === m.l.current_season)
    .sort((a, b) => (a.l!.priority ?? 999) - (b.l!.priority ?? 999))[0] ?? null;
  const detailCalls = Math.ceil(ids.length / 20);
  const calls = detailCalls + 3 + (main ? 1 : 0);
  if (!(await reserveCalls(db, api, calls))) return 'daily cap or quota floor';
  const at = new Date().toISOString();
  await db.from('pro_team_refresh').upsert({ team_id: teamId, refreshed_at: at, calls }, { onConflict: 'team_id' });
  const ctx = viewContext(db);
  const [detail, moves, squad, coaches, stats] = await Promise.allSettled([
    ids.length ? fetchDetails(ctx, api, ids, leagues, 'everyday').then(async (touched) => { await refreshTouched(ctx, touched); return ids.length; }) : Promise.resolve(0),
    api.get<AfTransferItem>('transfers', { team: teamId }, 'everyday').then((r) => upsertTransfers(db, parseTransfers(r.response, at))),
    api.get<AfSquad>('players/squads', { team: teamId }, 'everyday').then((r) => { const { squad: rows, stubs } = parseSquad(r.response, at); return rows.length ? replaceSquad(db, teamId, rows, stubs) : 0; }),
    api.get<AfCoach>('coachs', { team: teamId }, 'everyday').then((r) => { const { coaches: c, career } = parseCoaches(r.response, at); return upsertCoaches(db, c, career); }),
    main ? api.get<AfTeamStatistics>('teams/statistics', { league: main.league_id, season: main.season, team: teamId }, 'everyday').then((r) => {
      const row = parseTeamStatistics(r.response[0], teamId, main.league_id, main.season, at);
      return row ? upsertTeamSeasonDetail(db, [row]) : 0;
    }) : Promise.resolve(0),
  ]);
  const n = (r: PromiseSettledResult<number>) => (r.status === 'fulfilled' ? r.value : 0);
  await db.from('pro_team_refresh').upsert({ team_id: teamId, refreshed_at: at, calls, matches: n(detail), transfers: n(moves), squad: n(squad), coaches: n(coaches), season_stats: n(stats) }, { onConflict: 'team_id' });
  await saveQuota(db, api.quota);
  const failed = [detail, moves, squad, coaches, stats].filter((r) => r.status === 'rejected');
  if (failed.length) log.warn({ teamId, failed: failed.map((f) => String((f as PromiseRejectedResult).reason)).slice(0, 3) }, 'team refresh: some requests failed');
  return `refreshed: ${n(detail)} matches, ${n(moves)} transfers, ${n(squad)} squad, ${n(coaches)} coaches`;
}

/** Refresh a club if due, waiting at most `waitMs`. One refresh per club at a time. */
export async function refreshTeamOnView(db: Db, teamId: number, waitMs = 5000): Promise<string> {
  if (!(await teamRefreshDue(db, teamId))) return 'fresh';
  let p = inFlight.get(teamId);
  if (!p) {
    p = refresh(db, teamId).catch((err) => { log.warn({ teamId, err: String(err) }, 'team refresh failed'); return 'failed'; }).finally(() => inFlight.delete(teamId));
    inFlight.set(teamId, p);
  }
  return within(p, waitMs, 'still running');
}
