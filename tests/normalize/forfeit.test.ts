import { describe, it, expect } from 'vitest';
import { compareRecord } from '../../src/normalize/records.js';

describe('forfeits in record comparison', () => {
  const games = [
    { date: '2026-09-02', gf: 9, ga: 3, conf: false },
    { date: '2026-09-09', gf: 1, ga: 0, conf: true, forfeit: true },
    { date: '2026-09-16', gf: 5, ga: 0, conf: true },
  ];
  it('count in the conference table', () => { expect(compareRecord(games, { w: 2, l: 0, t: 0 }, true).status).toBe('ok'); });
  it('do not count in the overall record', () => { expect(compareRecord(games, { w: 2, l: 0, t: 0 }, false).status).toBe('ok'); expect(compareRecord(games, { w: 3, l: 0, t: 0 }, false).status).toBe('mismatch'); });
});
