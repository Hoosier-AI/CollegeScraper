import { describe, expect, it } from 'vitest';
import { playerRuns, teamRuns } from '../src/college/records.js';

describe('runs still going', () => {
  it('counts a team’s current runs from the newest game back', () => {
    const r = teamRuns([
      { home: 'A', away: 'B', hs: 0, as: 1, date: '2026-09-01' },
      { home: 'A', away: 'C', hs: 2, as: 0, date: '2026-09-08' },
      { home: 'D', away: 'A', hs: 1, as: 1, date: '2026-09-15' },
      { home: 'A', away: 'E', hs: 3, as: 0, date: '2026-09-22' },
    ]).get('A')!;
    expect(r).toMatchObject({ unbeaten: 3, winning: 1, clean: 1, scoring: 3, winless: 0, last: '2026-09-22' });
  });
  it('counts a player’s scoring and point runs over the games they played', () => {
    const r = playerRuns([
      { player: 'p', date: '2026-09-01', goals: 0, assists: 0 }, { player: 'p', date: '2026-09-05', goals: 1, assists: 0 },
      { player: 'p', date: '2026-09-09', goals: 0, assists: 2 }, { player: 'p', date: '2026-09-12', goals: 2, assists: 0 },
    ]).get('p')!;
    expect(r).toEqual({ goals: 1, points: 3, last: '2026-09-12' });
  });
});
