import { describe, expect, it } from 'vitest';
import { forgetSwr, swr } from '../../src/ops/swr.js';

describe('swr', () => {
  it('waits only for the first read, then serves the last answer while a fresh one builds', async () => {
    let n = 0;
    const build = async () => { n += 1; return n; };
    expect(await swr('t:a', 0, build)).toBe(1);
    // Stale (freshMs 0): the old answer comes back at once, the rebuild runs behind it.
    expect(await swr('t:a', 0, build)).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(await swr('t:a', 60_000, build)).toBe(2);
    expect(n).toBe(2);
  });
  it('builds once for readers that arrive together, and forgets on demand', async () => {
    let n = 0;
    const build = () => new Promise<number>((r) => setTimeout(() => r(++n), 5));
    const [a, b] = await Promise.all([swr('t:b', 60_000, build), swr('t:b', 60_000, build)]);
    expect([a, b, n]).toEqual([1, 1, 1]);
    forgetSwr('t:b');
    expect(await swr('t:b', 60_000, build)).toBe(2);
  });
});
