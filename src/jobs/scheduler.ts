// In-process scheduler (replaces Render cron services): once a minute, enqueue the composite jobs whose slot
// comes up. enqueue() dedupes, so overlapping slots never double-queue. The table below is the whole
// schedule; the console reads it (with last/next fire times from scheduler:state), can pause the lot or disable
// one entry (scheduler:paused / scheduler:overrides in college_kv), and the live cadence comes from settings:live.
//   live      — every minute (settings) 11:00–02:00 Eastern in season, only while a game today is unfinished
//   hourly    — every 30 min, Aug–Dec (in season)
//   standings — every 3 h at :15, Aug–Dec (conference standings pages + record verification)
//   nightly   — 08:15 UTC daily
//   weekly    — Tuesdays 15:00 UTC
import type { Db } from '../db/client.js';
import { enqueue } from './runner.js';
import { currentSeason, eastern, inLiveWindow, liveDates } from './seasons.js';
import { pendingLiveCount } from './liveScoreboard.js';
import { liveSettings, schedulerOverrides, schedulerPaused, setKv, KV, type LiveSettings } from '../ops/settings.js';
import { log } from '../log.js';

export interface ScheduleClock { m: number; h: number; month: number; dow: number; et: ReturnType<typeof eastern>; live: LiveSettings }
export interface ScheduleEntry {
  job: string;
  label: string;
  /** Plain-words cadence for the console. */
  cadence: string;
  /** Is this UTC minute the entry's slot (in-season gating included)? Pure. */
  due(c: ScheduleClock): boolean;
  /** An extra check that needs the database (the live job only fires while a game is unfinished). */
  gate?(db: Db, now: Date, season: number): Promise<boolean>;
}

const inSeason = (c: ScheduleClock) => c.month >= 8 && c.month <= 12;

export const SCHEDULE: ScheduleEntry[] = [
  { job: 'live', label: 'Live scores and stats', cadence: 'every minute, 11:00–02:00 ET, Aug–Dec, while a game is unfinished', due: (c) => c.m % c.live.scoreboard_every_min === 0 && inLiveWindow(c.et), gate: async (db, now, season) => (await pendingLiveCount(db, season, liveDates(eastern(now)), Math.floor(now.getTime() / 1000))) > 0 },
  { job: 'hourly', label: 'Scores, box scores, aggregates', cadence: 'every 30 minutes, Aug–Dec', due: (c) => (c.m === 0 || c.m === 30) && inSeason(c) },
  { job: 'standings', label: 'Standings, polls, record checks', cadence: 'every 3 hours at :15, Aug–Dec', due: (c) => c.m === 15 && c.h % 3 === 0 && inSeason(c) },
  { job: 'nightly', label: 'Nightly crawl', cadence: 'daily 08:15 UTC', due: (c) => c.h === 8 && c.m === 15 },
  { job: 'weekly', label: 'Weekly full re-sync', cadence: 'Tuesdays 15:00 UTC', due: (c) => c.dow === 2 && c.h === 15 && c.m === 0 },
];

export function clockAt(now: Date, live: LiveSettings): ScheduleClock {
  return { m: now.getUTCMinutes(), h: now.getUTCHours(), month: now.getUTCMonth() + 1, dow: now.getUTCDay(), et: eastern(now), live };
}

/** The next minute after `from` at which the entry is due (gate not considered), or null within 8 days. */
export function nextFire(entry: ScheduleEntry, from: Date, live: LiveSettings): Date | null {
  const t = new Date(from); t.setUTCSeconds(0, 0);
  for (let i = 1; i <= 8 * 24 * 60; i++) {
    t.setUTCMinutes(t.getUTCMinutes() + 1);
    if (entry.due(clockAt(t, live))) return new Date(t);
  }
  return null;
}

export interface SchedulerState { tick_at: string; last_fired: Record<string, string>; next: Record<string, string | null>; paused: boolean }

export function startScheduler(db: Db, opts: { signal?: AbortSignal } = {}): void {
  let lastSlot = '';
  const lastFired: Record<string, string> = {};
  const tick = async () => {
    const now = new Date();
    const key = now.toISOString().slice(0, 16); // minute resolution
    if (key === lastSlot) return;
    lastSlot = key;
    const season = currentSeason();
    try {
      const [paused, overrides, live] = await Promise.all([schedulerPaused(db), schedulerOverrides(db), liveSettings(db)]);
      const c = clockAt(now, live);
      if (!paused) {
        for (const e of SCHEDULE) {
          if (overrides[e.job]?.enabled === false || !e.due(c)) continue;
          if (e.gate && !(await e.gate(db, now, season))) continue;
          await enqueue(db, e.job, { season, scheduled: true });
          lastFired[e.job] = now.toISOString();
        }
      }
      const state: SchedulerState = { tick_at: now.toISOString(), last_fired: lastFired, next: Object.fromEntries(SCHEDULE.map((e) => [e.job, nextFire(e, now, live)?.toISOString() ?? null])), paused };
      await setKv(db, KV.schedulerState, state);
    } catch (err) { log.warn({ err: err instanceof Error ? err.message : String(err) }, 'scheduler tick failed'); }
  };
  const timer = setInterval(() => { void tick(); }, 20_000);
  opts.signal?.addEventListener('abort', () => clearInterval(timer));
  log.info('scheduler started (live every minute in game hours, hourly + standings every 3 h in season, nightly 08:15 UTC, weekly Tue 15:00 UTC)');
}
