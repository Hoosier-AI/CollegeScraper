// What the pro jobs share: one API-Football client per process (so the quota count and the per-minute pace hold
// across jobs), the quota snapshot the console reads, and small date helpers. Every pro job is a no-op without
// API_FOOTBALL_KEY, so a laptop or a test database never spends Plaibook's requests by accident.
import { loadConfig } from '../../config.js';
import { kvSet, type Db } from '../../db/client.js';
import { ApiFootball, QuotaExhausted, type QuotaState } from '../../sources/apiFootball/client.js';
import type { JobContext } from '../runner.js';
import { log } from '../../log.js';

let shared: ApiFootball | null = null;

export function getApiFootball(): ApiFootball | null {
  if (shared) return shared;
  const cfg = loadConfig();
  if (!cfg.API_FOOTBALL_KEY) return null;
  shared = new ApiFootball({ key: cfg.API_FOOTBALL_KEY, base: cfg.API_FOOTBALL_BASE, reserve: cfg.PRO_RESERVE, backfillReserve: cfg.PRO_BACKFILL_RESERVE, perMinute: cfg.PRO_PER_MIN });
  return shared;
}

/** Tests inject a client over recorded answers. */
export function setApiFootball(c: ApiFootball | null): void { shared = c; }

export const PRO_QUOTA_KEY = 'pro:quota';

export async function saveQuota(db: Db, q: QuotaState | undefined): Promise<void> {
  if (!q) return;
  await kvSet(db, PRO_QUOTA_KEY, { ...q, saved_at: new Date().toISOString() }).catch((err) => log.warn({ err: String(err) }, 'pro quota snapshot not saved'));
}

/**
 * Run a pro job body with the client, recording the quota afterwards. A spent quota floor is not a failure: the job
 * notes it and stops, and the next scheduled run picks up where it left off.
 */
export async function withApi(ctx: JobContext, body: (api: ApiFootball) => Promise<void>): Promise<void> {
  const api = getApiFootball();
  if (!api) { ctx.note('skipped', 'API_FOOTBALL_KEY is not set'); return; }
  const before = api.quota.used;
  try {
    await body(api);
  } catch (err) {
    if (!(err instanceof QuotaExhausted)) throw err;
    ctx.note('stopped', err.message);
  } finally {
    ctx.inc('api_calls', api.quota.used - before);
    if (api.quota.remaining != null) ctx.note('api_remaining', String(api.quota.remaining));
    await saveQuota(ctx.db, api.quota);
  }
}

export const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number): string => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export const numList = (v: unknown): number[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
