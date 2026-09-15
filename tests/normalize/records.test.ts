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
  it('ok / lag / mismatch', () => {
    expect(compareRecord(harvard, { w: 1, l: 2, t: 1 }, false).status).toBe('ok');
    expect(compareRecord(harvard, { w: 1, l: 1, t: 0 }, false).status).toBe('lag');
    expect(compareRecord(harvard, { w: 2, l: 1, t: 0 }, false).status).toBe('mismatch');
    expect(compareRecord(harvard, { w: 0, l: 0, t: 0 }, true).status).toBe('ok');
  });
});
