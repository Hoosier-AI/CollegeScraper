// Durable job runner: runs live in college_crawl_runs; the worker claims queued rows, heartbeats,
// and records counters. Jobs are registered by name; a job receives a context with a counters bag.
import { hostname } from 'node:os';
import { kvSet, type Db } from '../db/client.js';
import { KV, crawlPaused } from '../ops/settings.js';
import { log } from '../log.js';
import { withJob } from '../ops/netMeter.js';

export interface JobContext {
  db: Db;
  runId: string | null;
  params: Record<string, unknown>;
  counters: Record<string, number | string | string[]>;
  /** Increment a numeric counter. */
  inc(key: string, by?: number): void;
  note(key: string, value: string | string[]): void;
  /** Returns true when the run was cancelled (worker checks between units of work). */
  cancelled(): Promise<boolean>;
  heartbeat(): Promise<void>;
}

export type JobFn = (ctx: JobContext) => Promise<void>;

/** One parameter a job accepts, enough for the console to draw a form for it. */
export interface ParamSpec { name: string; type: 'number' | 'string' | 'boolean' | 'enum' | 'string[]' | 'json'; label: string; help?: string; default?: unknown; options?: string[]; required?: boolean }
export interface JobMeta {
  description: string;
  /** Which worker lane runs it: everything but the live scoreboard is 'crawl'; Plaibook Stats Pro's everyday jobs run on 'pro'. */
  lane: 'crawl' | 'live' | 'aux' | 'h2h' | 'pro' | 'pro-bulk' | 'sources' | 'history' | 'weekly';
  /** A composite of other jobs (hourly, nightly…). */
  composite?: boolean;
  params: ParamSpec[];
  /** Long or wide-reaching: the console asks before enqueueing. */
  dangerous?: boolean;
}
export interface JobCatalogueEntry extends JobMeta { name: string }

const registry = new Map<string, JobFn>();

export function registerJob(name: string, fn: JobFn): void { registry.set(name, fn); }
export function jobNames(): string[] { return [...registry.keys()].sort(); }
export function getJob(name: string): JobFn | undefined { return registry.get(name); }

export function makeContext(db: Db, runId: string | null, params: Record<string, unknown>): JobContext {
  const counters: JobContext['counters'] = {};
  let lastBeat = 0;
  let cancelledFlag = false;
  const ctx: JobContext = {
    db, runId, params, counters,
    inc(key, by = 1) { counters[key] = (Number(counters[key]) || 0) + by; },
    note(key, value) { counters[key] = value; },
    async cancelled() {
      if (!runId || cancelledFlag) return cancelledFlag;
      const { data } = await db.from('college_crawl_runs').select('status').eq('id', runId).maybeSingle();
      cancelledFlag = data?.status === 'cancelled';
      return cancelledFlag;
    },
    async heartbeat() {
      if (!runId) return;
      const now = Date.now();
      if (now - lastBeat < 30_000) return;
      lastBeat = now;
      await db.from('college_crawl_runs').update({ heartbeat_at: new Date().toISOString(), counters }).eq('id', runId);
    },
  };
  return ctx;
}

/** JSON with every object's keys sorted, at every depth: equal for two objects that differ only in key order. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
    : v;
  return JSON.stringify(sort(value));
}

/** Enqueue a run unless an identical job is already queued/running (returns the existing one then). */
export async function enqueue(db: Db, job: string, params: Record<string, unknown> = {}): Promise<{ id: string; status: string; existing: boolean }> {
  const { data: existing } = await db.from('college_crawl_runs').select('id,status,params').eq('job', job).in('status', ['queued', 'running']).order('created_at', { ascending: true });
  // Compared with keys sorted: Postgres returns a jsonb object's keys ordered by length then bytes, not as written,
  // so `{ season, manual }` never equalled the stored `{ manual, season }` and every repeat click queued another run.
  const want = canonicalJson(params);
  const dup = (existing ?? []).find((r: any) => canonicalJson(r.params ?? {}) === want);
  if (dup) return { id: dup.id, status: dup.status, existing: true };
  const { data, error } = await db.from('college_crawl_runs').insert({ job, params, status: 'queued' }).select('id,status').single();
  if (error?.code === '23505') {
    // Another request queued the same run between the read above and this insert (migration 207 allows one).
    const { data: twins } = await db.from('college_crawl_runs').select('id,status,params').eq('job', job).eq('status', 'queued');
    const twin = (twins ?? []).find((r: any) => canonicalJson(r.params ?? {}) === want);
    if (twin) return { id: twin.id, status: twin.status, existing: true };
  }
  if (error) throw new Error(`enqueue ${job}: ${error.message}`);
  return { id: data.id, status: data.status, existing: false };
}

/** Run a job inline (CLI) — records a run row so history is durable even for manual runs. */
export async function runInline(db: Db, job: string, params: Record<string, unknown> = {}): Promise<JobContext['counters']> {
  const fn = getJob(job);
  if (!fn) throw new Error(`Unknown job ${job}. Known: ${jobNames().join(', ')}`);
  const { data, error } = await db.from('college_crawl_runs').insert({ job, params, status: 'running', started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() }).select('id').single();
  if (error) throw new Error(`record run: ${error.message}`);
  const ctx = makeContext(db, data.id, params);
  return execute(db, ctx, job, fn);
}

