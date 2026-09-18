// In-process scheduler (replaces Render cron services): once a minute, enqueue the composite jobs
// when their slot comes up. enqueue() dedupes, so overlapping slots never double-queue.
//   hourly    — every 30 min, Aug–Dec (in season)
//   standings — every 3 h at :15, Aug–Dec (conference standings pages + record verification)
//   nightly — 08:15 UTC daily
//   weekly  — Tuesdays 15:00 UTC
import type { Db } from '../db/client.js';
import { enqueue } from './runner.js';
import { currentSeason } from './seasons.js';
import { log } from '../log.js';

export function startScheduler(db: Db, opts: { signal?: AbortSignal } = {}): void {
  let lastSlot = '';
  const tick = async () => {
    const now = new Date();
    const key = now.toISOString().slice(0, 16); // minute resolution
    if (key === lastSlot) return;
    lastSlot = key;
    const m = now.getUTCMinutes(), h = now.getUTCHours(), month = now.getUTCMonth() + 1, dow = now.getUTCDay();
    const season = currentSeason();
    try {
      if ((m === 0 || m === 30) && month >= 8 && month <= 12) await enqueue(db, 'hourly', { season, scheduled: true });
      if (m === 15 && h % 3 === 0 && month >= 8 && month <= 12) await enqueue(db, 'standings', { season, scheduled: true });
      if (h === 8 && m === 15) await enqueue(db, 'nightly', { season, scheduled: true });
      if (dow === 2 && h === 15 && m === 0) await enqueue(db, 'weekly', { season, scheduled: true });
    } catch (err) { log.warn({ err: err instanceof Error ? err.message : String(err) }, 'scheduler enqueue failed'); }
  };
  const timer = setInterval(() => { void tick(); }, 20_000);
  opts.signal?.addEventListener('abort', () => clearInterval(timer));
  log.info('scheduler started (hourly + standings every 3 h in season, nightly 08:15 UTC, weekly Tue 15:00 UTC)');
}
