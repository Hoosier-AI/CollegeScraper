import { describe, it, expect } from 'vitest';
import { byKind, byTier, callsLeft, callsPerDay, etaDays, type ProgressRow } from '../../src/ops/proProgress.js';

const row = (o: Partial<ProgressRow>): ProgressRow => ({ kind: 'squad', tier: 1, tasks: 0, done: 0, due: 0, errors: 0, calls: 0, done_calls: 0, pages_left: 0, never_done: 0, ...o });

describe('pro crawl progress', () => {
  it('requests left: due tasks times what a finished one cost, defaults before any finished, pages left when known', () => {
    expect(callsLeft([row({ kind: 'squad', done: 10, done_calls: 10, due: 50 })])).toBe(50);
    expect(callsLeft([row({ kind: 'league_players', due: 4 })])).toBe(100);
    expect(callsLeft([row({ kind: 'league_players', done: 2, done_calls: 40, due: 3, pages_left: 70 })])).toBe(70);
    expect(callsLeft([row({ kind: 'profiles_page', due: 1848 })])).toBe(1848);
  });
  it('groups by kind and by tier with a percentage', () => {
    const rows = [row({ kind: 'squad', tier: 1, tasks: 100, done: 25, due: 75 }), row({ kind: 'squad', tier: 2, tasks: 300, done: 0, due: 300 }), row({ kind: 'profiles_page', tier: 0, tasks: 2743, done: 895, due: 1848 })];
    const k = byKind(rows);
    expect(k.find((x) => x.kind === 'squad')).toMatchObject({ tasks: 400, done: 25, due: 375, pct: 6.3 });
    const t = byTier(rows);
    expect(t.map((x) => x.tier)).toEqual([0, 1, 2]);
    expect(t[0]).toMatchObject({ tasks: 2743, done: 895, pct: 32.6 });
  });
  it('requests per day from finished runs, crawl counted apart, empty days kept', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');
    const d = callsPerDay([
      { job: 'pro-crawl', finished_at: '2026-10-09T01:35:00Z', counters: { api_calls: 1084 } },
      { job: 'pro-scoreboard', finished_at: '2026-10-09T02:00:00Z', counters: { api_calls: 3 } },
      { job: 'pro-crawl', finished_at: '2026-10-07T10:00:00Z', counters: { api_calls: 500 } },
      { job: 'pro-live', finished_at: null, counters: { api_calls: 9 } },
    ], 3, now);
    expect(d).toEqual([{ day: '2026-10-07', calls: 500, crawl: 500 }, { day: '2026-10-08', calls: 0, crawl: 0 }, { day: '2026-10-09', calls: 1087, crawl: 1084 }]);
  });
  it('days left at the recent pace, else the budget; nothing left is null', () => {
    expect(etaDays(10_000, [{ crawl: 0 }, { crawl: 4000 }, { crawl: 6000 }], 4000)).toBe(2);
    expect(etaDays(10_000, [], 5000)).toBe(2);
    expect(etaDays(0, [{ crawl: 100 }], 4000)).toBeNull();
  });
});
