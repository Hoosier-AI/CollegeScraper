// The in-process cache must stay bounded: its keys come from request data (a search term, any query string).
// The cap used to be checked only after a load, when the placeholder for that key was already in the map, so the
// check never passed and nothing was ever evicted.
import { describe, it, expect } from 'vitest';
import { memo, memoSize, forgetMemo } from '../../src/pro/memo.js';

describe('memo cache', () => {
  it('holds at most its cap however many distinct keys are asked for', async () => {
    forgetMemo('cap:');
    for (let i = 0; i < 4000; i++) await memo(`cap:${i}`, async () => i);
    expect(memoSize()).toBeLessThanOrEqual(1500);
    // The newest answers are the ones kept; the oldest were evicted and load again.
    let loads = 0;
    expect(await memo('cap:3999', async () => { loads++; return -1; })).toBe(3999);
    expect(await memo('cap:0', async () => { loads++; return -2; })).toBe(-2);
    expect(loads).toBe(1);
    forgetMemo('cap:');
  });

  it('still shares one load between callers asking at the same time', async () => {
    let loads = 0;
    const load = async () => { loads++; await new Promise((r) => setTimeout(r, 5)); return 'x'; };
    const [a, b] = await Promise.all([memo('share:1', load), memo('share:1', load)]);
    expect([a, b]).toEqual(['x', 'x']);
    expect(loads).toBe(1);
    forgetMemo('share:');
  });
});
