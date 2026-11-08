// Every worker lane and the scheduler. Runs in the child process (src/worker.ts), so a heavy job can stall or
// exhaust only the crawl, never the website. (WORKERS_INLINE=1 runs it inside the web process again.)
import { workerLoop } from './jobs/runner.js';
import { startScheduler } from './jobs/scheduler.js';
import { getDb } from './db/client.js';
import { log } from './log.js';
import { CHECK_JOBS } from './pro/crawlSites.js';
import { AUX_JOBS, PRO_BULK_JOBS, PRO_LANE_JOBS, SOURCE_JOBS } from './jobs/catalogue.js';
import type { Config } from './config.js';

export function startWorkers(controller: AbortController, cfg: Pick<Config, 'WORKERS_ENABLED' | 'SCHEDULER_ENABLED'>): void {
  if (cfg.WORKERS_ENABLED !== '0') {
    // Three lanes: the crawl (minutes to hours per run), the live scoreboard (seconds, every minute in game hours) and short side jobs.
    workerLoop(getDb(), { signal: controller.signal, exclude: ['live', 'h2h-detail', 'backfill', 'weekly', ...AUX_JOBS, ...PRO_LANE_JOBS, ...PRO_BULK_JOBS, ...SOURCE_JOBS], lane: 'crawl' }).catch((err) => { log.error({ err: String(err) }, 'worker crashed'); process.exit(1); });
    workerLoop(getDb(), { signal: controller.signal, jobs: ['live'], idleMs: 10_000, lane: 'live' }).catch((err) => { log.error({ err: String(err) }, 'live worker crashed'); process.exit(1); });
    // A third lane for short side jobs (finals' box scores, weather, ratings, sims, RPI, Elo, the stat audit) so they
    // never wait hours behind the nightly crawl. They also keep running while the college crawl is paused.
    workerLoop(getDb(), { signal: controller.signal, jobs: AUX_JOBS, idleMs: 15_000, lane: 'aux' }).catch((err) => { log.error({ err: String(err) }, 'aux worker crashed'); process.exit(1); });
    // A second worker for finished college matches' box scores (since the 2 GB instance, 2026-10-15): a busy night's
    // finals no longer queue for hours behind one worker. Each run claims its own games.
    workerLoop(getDb(), { signal: controller.signal, jobs: ['final-detail'], idleMs: 15_000, lane: 'aux-b' }).catch((err) => { log.error({ err: String(err) }, 'aux-b worker crashed'); process.exit(1); });
    // A fourth for Plaibook Stats Pro's everyday jobs (scores, detail, tables): seconds each, all year, never behind a college crawl.
    workerLoop(getDb(), { signal: controller.signal, jobs: PRO_LANE_JOBS, idleMs: 10_000, lane: 'pro' }).catch((err) => { log.error({ err: String(err) }, 'pro worker crashed'); process.exit(1); });
    // A second worker that only takes pro-live (2026-11-02): full time used to wait behind pro-predictions (up to 800
    // requests every 3 h) or pro-leaders on the one pro worker, so a final reached Plaibook 8-16 min after the whistle.
    workerLoop(getDb(), { signal: controller.signal, jobs: ['pro-live'], idleMs: 10_000, lane: 'pro-live' }).catch((err) => { log.error({ err: String(err) }, 'pro-live worker crashed'); process.exit(1); });
    // A fifth for the pro bulk crawl (minutes per run): never behind the college crawl, never in front of live pro scores.
    workerLoop(getDb(), { signal: controller.signal, jobs: PRO_BULK_JOBS, idleMs: 15_000, lane: 'pro-bulk' }).catch((err) => { log.error({ err: String(err) }, 'pro-bulk worker crashed'); process.exit(1); });
    // A past season's full backfill (2024, 2025: days of school-site pages): its own lane, so hourly, nightly and the
    // standings never wait behind it. School sites keep their per-host limits in the shared fetch client.
    // The weekly full pass takes about a day: its own lane, so the nightly, hourly and standings runs never queue behind it.
    workerLoop(getDb(), { signal: controller.signal, jobs: ['weekly'], idleMs: 60_000, lane: 'weekly' }).catch((err) => { log.error({ err: String(err) }, 'weekly worker crashed'); process.exit(1); });
    workerLoop(getDb(), { signal: controller.signal, jobs: ['backfill'], idleMs: 30_000, lane: 'history' }).catch((err) => { log.error({ err: String(err) }, 'history worker crashed'); process.exit(1); });
    // Box scores for earlier meetings a match page asked for: their own lane, so a backlog never holds up final-detail.
    workerLoop(getDb(), { signal: controller.signal, jobs: ['h2h-detail'], idleMs: 15_000, lane: 'h2h' }).catch((err) => { log.error({ err: String(err) }, 'h2h worker crashed'); process.exit(1); });
    // The scraped and open sources (ASA, Wikipedia, openfootball ...): two workers that download, side by side (each
    // site keeps its own per-host limit in the shared client), and one that matches, checks and fills, one job at a
    // time so a check never runs in the middle of a matching pass. Never on API-Football's quota.
    const fetchJobs = SOURCE_JOBS.filter((j) => !CHECK_JOBS.includes(j) && j !== 'asa-fill');
    const checkJobs = SOURCE_JOBS.filter((j) => !fetchJobs.includes(j));
    for (const lane of ['sources-a', 'sources-b']) workerLoop(getDb(), { signal: controller.signal, jobs: fetchJobs, idleMs: 15_000, lane }).catch((err) => { log.error({ err: String(err), lane }, 'sources worker crashed'); process.exit(1); });
    workerLoop(getDb(), { signal: controller.signal, jobs: checkJobs, idleMs: 15_000, lane: 'sources' }).catch((err) => { log.error({ err: String(err) }, 'sources worker crashed'); process.exit(1); });
  }
  if (cfg.SCHEDULER_ENABLED === '1') startScheduler(getDb(), { signal: controller.signal });
}
