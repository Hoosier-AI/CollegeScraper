// Runtime settings and flags the console edits without a redeploy. Stored in college_kv, read with a short
// in-process cache so hot paths (scheduler tick, worker claim, live job) cost one round trip every few seconds.
import { kvGet, kvSet, type Db } from '../db/client.js';

export interface LiveSettings {
  /** Minutes between scoreboard reads while games are pending (1 = every scheduler minute). */
  scoreboard_every_min: number;
  /** Store each live game's box score / play-by-play snapshot. */
  detail_enabled: boolean;
  /** Minutes before a live game's snapshot is refreshed. */
  detail_every_min: number;
  /** Most games refreshed per tick (two requests each on the same host). */
  detail_budget: number;
  /** How long one live run may spend on snapshots before yielding to the next tick. */
  tick_budget_ms: number;
}
export const LIVE_DEFAULTS: LiveSettings = { scoreboard_every_min: 1, detail_enabled: true, detail_every_min: 2, detail_budget: 25, tick_budget_ms: 50_000 };

export type SchedulerOverrides = Record<string, { enabled: boolean }>;

export const KV = {
  live: 'settings:live',
  contactEmail: 'settings:contact_email',
  schedulerPaused: 'scheduler:paused',
  schedulerOverrides: 'scheduler:overrides',
  schedulerState: 'scheduler:state',
  crawlPaused: 'crawl:paused',
  /** One key per lane per host, so a laptop running the service never masks a dead lane on Render. */
  heartbeat: (lane: string, host: string) => `worker:heartbeat:${lane}@${host}`,
  heartbeatPrefix: 'worker:heartbeat:',
} as const;

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: unknown }>();

export async function cachedKv<T>(db: Db, key: string, fallback: T, ttlMs = TTL_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const v = (await kvGet<T>(db, key)) ?? fallback;
  cache.set(key, { at: Date.now(), value: v });
  return v;
}

export async function setKv<T>(db: Db, key: string, value: T): Promise<void> {
  await kvSet(db, key, value as unknown);
  cache.set(key, { at: Date.now(), value });
}

export function forgetKv(key?: string): void { if (key) cache.delete(key); else cache.clear(); }

const num = (v: unknown, d: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

/** Stored live settings merged over the defaults and clamped to sane ranges. */
export function normalizeLive(raw: Partial<LiveSettings> | null | undefined): LiveSettings {
  const r = raw ?? {};
  return {
    scoreboard_every_min: num(r.scoreboard_every_min, LIVE_DEFAULTS.scoreboard_every_min, 1, 10),
    detail_enabled: r.detail_enabled == null ? LIVE_DEFAULTS.detail_enabled : !!r.detail_enabled,
    detail_every_min: num(r.detail_every_min, LIVE_DEFAULTS.detail_every_min, 1, 15),
    detail_budget: num(r.detail_budget, LIVE_DEFAULTS.detail_budget, 0, 60),
    tick_budget_ms: num(r.tick_budget_ms, LIVE_DEFAULTS.tick_budget_ms, 10_000, 55_000),
  };
}

export async function liveSettings(db: Db): Promise<LiveSettings> { return normalizeLive(await cachedKv<Partial<LiveSettings> | null>(db, KV.live, null)); }
export const schedulerPaused = (db: Db) => cachedKv<boolean>(db, KV.schedulerPaused, false);
export const crawlPaused = (db: Db) => cachedKv<boolean>(db, KV.crawlPaused, false);
export const schedulerOverrides = (db: Db) => cachedKv<SchedulerOverrides>(db, KV.schedulerOverrides, {});
