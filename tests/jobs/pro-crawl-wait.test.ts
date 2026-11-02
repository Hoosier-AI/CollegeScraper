import { describe, it, expect } from 'vitest';
import { handlerFor, Pace, taskPatch, type TaskCtx, type TaskRow } from '../../src/jobs/pro/tasks.js';

const task = (over: Partial<TaskRow> = {}): TaskRow => ({ kind: 'detail', key: '519|2026', priority: 22, every_days: null, page: 0, pages: null, attempts: 0, calls: 5, ...over });
const AT = Date.parse('2026-11-02T20:00:00Z');

describe('what a crawl turn writes back', () => {
  it('a finished task is due again after its interval', () => {
    const p = taskPatch(task({ every_days: 7 }), { done: true }, 3, AT);
    expect(p).toMatchObject({ calls: 8, page: 0, attempts: 0, last_error: null, due_at: '2026-11-09T20:00:00.000Z' });
  });
  it('a task with nothing to do yet waits instead of staying due', () => {
    expect(taskPatch(task(), { done: false, waitHours: 6 }, 0, AT)).toMatchObject({ page: 0, due_at: '2026-11-03T02:00:00.000Z' });
  });
  it('a task stopped part way stays due, to resume from its page', () => {
    const p = taskPatch(task({ kind: 'league_players', page: 2 }), { done: false, page: 4, pages: 9 }, 2, AT);
    expect(p).toEqual({ calls: 7, pages: 9, page: 4 });
  });
});

describe('match detail for a season with no results stored', () => {
  it('asks to come back later and spends no requests', async () => {
    const tables: string[] = [];
    // Every read answers nothing: no coverage row, no pending matches, no finals.
    const from = (table: string) => {
      tables.push(table);
      const q: any = new Proxy({}, { get: (_t, prop: string) => (prop === 'then' ? (res: (v: unknown) => void) => res({ data: table === 'pro_seasons' ? null : [], count: 0, error: null }) : () => q) });
      return q;
    };
    const ctx = { db: { from }, inc: () => {}, note: () => {}, heartbeat: async () => {}, cancelled: async () => false, params: {} } as any;
    const api = new Proxy({}, { get: () => { throw new Error('no request expected'); } }) as any;
    const t: TaskCtx = { ctx, api, task: task(), leagues: new Map(), pace: new Pace(), deadline: Date.now() + 60_000, callsLeft: () => 1000 };
    expect(await handlerFor('detail')!(t)).toEqual({ done: false, waitHours: 6 });
    expect(tables).toEqual(['pro_seasons', 'pro_fixtures', 'pro_fixtures']);
  });
});
