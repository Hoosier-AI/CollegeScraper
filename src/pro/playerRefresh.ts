// Players fetched when someone opens their page and we have little on them yet: transfers, honours, and this and last
// season's numbers in every competition (4 API-Football requests). At most once every 14 days a player, within the
// shared on-view cap (onView.ts), on the everyday quota floor (live scores and the app keep their share). The page
// waits for it a few seconds at most; anything slower lands for the next visit. Only the page's API calls trigger it
// (the browser app), never the server-rendered pages search bots read.
import type { Db } from '../db/client.js';
import { getApiFootball, saveQuota } from '../jobs/pro/shared.js';
import { reserveCalls, within } from './onView.js';
import { replaceTrophies, upsertSeasonStats, upsertTransfers } from '../db/proRepo.js';
import { parseLeaguePlayers, parseTransfers, parseTrophies, type AfLeaguePlayer, type AfTransferItem, type AfTrophy } from '../sources/apiFootball/parse.js';
import { log } from '../log.js';

const EVERY_DAYS = 14;
const CALLS = 4;
const inFlight = new Map<number, Promise<string>>();


/** Whether this player is due a refresh (never, or not in the last 14 days). */
export async function refreshDue(db: Db, playerId: number): Promise<boolean> {
  if (playerId <= 0) return false;
  const { data } = await db.from('pro_player_refresh').select('refreshed_at').eq('player_id', playerId).maybeSingle();
  const at = (data as { refreshed_at?: string } | null)?.refreshed_at;
  return !at || Date.now() - Date.parse(at) > EVERY_DAYS * 86400_000;
}

async function refresh(db: Db, playerId: number): Promise<string> {
  const api = getApiFootball();
  if (!api) return 'no key';
  if (!(await reserveCalls(db, api, CALLS))) return 'daily cap or quota floor';
  // Record the attempt first: a failure does not retry on every page view.
  await db.from('pro_player_refresh').upsert({ player_id: playerId, refreshed_at: new Date().toISOString(), calls: CALLS }, { onConflict: 'player_id' });
  const year = new Date().getUTCFullYear();
  const at = new Date().toISOString();
  const [moves, honours, now, last] = await Promise.allSettled([
    api.get<AfTransferItem>('transfers', { player: playerId }, 'everyday'),
    api.get<AfTrophy>('trophies', { player: playerId }, 'everyday'),
    api.get<AfLeaguePlayer>('players', { id: playerId, season: year }, 'everyday'),
    api.get<AfLeaguePlayer>('players', { id: playerId, season: year - 1 }, 'everyday'),
  ]);
  let transfers = 0, rows = 0, trophies = 0;
  if (moves.status === 'fulfilled') transfers = await upsertTransfers(db, parseTransfers(moves.value.response, at));
  if (honours.status === 'fulfilled') trophies = await replaceTrophies(db, 'player', playerId, parseTrophies(honours.value.response, 'player', playerId));
  for (const [r, season] of [[now, year], [last, year - 1]] as const) {
    if (r.status !== 'fulfilled') continue;
    const { stats } = parseLeaguePlayers(r.value.response, null, season, at);
    if (stats.length) { await upsertSeasonStats(db, stats); rows += stats.length; }
  }
  await db.from('pro_player_refresh').upsert({ player_id: playerId, refreshed_at: at, calls: CALLS, transfers, season_rows: rows, trophies }, { onConflict: 'player_id' });
  await saveQuota(db, api.quota);
  const failed = [moves, honours, now, last].filter((r) => r.status === 'rejected').length;
  if (failed) log.warn({ playerId, failed }, 'player refresh: some requests failed');
  return `refreshed: ${transfers} transfers, ${rows} season rows, ${trophies} honours`;
}

/** Refresh a player if due, waiting at most `waitMs`. One refresh per player at a time. */
export async function refreshPlayerOnView(db: Db, playerId: number, waitMs = 5000): Promise<string> {
  if (!(await refreshDue(db, playerId))) return 'fresh';
  let p = inFlight.get(playerId);
  if (!p) {
    p = refresh(db, playerId).catch((err) => { log.warn({ playerId, err: String(err) }, 'player refresh failed'); return 'failed'; }).finally(() => inFlight.delete(playerId));
    inFlight.set(playerId, p);
  }
  return within(p, waitMs, 'still running');
}

export { isBot } from './onView.js';
