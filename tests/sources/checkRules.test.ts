import { describe, expect, it } from 'vitest';
import { carried, recordAfter, REFERENCE_CARRIES } from '../../src/jobs/sources/checks.js';

const g = (h: number, a: number, hg: number | null, ag: number | null) => ({ home_team_id: h, away_team_id: a, home_goals: hg, away_goals: ag });

describe('recordAfter', () => {
  const games = [g(1, 2, 2, 0), g(3, 1, 1, 1), g(1, 4, 0, 1), g(1, 5, 3, 0) /* a playoff the provider calls regular season */];
  it('a club\'s record after as many games as the table counts', () => {
    expect(recordAfter(games, 1, 3)).toEqual({ played: 3, points: 4 });
    expect(recordAfter(games, 1, null)).toEqual({ played: 4, points: 7 });
  });
  it('fewer games than asked for is reported as it is, and unplayed games are passed over', () => {
    expect(recordAfter([g(1, 2, null, null), g(2, 1, 0, 1)], 1, 5)).toEqual({ played: 1, points: 3 });
    expect(recordAfter(games, 9, 3)).toEqual({ played: 0, points: 0 });
  });
});

describe('carried', () => {
  it('the share of the source\'s total the reference has, over the players both have', () => {
    expect(carried([{ ours: 2816, api: 1280 }, { ours: 939, api: 340 }, { ours: 500, api: null }])).toBeLessThan(REFERENCE_CARRIES.minutes);
    expect(carried([{ ours: 2000, api: 1900 }, { ours: 900, api: 880 }])).toBeGreaterThan(REFERENCE_CARRIES.minutes);
    expect(carried([])).toBe(1);
  });
});
