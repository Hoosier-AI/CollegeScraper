import { describe, expect, it } from 'vitest';
import { fitRates, momentum, outcome, winProbCurve, xgRace } from '../src/match/flow.js';

describe('win probability', () => {
  it('starts where the pre-match chances do and settles with the score', () => {
    const pre = { h: 0.5, d: 0.25, a: 0.25 };
    const { lh, la } = fitRates(pre, 2.8);
    expect(lh).toBeGreaterThan(la);
    const c = winProbCurve({ lh, la, events: [{ m: 20, side: 'home', type: 'goal' }, { m: 60, side: 'home', type: 'goal' }], until: 90 });
    expect(Math.abs(c[0]!.h - c[0]!.a - (pre.h - pre.a))).toBeLessThan(0.02);
    expect(c[0]!.h + c[0]!.d + c[0]!.a).toBeCloseTo(1, 2);
    expect(c[85]!.h).toBeGreaterThan(0.95);
    expect(c[21]!.h).toBeGreaterThan(c[19]!.h);
    expect(c[90]).toEqual({ m: 90, h: 1, d: 0, a: 0 });
  });
  it('a red card swings the chances to the other side', () => {
    const { lh, la } = fitRates({ h: 0.4, d: 0.3, a: 0.3 }, 2.6);
    const c = winProbCurve({ lh, la, events: [{ m: 10, side: 'home', type: 'red' }], until: 30 });
    expect(c[10]!.a).toBeGreaterThan(c[9]!.a);
  });
  it('a level game late is mostly a draw', () => {
    const o = outcome(0.1, 0.1, 0);
    expect(o.d).toBeGreaterThan(0.8);
  });
});

describe('momentum and xG', () => {
  it('leans to the side attacking and fades after', () => {
    const m = momentum([{ m: 10, side: 'home', w: 1 }, { m: 11, side: 'home', w: 1 }, { m: 12, side: 'home', w: 0.6 }, { m: 40, side: 'away', w: 2 }], 60);
    expect(m[12]!.v).toBeGreaterThan(0.5);
    expect(m[30]!.v).toBeLessThan(m[12]!.v);
    expect(m[40]!.v).toBeLessThan(0);
    expect(m).toHaveLength(61);
  });
  it('adds up xG by minute', () => {
    const r = xgRace([{ m: 5, side: 'home', xg: 0.3 }, { m: 50, side: 'away', xg: 0.7 }, { m: 51, side: 'home', xg: 0.1 }], 90);
    expect(r[4]).toEqual({ m: 4, h: 0, a: 0 });
    expect(r[90]).toEqual({ m: 90, h: 0.4, a: 0.7 });
  });
});
