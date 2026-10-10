import { describe, it, expect } from 'vitest';
import { ApiFootball, ApiFootballError, QuotaExhausted, errorText } from '../../src/sources/apiFootball/client.js';

type Answer = { status?: number; body?: unknown; remaining?: number; limit?: number };

/** A fetch that answers from a script and records the URLs it was asked for. */
function fakeFetch(answers: Answer[], status = { current: 100, limit_day: 7500 }) {
  const calls: string[] = [];
  let i = 0;
  const impl = (async (url: string) => {
    calls.push(String(url));
    if (String(url).endsWith('/status')) return new Response(JSON.stringify({ response: { requests: status } }), { status: 200 });
    const a = answers[Math.min(i++, answers.length - 1)]!;
    const headers: Record<string, string> = {};
    if (a.remaining != null) headers['x-ratelimit-requests-remaining'] = String(a.remaining);
    if (a.limit != null) headers['x-ratelimit-requests-limit'] = String(a.limit);
    return new Response(JSON.stringify(a.body ?? { response: [], results: 0, paging: { current: 1, total: 1 }, errors: [] }), { status: a.status ?? 200, headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = (remaining: number): Answer => ({ remaining, limit: 7500, body: { response: [{ x: 1 }], results: 1, paging: { current: 1, total: 1 }, errors: [] } });
const noSleep = async () => {};

describe('ApiFootball client', () => {
  it('sends the key, builds the query string and returns the envelope', async () => {
    const f = fakeFetch([ok(7000)]);
    const api = new ApiFootball({ key: 'k'.repeat(32), fetchImpl: f.impl, sleep: noSleep });
    const res = await api.get('fixtures', { date: '2026-10-04', league: undefined });
    expect(res.response).toEqual([{ x: 1 }]);
    expect(f.calls).toContain('https://v3.football.api-sports.io/fixtures?date=2026-10-04');
    expect(api.quota.remaining).toBe(7000);
    expect(api.quota.usedToday).toBe(1);
  });

  it('reads /status (free) first when the day\'s usage is unknown', async () => {
    const f = fakeFetch([ok(7300)], { current: 200, limit_day: 7500 });
    const api = new ApiFootball({ key: 'k'.repeat(32), fetchImpl: f.impl, sleep: noSleep });
    await api.get('leagues');
    expect(f.calls[0]).toMatch(/\/status$/);
    expect(api.quota.limit).toBe(7500);
  });

  it('never spends below the everyday floor, and the backfill stops earlier', async () => {
    const f = fakeFetch([ok(2000)], { current: 5400, limit_day: 7500 });
    const api = new ApiFootball({ key: 'k'.repeat(32), fetchImpl: f.impl, sleep: noSleep, reserve: 1500, backfillReserve: 2500 });
    await expect(api.get('fixtures', { ids: '1' }, 'backfill')).rejects.toBeInstanceOf(QuotaExhausted);
    expect(api.headroom('backfill')).toBe(0);
    expect(api.headroom('everyday')).toBe(600);
    await api.get('fixtures', { date: '2026-10-04' }, 'everyday');
    const g = fakeFetch([ok(1500)], { current: 6000, limit_day: 7500 });
    const low = new ApiFootball({ key: 'k'.repeat(32), fetchImpl: g.impl, sleep: noSleep, reserve: 1500 });
    await expect(low.get('fixtures', { date: '2026-10-04' })).rejects.toBeInstanceOf(QuotaExhausted);
    expect(g.calls.filter((c) => !c.endsWith('/status'))).toHaveLength(0);
  });

  it('follows the provider\'s count down, which includes what the Plaibook app spent', async () => {
    const f = fakeFetch([ok(5000), ok(4100)], { current: 2000, limit_day: 7500 });
    const api = new ApiFootball({ key: 'k'.repeat(32), fetchImpl: f.impl, sleep: noSleep });
    await api.get('a');
    expect(api.quota.remaining).toBe(5000);
    await api.get('b');
    expect(api.quota.remaining).toBe(4100);
  });

  it('a spent day or a bad key blocks further calls', async () => {
    const f = fakeFetch([{ remaining: 0, body: { response: [], errors: { requests: 'You have reached the request limit for the day' } } }]);
    const api = new ApiFootball({ key: 'k'.repeat(32), fetchImpl: f.impl, sleep: noSleep });
    await expect(api.get('fixtures', { date: '2026-10-04' })).rejects.toBeInstanceOf(ApiFootballError);
    expect(api.quota.blockedUntil).not.toBeNull();
    await expect(api.get('fixtures', { date: '2026-10-05' })).rejects.toBeInstanceOf(QuotaExhausted);
  });

  it('retries 429 and 5xx, then succeeds', async () => {
    const f = fakeFetch([{ status: 503 }, { status: 429 }, ok(7000)]);
    const api = new ApiFootball({ key: 'k'.repeat(32), fetchImpl: f.impl, sleep: noSleep });
    const res = await api.get('fixtures', { live: 'all' });
    expect(res.results).toBe(1);
  });

  it('a stale count at the floor heals from /status instead of blocking all day', async () => {
    let now = Date.parse('2026-10-10T00:00:20Z');
    let status = { current: 6000, limit_day: 7500 }; // the provider has not reset its day yet
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith('/status')) return new Response(JSON.stringify({ response: { requests: status } }), { status: 200 });
      return new Response(JSON.stringify({ response: [], results: 0, paging: { current: 1, total: 1 }, errors: [] }), { status: 200, headers: { 'x-ratelimit-requests-remaining': '7400' } });
    }) as unknown as typeof fetch;
    const api = new ApiFootball({ key: 'k'.repeat(32), fetchImpl: impl, sleep: noSleep, now: () => now, reserve: 1500, backfillReserve: 2500 });
    await expect(api.get('fixtures', { ids: '1' })).rejects.toBeInstanceOf(QuotaExhausted);
    status = { current: 12, limit_day: 7500 };
    now += 5 * 60_000; // inside the 10-minute throttle: still the old number, no extra /status call
    await expect(api.get('fixtures', { ids: '1' })).rejects.toBeInstanceOf(QuotaExhausted);
    expect(calls.filter((c) => c.endsWith('/status'))).toHaveLength(1);
    now += 6 * 60_000;
    await api.refreshIfLow();
    expect(api.headroom('backfill')).toBe(7488 - 2500);
    await api.get('fixtures', { ids: '1' }, 'backfill');
    expect(calls.filter((c) => !c.endsWith('/status'))).toHaveLength(1);
  });

  it('a new UTC day forgets yesterday\'s count', async () => {
    let now = Date.parse('2026-10-08T23:59:00Z');
    const f = fakeFetch([ok(1600)], { current: 5900, limit_day: 7500 });
    const api = new ApiFootball({ key: 'k'.repeat(32), fetchImpl: f.impl, sleep: noSleep, now: () => now, reserve: 1500 });
    await api.get('a');
    expect(api.headroom()).toBe(99); // 1,600 at /status, minus the call just made
    now = Date.parse('2026-10-09T00:01:00Z');
    expect(api.headroom()).toBe(Number.POSITIVE_INFINITY);
  });

  it('an answer that is one object (teams/statistics) comes back as a list of one', async () => {
    const f = fakeFetch([{ remaining: 7000, body: { response: { team: { id: 1 } }, results: 11, errors: [] } }]);
    const api = new ApiFootball({ key: 'k'.repeat(32), fetchImpl: f.impl, sleep: noSleep });
    expect((await api.get('teams/statistics', { league: 253, season: 2025, team: 1 })).response).toEqual([{ team: { id: 1 } }]);
  });
  it('an unset option (undefined) keeps its default', async () => {
    const f = fakeFetch([ok(7000)]);
    const api = new ApiFootball({ key: 'k'.repeat(32), base: undefined, reserve: undefined, fetchImpl: f.impl, sleep: noSleep });
    await api.get('leagues');
    expect(f.calls).toContain('https://v3.football.api-sports.io/leagues');
    expect(api.floor('everyday')).toBe(1500);
  });

  it('reads the provider\'s errors field in both shapes', () => {
    expect(errorText([])).toBeNull();
    expect(errorText({})).toBeNull();
    expect(errorText({ token: 'bad' })).toBe('token: bad');
    expect(errorText(['x'])).toBe('x');
  });
});
