// Durable job runner: runs live in college_crawl_runs; the worker claims queued rows, heartbeats,
// and records counters. Jobs are registered by name; a job receives a context with a counters bag.
import type { Db } from '../db/client.js';
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

/** Worker loop: claim → execute → repeat; idles when the queue is empty. */
export async function workerLoop(db: Db, opts: { idleMs?: number; signal?: AbortSignal; jobs?: string[]; exclude?: string[] } = {}): Promise<void> {
  const idleMs = opts.idleMs ?? 15_000;
  log.info({ jobs: opts.jobs ?? jobNames(), exclude: opts.exclude }, 'worker started');
  while (!opts.signal?.aborted) {
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
    try { await execute(db, ctx, run.job, fn); } catch { /* recorded */ }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
