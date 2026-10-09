// Pure: the pro crawl queue (pro_crawl_progress rows) and recent run counters -> the progress document the console
// and the PlaibookOS hub show: per kind and per tier, requests per day, and an estimate of the days left.

export interface ProgressRow { kind: string; tier: number; tasks: number; done: number; due: number; errors: number; calls: number; done_calls: number; pages_left: number; never_done: number }
export interface KindProgress { kind: string; tasks: number; done: number; due: number; errors: number; calls: number; pages_left: number; never_done: number; pct: number; calls_left: number }
export interface TierProgress { tier: number; tasks: number; done: number; due: number; never_done: number; pct: number; calls_left: number }
export interface RunCounters { job: string; finished_at: string | null; counters: Record<string, unknown> | null }

/** Requests one task of a kind usually costs, before the crawl has finished any (then: its own average). */
const DEFAULT_CALLS: Record<string, number> = { league_players: 25, detail: 8 };

const pct = (done: number, tasks: number) => (tasks ? Math.round((done / tasks) * 1000) / 10 : 100);

/**
 * Requests still to spend on a group of rows: due tasks times the average a finished task of the kind cost; a paged
 * kind that has started knows its own pages left.
 */
export function callsLeft(rows: ProgressRow[]): number {
  let left = 0;
  const byKind = new Map<string, ProgressRow[]>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  for (const [kind, list] of byKind) {
    const done = list.reduce((n, r) => n + r.done, 0), doneCalls = list.reduce((n, r) => n + r.done_calls, 0);
    const avg = done > 0 && doneCalls > 0 ? doneCalls / done : DEFAULT_CALLS[kind] ?? 1;
    for (const r of list) left += Math.max(r.pages_left, Math.round(r.due * avg));
  }
  return left;
}

export function byKind(rows: ProgressRow[]): KindProgress[] {
  const m = new Map<string, ProgressRow[]>();
  for (const r of rows) m.set(r.kind, [...(m.get(r.kind) ?? []), r]);
  return [...m.entries()].map(([kind, list]) => {
    const s = (k: keyof ProgressRow) => list.reduce((n, r) => n + Number(r[k] ?? 0), 0);
    const tasks = s('tasks'), done = s('done');
    return { kind, tasks, done, due: s('due'), errors: s('errors'), calls: s('calls'), pages_left: s('pages_left'), never_done: s('never_done'), pct: pct(done, tasks), calls_left: callsLeft(list) };
  });
}

export function byTier(rows: ProgressRow[]): TierProgress[] {
  const m = new Map<number, ProgressRow[]>();
  for (const r of rows) m.set(r.tier, [...(m.get(r.tier) ?? []), r]);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([tier, list]) => {
    const tasks = list.reduce((n, r) => n + r.tasks, 0), done = list.reduce((n, r) => n + r.done, 0);
    return { tier, tasks, done, due: list.reduce((n, r) => n + r.due, 0), never_done: list.reduce((n, r) => n + r.never_done, 0), pct: pct(done, tasks), calls_left: callsLeft(list) };
  });
}

/** API requests per UTC day from finished pro runs' counters, oldest first, `days` days ending today (zeros kept). */
export function callsPerDay(runs: RunCounters[], days = 7, now = Date.now(), only?: (job: string) => boolean): { day: string; calls: number; crawl: number }[] {
  const out = new Map<string, { calls: number; crawl: number }>();
  for (let i = days - 1; i >= 0; i -= 1) out.set(new Date(now - i * 86400_000).toISOString().slice(0, 10), { calls: 0, crawl: 0 });
  for (const r of runs) {
    if (!r.finished_at || (only && !only(r.job))) continue;
    const d = out.get(r.finished_at.slice(0, 10));
    const n = Number(r.counters?.api_calls) || 0;
    if (!d || !n) continue;
    d.calls += n;
    if (r.job === 'pro-crawl') d.crawl += n;
  }
  return [...out.entries()].map(([day, v]) => ({ day, ...v }));
}

/**
 * Days left at the recent pace: requests left divided by the crawl's average requests a day over the last 3 days
 * that had any (the first days of a crawl run hotter than later ones, so recent days count most), else the daily
 * budget. Null when nothing is left.
 */
export function etaDays(left: number, perDay: { crawl: number }[], budgetPerDay: number): number | null {
  if (left <= 0) return null;
  const recent = perDay.filter((d) => d.crawl > 0).slice(-3);
  const pace = recent.length ? recent.reduce((n, d) => n + d.crawl, 0) / recent.length : budgetPerDay;
  if (!pace || pace <= 0) return null;
  return Math.round((left / pace) * 10) / 10;
}
