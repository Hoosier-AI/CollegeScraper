import { describe, it, expect, beforeEach } from 'vitest';
import { splitByPerson } from '../../src/sources/apiFootball/parse.js';
import { ApiFootball } from '../../src/sources/apiFootball/client.js';
import { batchWorks, handlerFor, Pace, type TaskCtx } from '../../src/jobs/pro/tasks.js';

describe('several people in one request', () => {
  it('splits an answer that names each person; a flat list cannot be split', () => {
    const m = splitByPerson([{ player: { id: 1 }, sidelined: [{ type: 'Knee', start: '2025-01-01' }] }, { id: 2, sidelined: [] }], [1, 2, 3], 'sidelined')!;
    expect(m.get(1)).toHaveLength(1);
    expect(m.get(2)).toEqual([]);
    expect(m.get(3)).toEqual([]);
    expect(splitByPerson([{ type: 'Knee', start: '2025-01-01', end: null }], [1, 2], 'sidelined')).toBeNull();
    expect(splitByPerson([{ player: { id: 9 }, sidelined: [] }], [1, 2], 'sidelined')).toBeNull();
  });
});

describe('backfill floor through the UTC day', () => {
  const at = (iso: string) => new ApiFootball({ key: 'k'.repeat(32), reserve: 1500, backfillReserve: 2500, everydayPerHour: 100, backfillMargin: 300, now: () => Date.parse(iso) });
  it('keeps the full floor early, comes down as the day runs out, never under reserve + margin', () => {
    expect(at('2026-10-09T03:00:00Z').floor('backfill')).toBe(2500);
    expect(at('2026-10-09T18:00:00Z').floor('backfill')).toBe(2100);
    expect(at('2026-10-09T23:30:00Z').floor('backfill')).toBe(1800);
    expect(at('2026-10-09T23:30:00Z').floor('everyday')).toBe(1500);
  });
  it('a fixed floor without an hourly need', () => {
    expect(new ApiFootball({ key: 'k'.repeat(32), backfillReserve: 2500, now: () => Date.parse('2026-10-09T23:30:00Z') }).floor('backfill')).toBe(2500);
  });
});

/** A Supabase stand-in for the calls the people handler makes: due tasks of a kind, deletes, upserts, updates. */
function fakeDb(due: { key: string; every_days: number | null }[]) {
  const log: { table: string; op: string; args: unknown[] }[] = [];
  const from = (table: string) => {
    let op = 'select';
    const q: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: (v: unknown) => void) => res(op === 'select' ? { data: due, error: null } : { data: null, error: null });
        return (...args: unknown[]) => { if (['update', 'delete', 'upsert', 'insert'].includes(prop)) op = prop; log.push({ table, op: prop, args }); return q; };
      },
    });
    return q;
  };
  return { db: { from } as any, log };
}

function ctxFor(answers: unknown[], due: { key: string; every_days: number | null }[]) {
  const urls: string[] = [];
  let i = 0;
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    if (String(url).endsWith('/status')) return new Response(JSON.stringify({ response: { requests: { current: 0, limit_day: 7500 } } }));
    const body = answers[Math.min(i++, answers.length - 1)];
    return new Response(JSON.stringify({ response: body, results: 1, errors: [] }), { headers: { 'x-ratelimit-requests-remaining': '7000' } });
  }) as unknown as typeof fetch;
  const { db, log } = fakeDb(due);
  const counters: Record<string, number> = {};
  const ctx = { db, inc: (k: string, n = 1) => { counters[k] = (counters[k] ?? 0) + n; }, note: (k: string, v: string) => { counters[`note:${k}:${v}`] = 1; }, heartbeat: async () => {}, cancelled: async () => false, params: {} } as any;
  const t = (key: string): TaskCtx => ({ ctx, api: new ApiFootball({ key: 'k'.repeat(32), fetchImpl, sleep: async () => {} }), task: { kind: 'sidelined', key, priority: 18, every_days: 60, page: 0, pages: null, attempts: 0, calls: 0 }, leagues: new Map(), pace: new Pace(), deadline: Date.now() + 60_000, callsLeft: () => 1000 });
  return { t, urls, log, counters };
}

describe('injury history, 20 players a request', () => {
  beforeEach(() => { batchWorks.sidelined = null; });
  it('asks for the task and other due players at once and finishes them all', async () => {
    const c = ctxFor([[{ player: { id: 1 }, sidelined: [{ type: 'Knee Injury', start: '2025-01-01', end: '2025-02-01' }] }, { player: { id: 2 }, sidelined: [] }]], [{ key: '2', every_days: 60 }, { key: '3', every_days: 60 }]);
    const res = await handlerFor('sidelined')!(c.t('1'));
    expect(res).toEqual({ done: true, also: ['2', '3'] });
    expect(c.urls.filter((u) => !u.endsWith('/status'))).toEqual(['https://v3.football.api-sports.io/sidelined?players=1-2-3']);
    expect(c.log.some((l) => l.table === 'pro_crawl_tasks' && l.op === 'update')).toBe(true);
    expect(c.counters.sidelined_batched).toBe(3);
    expect(batchWorks.sidelined).toBe(true);
  });
  it('goes back to one player a request when the answer cannot be split', async () => {
    const c = ctxFor([[{ type: 'Knee Injury', start: '2025-01-01', end: null }], [{ type: 'Knee Injury', start: '2025-01-01', end: null }]], [{ key: '2', every_days: 60 }]);
    const res = await handlerFor('sidelined')!(c.t('1'));
    expect(res).toEqual({ done: true });
    expect(c.urls.filter((u) => !u.endsWith('/status'))).toEqual(['https://v3.football.api-sports.io/sidelined?players=1-2', 'https://v3.football.api-sports.io/sidelined?player=1']);
    expect(batchWorks.sidelined).toBe(false);
  });
  it('an empty batch proves nothing; records for one player alone turn batching off', async () => {
    const c = ctxFor([[], [{ type: 'Virus', start: '2024-01-01', end: '2024-01-05' }]], [{ key: '2', every_days: 60 }]);
    await handlerFor('sidelined')!(c.t('1'));
    expect(batchWorks.sidelined).toBe(false);
  });
});
