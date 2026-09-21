// Durable job runner: runs live in college_crawl_runs; the worker claims queued rows, heartbeats,
// and records counters. Jobs are registered by name; a job receives a context with a counters bag.
import { hostname } from 'node:os';
import { kvSet, type Db } from '../db/client.js';
import { KV, crawlPaused } from '../ops/settings.js';
import { log } from '../log.js';

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
  /** Which worker lane runs it: everything but the live scoreboard is 'crawl'. */
  lane: 'crawl' | 'live';
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

/** Enqueue a run unless an identical job is already queued/running (returns the existing one then). */
export async function enqueue(db: Db, job: string, params: Record<string, unknown> = {}): Promise<{ id: string; status: string; existing: boolean }> {
  const { data: existing } = await db.from('college_crawl_runs').select('id,status,params').eq('job', job).in('status', ['queued', 'running']).order('created_at', { ascending: true });
  const dup = (existing ?? []).find((r: any) => JSON.stringify(r.params ?? {}) === JSON.stringify(params));
  if (dup) return { id: dup.id, status: dup.status, existing: true };
  const { data, error } = await db.from('college_crawl_runs').insert({ job, params, status: 'queued' }).select('id,status').single();
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
  try {
    await fn(ctx);
    await db.from('college_crawl_runs').update({ status: 'done', finished_at: new Date().toISOString(), counters: ctx.counters }).eq('id', ctx.runId!);
    log.info({ job, runId: ctx.runId, ms: Date.now() - started, counters: ctx.counters }, 'job done');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from('college_crawl_runs').update({ status: 'failed', finished_at: new Date().toISOString(), counters: ctx.counters, error: message.slice(0, 2000) }).eq('id', ctx.runId!);
    log.error({ job, runId: ctx.runId, err: message }, 'job failed');
    throw err;
  }
  return ctx.counters;
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
    if (opts.lane === 'crawl' && (await crawlPaused(db))) { await sleep(idleMs); continue; }
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
    try { await execute(db, ctx, run.job, fn); } catch { /* recorded */ }
    current = null;
  }
  clearInterval(beatTimer);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
