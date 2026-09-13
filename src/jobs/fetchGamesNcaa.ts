// Fetch NCAA.com game documents for games with a contest id and store them as source='ncaa'.
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { loadConfig } from '../config.js';
import { GraphqlTransport, NcaaApiTransport, PersistedQueryStore, fetchGameDocs, parseNcaaBoxScore, PersistedQueryNotFoundError, type NcaaGameTransport, type NcaaOp, type PersistedQueryPersistence } from '../sources/ncaa/index.js';
import { kvGet, kvSet, type Db } from '../db/client.js';
import { listGames, statLineCandidates, writeBoxScore, updateGame, type GameRow } from '../db/repos.js';
import { currentSeason } from './seasons.js';
import type { Fetcher } from '../model.js';
import { log } from '../log.js';

class DbPersistence implements PersistedQueryPersistence {
  constructor(private db: Db) {}
  async load() { return kvGet<Partial<Record<NcaaOp, string>>>(this.db, 'ncaa_persisted_hashes'); }
  async save(h: Record<NcaaOp, string>) { await kvSet(this.db, 'ncaa_persisted_hashes', h); }
}

export function makeTransport(db: Db, fetcher: Fetcher): { transport: NcaaGameTransport; store: PersistedQueryStore } {
  const cfg = loadConfig();
  const store = new PersistedQueryStore(new DbPersistence(db));
  const transport: NcaaGameTransport = cfg.NCAA_API_BASE ? new NcaaApiTransport(fetcher, cfg.NCAA_API_BASE) : new GraphqlTransport(fetcher, store);
  return { transport, store };
}

/** params: { season?, gender?, division?, program?, recent_days?: number, refetch?: boolean, limit?: number, contest_ids?: string[] } */
export async function fetchGamesNcaa(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const fetcher = makeFetcher(db);
  const { transport, store } = makeTransport(db, fetcher);
  await store.init();
  let games = (await listGames(db, season, (q) => q.not('ncaa_contest_id', 'is', null))).filter((g) => (!ctx.params.gender || g.gender === ctx.params.gender) && (!ctx.params.division || g.division === ctx.params.division));
  const today = new Date().toISOString().slice(0, 10);
  if (ctx.params.contest_ids) { const want = new Set((ctx.params.contest_ids as string[]).map(String)); games = games.filter((g) => want.has(String(g.ncaa_contest_id))); }
  else if (ctx.params.recent_days) { const since = new Date(Date.now() - Number(ctx.params.recent_days) * 86400000).toISOString().slice(0, 10); games = games.filter((g) => g.game_date >= since && g.game_date <= today); }
  if (typeof ctx.params.program === 'string') {
    const { data } = await db.from('college_programs').select('id').eq('school_seo', ctx.params.program);
    const ids = new Set((data ?? []).map((r: any) => r.id));
    games = games.filter((g) => (g.home_program_id && ids.has(g.home_program_id)) || (g.away_program_id && ids.has(g.away_program_id)));
  }
  // Only games that should have a final box score: past dates, not already fetched (unless refetch), attempts < 3 for non-final.
  games = games.filter((g) => g.game_date <= today && (ctx.params.refetch || !g.ncaa_fetched_at) && (g.status !== 'postponed' && g.status !== 'cancelled'));
  if (ctx.params.limit) games = games.slice(0, Number(ctx.params.limit));
  ctx.inc('games_selected', games.length);
  const candCache = new Map<string, Awaited<ReturnType<typeof statLineCandidates>>>();
  for (const g of games) {
    if (await ctx.cancelled()) return;
    try {
      const docs = await fetchGameDocs(transport, String(g.ncaa_contest_id));
      const box = parseNcaaBoxScore(docs, String(g.ncaa_contest_id), g.gender, (g.division ?? 'd1') as 'd1' | 'd2' | 'd3', g.game_date);
      if (box.status !== 'final') {
        await updateGame(db, g.id, { detail_attempts: (g.detail_attempts ?? 0) + 1, ncaa_fetched_at: new Date().toISOString(), status: box.status === 'live' ? 'live' : g.status, ...(g.detail_attempts >= 2 && daysAgo(g.game_date) > 3 ? { status: 'postponed' } : {}) });
        ctx.inc('not_final'); continue;
      }
      for (const pid of [g.home_program_id, g.away_program_id]) if (pid && !candCache.has(pid)) candCache.set(pid, await statLineCandidates(db, pid, season));
      const r = await writeBoxScore(db, { gameId: g.id, source: 'ncaa', homeProgramId: g.home_program_id, awayProgramId: g.away_program_id, box, candidates: candCache, season, createMissing: true });
      ctx.inc('boxscores'); ctx.inc('player_rows', r.playerRows); ctx.inc('events', r.events); ctx.inc('boxscore_only_players', r.createdPlayers);
      if (!r.valid) ctx.inc('invalid');
    } catch (err) {
      ctx.inc('errors');
      if (err instanceof PersistedQueryNotFoundError) { ctx.inc('persisted_query_failures'); }
      await updateGame(db, g.id, { detail_attempts: (g.detail_attempts ?? 0) + 1 }).catch(() => {});
      log.warn({ contest: g.ncaa_contest_id, err: err instanceof Error ? err.message : String(err) }, 'ncaa game fetch failed');
    }
    await ctx.heartbeat();
  }
}

function daysAgo(iso: string): number { return (Date.now() - Date.parse(`${iso}T12:00:00Z`)) / 86400000; }

/** Weekly health check: one known contest through the live transport; refreshes hashes on failure. */
registerJob('pq-health', async (ctx) => {
  const fetcher = makeFetcher(ctx.db);
  const { transport, store } = makeTransport(ctx.db, fetcher);
  await store.init();
  try {
    const docs = await fetchGameDocs(transport, '6310566', { skipGamecenter: true });
    const box = parseNcaaBoxScore(docs, '6310566', 'm', 'd1', '2024-10-05');
    ctx.note('status', box.status === 'final' && box.home.players.length > 0 ? 'ok' : 'unexpected');
  } catch (err) {
    ctx.note('status', 'failed'); ctx.note('error', err instanceof Error ? err.message : String(err));
    try { const r = await store.refresh(fetcher); ctx.note('refreshed', r.updated); } catch (e) { ctx.note('refresh_error', e instanceof Error ? e.message : String(e)); }
  }
});

registerJob('fetch-games-ncaa', fetchGamesNcaa);
export type { GameRow };
