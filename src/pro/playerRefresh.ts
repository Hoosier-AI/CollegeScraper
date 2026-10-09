// Players fetched when someone opens their page and we have little on them yet: transfers, honours, and this and last
// season's numbers in every competition (4 API-Football requests). At most once every 14 days a player, within a
// daily request cap (PRO_PLAYER_REFRESH_PER_DAY, default 400), on the everyday quota floor (live scores and the app
// keep their share). The page waits for it a few seconds at most; anything slower lands for the next visit.
// Only the page's API calls trigger it (the browser app), never the server-rendered pages search bots read.
import type { Db } from '../db/client.js';
import { kvGet, kvSet } from '../db/client.js';
import { getApiFootball, saveQuota } from '../jobs/pro/shared.js';
import { replaceTrophies, upsertSeasonStats, upsertTransfers } from '../db/proRepo.js';
import { parseLeaguePlayers, parseTransfers, parseTrophies, type AfLeaguePlayer, type AfTransferItem, type AfTrophy } from '../sources/apiFootball/parse.js';
import { log } from '../log.js';

const EVERY_DAYS = 14;
const CALLS = 4;
const inFlight = new Map<number, Promise<string>>();

const capPerDay = () => Number(process.env.PRO_PLAYER_REFRESH_PER_DAY) || 400;
const dayKey = () => `pro:player_refresh:${new Date().toISOString().slice(0, 10)}`;

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
  if (api.headroom('everyday') < CALLS + 20) return 'quota floor';
  const spent = Number((await kvGet<number>(db, dayKey())) ?? 0);
  if (spent + CALLS > capPerDay()) return 'daily cap';
  await kvSet(db, dayKey(), spent + CALLS);
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
  return Promise.race([p, new Promise<string>((r) => setTimeout(() => r('still running'), waitMs))]);
}

/** Search engines and link previews read the server-rendered pages; their API calls never spend requests. */
export const isBot = (ua: string | undefined): boolean => !ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget|python|headless/i.test(ua);
