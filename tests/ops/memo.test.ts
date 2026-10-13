import { describe, it, expect, vi, afterEach } from 'vitest';
import { memo } from '../../src/pro/memo.js';

afterEach(() => { vi.useRealTimers(); });

describe('memo', () => {
  it('shares one load between callers and serves the cached answer while fresh', async () => {
    const load = vi.fn(async () => 1);
    const [a, b] = await Promise.all([memo('t1', load), memo('t1', load)]);
    expect([a, b]).toEqual([1, 1]);
    expect(await memo('t1', load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves a stale answer at once and refreshes it in the background', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let n = 0;
    const load = vi.fn(async () => ++n);
    expect(await memo('t2', load, { fresh: 1000, stale: 10_000 })).toBe(1);
    vi.setSystemTime(Date.now() + 2000);
    expect(await memo('t2', load, { fresh: 1000, stale: 10_000 })).toBe(1);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(await memo('t2', load, { fresh: 1000, stale: 10_000 })).toBe(2);
  });

  it('never caches a failure, and a failed background refresh keeps the old answer and retries later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await expect(memo('t3', async () => { throw new Error('down'); })).rejects.toThrow('down');
    expect(await memo('t3', async () => 'up')).toBe('up');
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const failing = vi.fn(async (): Promise<string> => { throw new Error('down'); });
    expect(await memo('t3', failing)).toBe('up');
    await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    await new Promise((r) => setImmediate(r));
    expect(await memo('t3', async () => 'again')).toBe('up');
    await new Promise((r) => setImmediate(r));
    expect(await memo('t3', async () => 'x')).toBe('again');
  });
});
