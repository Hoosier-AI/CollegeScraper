import { describe, expect, it } from 'vitest';
import { isEngaged } from '../../ui/src/lib/engaged.js';

const v = (o: Partial<Parameters<typeof isEngaged>[0]>) => isEngaged({ input: true, shownMs: 0, firstInputMs: 500, lastInputMs: 500, pages: 1, ...o });

describe('isEngaged', () => {
  it('does not count the crawler: one page, one pointer move, however long it waits', () => {
    expect(v({ shownMs: 4000 })).toBe(false);
    expect(v({ shownMs: 60000 })).toBe(false);
  });
  it('never counts a visit without real input', () => {
    expect(isEngaged({ input: false, shownMs: 60000, firstInputMs: null, lastInputMs: null, pages: 3 })).toBe(false);
  });
  it('counts a second page three seconds in', () => {
    expect(v({ pages: 2, shownMs: 2000 })).toBe(false);
    expect(v({ pages: 2, shownMs: 3200 })).toBe(true);
  });
  it('counts a reader: fifteen seconds in view with input at two moments five seconds apart', () => {
    expect(v({ shownMs: 16000, lastInputMs: 3000 })).toBe(false);
    expect(v({ shownMs: 12000, lastInputMs: 9000 })).toBe(false);
    expect(v({ shownMs: 16000, lastInputMs: 9000 })).toBe(true);
  });
});
