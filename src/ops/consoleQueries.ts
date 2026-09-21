// Reads behind the owner's console: service health, runs, schedule, quality snapshots, crawl health, API usage.
// Everything here is cheap (bounded selects, counts, one RPC); the slow quality scan is a job, not a query.
import { hostname } from 'node:os';
import { kvGet, selectAll, type Db } from '../db/client.js';
import { jobNames, type WorkerHeartbeat } from '../jobs/runner.js';
import { JOB_META, metaFor } from '../jobs/catalogue.js';
import { SCHEDULE, nextFire, type SchedulerState } from '../jobs/scheduler.js';
import { KV, liveSettings, schedulerOverrides, schedulerPaused, crawlPaused, cachedKv } from './settings.js';
import { evaluateHealth, type Health } from './health.js';
import { getFetcherStats } from '../jobs/fetcher.js';
import { currentSeason } from '../jobs/seasons.js';
import { loadConfig } from '../config.js';

export const LANES = ['crawl', 'live'];

const count = async (db: Db, table: string, apply: (x: any) => any): Promise<number> => {
  const { count: n, error } = await apply(db.from(table).select('*', { count: 'exact', head: true }));
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
};

/** Every lane heartbeat in the database, keyed "lane@host" (other hosts are dev machines running the service). */
export async function allHeartbeats(db: Db): Promise<Record<string, WorkerHeartbeat>> {
  const { data, error } = await db.from('college_kv').select('key,value').like('key', `${KV.heartbeatPrefix}%`);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((r: any) => [String(r.key).slice(KV.heartbeatPrefix.length), r.value as WorkerHeartbeat]));
}

/** This host's lanes only, as /health judges them. */
export async function heartbeats(db: Db, host = hostname()): Promise<Record<string, WorkerHeartbeat | null>> {
  const all = await allHeartbeats(db).catch(() => ({} as Record<string, WorkerHeartbeat>));
  return Object.fromEntries(LANES.map((lane) => [lane, all[`${lane}@${host}`] ?? null]));
}

export async function health(db: Db, startedAt: number): Promise<Health> {
  let dbOk = true;
  try { const { error } = await db.from('college_kv').select('key').limit(1); dbOk = !error; } catch { dbOk = false; }
  const hb = dbOk ? await heartbeats(db) : Object.fromEntries(LANES.map((l) => [l, null]));
  return evaluateHealth({ now: Date.now(), startedAt, dbOk, dbLastOkAt: dbOk ? Date.now() : null, heartbeats: hb, lanes: LANES });
}

export async function schedule(db: Db) {
  const [state, overrides, paused, live] = await Promise.all([kvGet<SchedulerState>(db, KV.schedulerState), schedulerOverrides(db), schedulerPaused(db), liveSettings(db)]);
  const now = new Date();
  const cfg = loadConfig();
  return {
    enabled: cfg.SCHEDULER_ENABLED === '1',
    paused,
    tick_at: state?.tick_at ?? null,
    entries: SCHEDULE.map((e) => ({
      job: e.job, label: e.label, cadence: e.cadence,
      enabled: overrides[e.job]?.enabled !== false,
      last_fired: state?.last_fired?.[e.job] ?? null,
      next: paused || overrides[e.job]?.enabled === false ? null : (state?.next?.[e.job] ?? nextFire(e, now, live)?.toISOString() ?? null),
      gated: !!e.gate,
    })),
  };
}

export interface RunFilter { job?: string; status?: string; since?: string; hide_live?: boolean; limit?: number; offset?: number }

