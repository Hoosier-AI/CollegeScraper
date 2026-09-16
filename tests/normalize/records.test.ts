import { describe, it, expect } from 'vitest';
import { normalizeResult, compareRecord } from '../../src/normalize/records.js';

describe('results and records', () => {
  it('uses the W/L status to pick the team score', () => {
    expect(normalizeResult({ status: 'L', teamScore: 3, opponentScore: 2 })).toEqual({ status: 'L', teamScore: 2, opponentScore: 3 });
    expect(normalizeResult({ status: 'W', teamScore: 1, opponentScore: 4 })).toEqual({ status: 'W', teamScore: 4, opponentScore: 1 });
    expect(normalizeResult({ status: 'W', teamScore: 1, opponentScore: 1 })).toEqual({ status: 'W', teamScore: 1, opponentScore: 1 });
    expect(normalizeResult(null)).toBeNull();
  });
  const harvard = [
    { date: '2026-08-28', gf: 4, ga: 1, conf: false },
    { date: '2026-08-31', gf: 1, ga: 3, conf: false },
    { date: '2026-09-04', gf: 1, ga: 3, conf: false },
    { date: '2026-09-12', gf: 2, ga: 2, conf: false },
  ];
  it('counts a source as behind when it lists fewer games, wherever the missing one falls', () => {
    // UMBC: the conference table is missing their 2026-09-11 loss, not their newest game.
    const umbc = [
      { date: '2026-08-20', gf: 1, ga: 2, conf: false },
      { date: '2026-08-23', gf: 3, ga: 2, conf: false },
      { date: '2026-08-28', gf: 5, ga: 1, conf: false },
      { date: '2026-08-31', gf: 0, ga: 3, conf: false },
      { date: '2026-09-05', gf: 0, ga: 0, conf: false },
      { date: '2026-09-11', gf: 1, ga: 5, conf: false },
      { date: '2026-09-15', gf: 2, ga: 0, conf: false },
    ];
    expect(compareRecord(umbc, { w: 3, l: 2, t: 1 }, false).status).toBe('lag');
    // A source listing a win we do not have is a real mismatch.
    expect(compareRecord(umbc, { w: 4, l: 3, t: 1 }, false).status).toBe('mismatch');
  });
  it('ok / lag / mismatch', () => {
    expect(compareRecord(harvard, { w: 1, l: 2, t: 1 }, false).status).toBe('ok');
    expect(compareRecord(harvard, { w: 1, l: 1, t: 0 }, false).status).toBe('lag');
    expect(compareRecord(harvard, { w: 2, l: 1, t: 0 }, false).status).toBe('mismatch');
    expect(compareRecord(harvard, { w: 1, l: 1, t: 1 }, false).status).toBe('lag');
    expect(compareRecord(harvard, { w: 0, l: 0, t: 0 }, true).status).toBe('ok');
  });
});
