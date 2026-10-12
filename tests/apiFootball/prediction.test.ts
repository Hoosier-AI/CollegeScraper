import { describe, expect, it } from 'vitest';
import { parsePrediction } from '../../src/sources/apiFootball/parse.js';

describe('match predictions', () => {
  it('reads the chances and the comparison as whole percentages', () => {
    const row = parsePrediction(1550137, {
      predictions: { percent: { home: '45%', draw: '45%', away: '10%' } },
      comparison: { form: { home: '60%', away: '40%' }, att: { home: '71%', away: '29%' }, total: { home: '58.5%', away: '41.5%' }, unknown: { home: '1%', away: '2%' } },
    }, '2026-10-12T00:00:00Z');
    expect(row).toMatchObject({ fixture_id: 1550137, home_pct: 45, draw_pct: 45, away_pct: 10 });
    expect(row!.comparison).toEqual({ form: [60, 40], att: [71, 29], total: [59, 42] });
  });
  it('skips an answer with nothing in it', () => {
    expect(parsePrediction(1, {}, '2026-10-12T00:00:00Z')).toBeNull();
    expect(parsePrediction(1, undefined, '2026-10-12T00:00:00Z')).toBeNull();
  });
});