export async function runsPage(db: Db, f: RunFilter) {
  const limit = Math.min(200, Math.max(1, f.limit ?? 50)), offset = Math.max(0, f.offset ?? 0);
  let q = db.from('college_crawl_runs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (f.job) q = q.eq('job', f.job);
  if (f.status) q = q.eq('status', f.status);
  if (f.since) q = q.gte('created_at', f.since);
  if (f.hide_live && f.job !== 'live') q = q.neq('job', 'live');
  const { data, error, count: total } = await q;
  if (error) { if (/416|range/i.test(error.message)) return { rows: [], total: 0, limit, offset }; throw new Error(error.message); }
  return { rows: data ?? [], total: total ?? 0, limit, offset };
}

/** Per job: the newest done and the newest failed run, plus queued/running counts. */
export async function jobRollup(db: Db) {
  const recent = await selectAll<any>(db, 'college_crawl_runs', 'id,job,status,created_at,started_at,finished_at,error,counters', (q) => q.gte('created_at', new Date(Date.now() - 14 * 86400_000).toISOString()).order('created_at', { ascending: false }));
  const by: Record<string, { last_done: any | null; last_failed: any | null; queued: number; running: number }> = {};
  for (const name of jobNames()) by[name] = { last_done: null, last_failed: null, queued: 0, running: 0 };
  for (const r of recent) {
    const j = (by[r.job] ??= { last_done: null, last_failed: null, queued: 0, running: 0 });
    if (r.status === 'done' && !j.last_done) j.last_done = { id: r.id, finished_at: r.finished_at, started_at: r.started_at };
    if (r.status === 'failed' && !j.last_failed) j.last_failed = { id: r.id, finished_at: r.finished_at, error: r.error };
    if (r.status === 'queued') j.queued += 1;
    if (r.status === 'running') j.running += 1;
  }
  return by;
}

export function catalogue() {
  return jobNames().map((name) => ({ name, ...metaFor(name), scheduled: SCHEDULE.some((e) => e.job === name) }));
}

export async function overview(db: Db, startedAt: number, usageToday: { principal: string; requests: number; limited: number }[]) {
  const season = currentSeason();
  const [h, sched, rollup, live, running, queued, programs, games, finals, boxFinals, liveGames, liveDetail, lastLive, usage, cfgFlags, everyBeat] = await Promise.all([
    health(db, startedAt),
    schedule(db),
    jobRollup(db),
    liveSettings(db),
    db.from('college_crawl_runs').select('id,job,params,started_at,heartbeat_at,counters').eq('status', 'running').order('started_at', { ascending: true }).then((r) => r.data ?? []),
    count(db, 'college_crawl_runs', (x) => x.eq('status', 'queued')),
    count(db, 'college_program_seasons', (x) => x.eq('season', season).eq('ncaa_member', true)),
    count(db, 'college_games', (x) => x.eq('season', season)),
    count(db, 'college_games', (x) => x.eq('season', season).eq('status', 'final')),
    count(db, 'college_games', (x) => x.eq('season', season).eq('status', 'final').not('source_of_truth', 'is', null)),
    count(db, 'college_games', (x) => x.eq('season', season).eq('status', 'live')),
    count(db, 'college_games', (x) => x.eq('season', season).eq('status', 'live').gte('live_stats_at', new Date(Date.now() - 5 * 60_000).toISOString())),
    db.from('college_crawl_runs').select('id,status,finished_at,counters,error').eq('job', 'live').order('created_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data),
    usageStored(db, 1),
    Promise.all([crawlPaused(db), schedulerPaused(db)]),
    allHeartbeats(db).catch(() => ({} as Record<string, WorkerHeartbeat>)),
  ]);
  const me = hostname();
  const others = Object.entries(everyBeat).filter(([k]) => !k.endsWith(`@${me}`)).map(([k, v]) => ({ lane: k.split('@')[0]!, host: k.split('@')[1] ?? '', at: v.at, job: v.job, alive: Date.now() - Date.parse(v.at) < 90_000 }));
  const todayMap = new Map<string, { requests: number; limited: number }>();
  for (const u of usage) todayMap.set(u.principal, { requests: u.requests, limited: u.limited });
  for (const u of usageToday) { const c = todayMap.get(u.principal) ?? { requests: 0, limited: 0 }; c.requests += u.requests; c.limited += u.limited; todayMap.set(u.principal, c); }
  return {
    season, host: me, health: h, other_hosts: others, scheduler: sched, live: { settings: live, games_live: liveGames, with_fresh_stats: liveDetail, last_run: lastLive },
    queue: { queued, running },
    jobs: rollup,
    counts: { programs, games, finals, finals_with_box: boxFinals, box_coverage: finals ? Math.round((boxFinals / finals) * 1000) / 10 : null },
    api_today: [...todayMap].map(([principal, c]) => ({ principal, ...c })).sort((a, b) => b.requests - a.requests),
    flags: { crawl_paused: cfgFlags[0], scheduler_paused: cfgFlags[1] },
    generated_at: new Date().toISOString(),
  };
}

export async function usageStored(db: Db, days: number) {
  const since = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await db.from('college_api_usage').select('*').gte('day', since).order('day', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { day: string; principal: string; requests: number; limited: number; last_seen_at: string | null }[];
}

export async function qualityHistory(db: Db, season: number, limit = 30) {
  const { data, error } = await db.from('college_quality_snapshots').select('id,season,taken_at,run_id,games,finals,checks').eq('season', season).order('taken_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const latest = rows[0] ?? null, previous = rows[1] ?? null;
  const prevCount = new Map<string, number>((previous?.checks ?? []).map((c: any) => [c.id, c.count]));
  const history: Record<string, { taken_at: string; count: number }[]> = {};
  for (const r of [...rows].reverse()) for (const c of r.checks ?? []) (history[c.id] ??= []).push({ taken_at: r.taken_at, count: c.count });
  return {
    season,
    latest: latest ? { ...latest, checks: (latest.checks as any[]).map((c) => ({ ...c, previous: prevCount.get(c.id) ?? null, delta: prevCount.has(c.id) ? c.count - prevCount.get(c.id)! : null })) } : null,
    previous_taken_at: previous?.taken_at ?? null,
    history,
    snapshots: rows.length,
  };
}

export async function crawlHealth(db: Db) {
  const hostStats = async (hours: number) => { const { data, error } = await db.rpc('college_fetch_host_stats', { p_since: new Date(Date.now() - hours * 3600_000).toISOString() }); if (error) throw new Error(error.message); return (data ?? []) as any[]; };
  const [h24, d7, paused, schedPaused, cacheRows] = await Promise.all([hostStats(24), hostStats(24 * 7), crawlPaused(db), schedulerPaused(db), count(db, 'college_source_fetches', (x) => x)]);
  return { hosts_24h: h24, hosts_7d: d7, process: getFetcherStats(), flags: { crawl_paused: paused, scheduler_paused: schedPaused }, cache_rows: cacheRows, generated_at: new Date().toISOString() };
}

export async function settings(db: Db) {
  const [live, paused, crawl, overrides, contact] = await Promise.all([liveSettings(db), schedulerPaused(db), crawlPaused(db), schedulerOverrides(db), cachedKv<string | null>(db, KV.contactEmail, null)]);
  return { live, scheduler_paused: paused, crawl_paused: crawl, overrides, contact_email: contact ?? loadConfig().contactEmail, jobs: Object.keys(JOB_META) };
}