async function execute(db: Db, ctx: JobContext, job: string, fn: JobFn): Promise<JobContext['counters']> {
  const started = Date.now();
  // A run whose heartbeat is 10 minutes old is taken to be dead and claimed again. Jobs beat only when they call
  // ctx.heartbeat(), and many long ones never do (ratings, aggregates, reconcile, the composites' long steps), so a
  // healthy run could be started a second time beside itself. The runner now beats for every job while it runs.
  const beat = setInterval(() => {
    void db.from('college_crawl_runs').update({ heartbeat_at: new Date().toISOString() }).eq('id', ctx.runId!).eq('status', 'running')
      .then(({ error }) => { if (error) log.warn({ job, runId: ctx.runId, err: error.message }, 'run heartbeat failed'); }, () => {});
  }, 60_000);
  beat.unref?.();
  // The last write of a run. Only a row still 'running' is closed (a run cancelled meanwhile stays cancelled), the
  // answer is checked (supabase-js does not throw), and a failed write is tried again: left 'running', the whole
  // job was claimed and run a second time.
  const close = async (patch: Record<string, unknown>) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error } = await db.from('college_crawl_runs').update({ ...patch, finished_at: new Date().toISOString(), counters: ctx.counters }).eq('id', ctx.runId!).eq('status', 'running');
      if (!error) return;
      log.warn({ job, runId: ctx.runId, attempt, err: error.message }, 'closing the run failed');
      await sleep(1_000 * attempt);
    }
  };
  try {
    // Bytes the job sends are counted under its name and current step (src/ops/netMeter.ts).
    await withJob(() => { const step = ctx.runId ? runningSteps.get(ctx.runId) : undefined; return step ? `${job} > ${step}` : job; }, () => fn(ctx));
    await close({ status: 'done' });
    log.info({ job, runId: ctx.runId, ms: Date.now() - started, counters: ctx.counters }, 'job done');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await close({ status: 'failed', error: message.slice(0, 2000) });
    log.error({ job, runId: ctx.runId, err: message }, 'job failed');
    throw err;
  } finally {
    clearInterval(beat);
  }
  return ctx.counters;
}

/** The job each lane of this process is running now (the event-loop watchdog in server.ts names them on a stall). */
export const runningJobs = new Map<string, string>();
/** The run each lane is on, and the step a composite job (nightly, weekly...) is inside, by run id: a stall during
 *  "nightly" alone could be any of its ten steps. */
export const laneRuns = new Map<string, string>();
export const runningSteps = new Map<string, string>();
/** Lane → "job" or "job > step", for the watchdog. */
export function runningNow(): Record<string, string> {
  return Object.fromEntries([...runningJobs].map(([lane, job]) => {
    const step = runningSteps.get(laneRuns.get(lane) ?? '');
    return [lane, step ? `${job} > ${step}` : job];
  }));
}

export interface WorkerHeartbeat { at: string; pid: number; host: string; run_id: string | null; job: string | null; started_at: string }

/** Worker loop: claim → execute → repeat; idles when the queue is empty. A named lane writes a heartbeat to
 * college_kv every 30 s (the console and /health read it) and the crawl lane honours the pause flag. */
export async function workerLoop(db: Db, opts: { idleMs?: number; signal?: AbortSignal; jobs?: string[]; exclude?: string[]; lane?: string } = {}): Promise<void> {
  const idleMs = opts.idleMs ?? 15_000;
  log.info({ lane: opts.lane, jobs: opts.jobs ?? jobNames(), exclude: opts.exclude }, 'worker started');
  const startedAt = new Date().toISOString();
  let current: { run_id: string; job: string } | null = null;
  const beat = async () => {
    if (!opts.lane) return;
    const hb: WorkerHeartbeat = { at: new Date().toISOString(), pid: process.pid, host: hostname(), run_id: current?.run_id ?? null, job: current?.job ?? null, started_at: startedAt };
    await kvSet(db, KV.heartbeat(opts.lane, hostname()), hb).catch((err) => log.warn({ err: String(err) }, 'heartbeat write failed'));
  };
  await beat();
  const beatTimer = setInterval(() => { void beat(); }, 30_000);
  opts.signal?.addEventListener('abort', () => clearInterval(beatTimer));
  while (!opts.signal?.aborted) {
    // The pause flag is a database read. A failed read (one 502) used to reject this loop, and the process exits
    // when a lane stops: every lane's job in flight was orphaned. Unknown counts as "not now": wait and ask again.
    if (opts.lane === 'crawl') {
      let paused: boolean;
      try { paused = await crawlPaused(db); } catch (err) { log.warn({ err: String(err) }, 'pause flag unreadable'); await sleep(idleMs); continue; }
      if (paused) { await sleep(idleMs); continue; }
    }
    // Lanes: a loop may claim only some jobs (the live scoreboard) or everything but those (the crawl).
    const { data, error } = await db.rpc('college_claim_run', { p_stale_minutes: 10, p_jobs: opts.jobs ?? null, p_exclude: opts.exclude ?? null });
    if (error) { log.error({ err: error.message }, 'claim failed'); await sleep(idleMs); continue; }
    const run = Array.isArray(data) ? data[0] : data;
    if (!run) { await sleep(idleMs); continue; }
    const fn = getJob(run.job);
    if (!fn) {
      await db.from('college_crawl_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error: `unknown job ${run.job}` }).eq('id', run.id);
      continue;
    }
    const ctx = makeContext(db, run.id, run.params ?? {});
    current = { run_id: run.id, job: run.job }; await beat();
    runningJobs.set(opts.lane ?? 'default', run.job); laneRuns.set(opts.lane ?? 'default', run.id);
    try { await execute(db, ctx, run.job, fn); } catch { /* recorded */ }
    runningJobs.delete(opts.lane ?? 'default'); laneRuns.delete(opts.lane ?? 'default'); runningSteps.delete(run.id);
    current = null;
  }
  clearInterval(beatTimer);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
