import { describe, it, expect } from 'vitest';
import { swapBoxSides } from '../../src/normalize/boxScore.js';
import type { BoxScore } from '../../src/model.js';

const team = (name: string, isHome: boolean, score: number) => ({ name, sourceTeamId: null, ncaaSeo: null, isHome, score, record: null, totals: { goals: score } as any, players: [] });
const box = { source: 'site', sourceUrl: 'x', date: '2026-09-06', startTimeLocal: null, status: 'final', venueName: null, venueCity: null, attendance: null, officials: [], neutral: false, conferenceGame: false, postseason: false, tournament: null, overtime: false, shootout: false, durationMin: null, periods: 2,
  home: team('Marietta', true, 3), away: team('Piedmont', false, 2), events: [{ side: 'home', homeScore: 1, awayScore: 0 } as any, { side: 'away', homeScore: 1, awayScore: 1 } as any], ncaaContestId: null } as unknown as BoxScore;

describe('swapBoxSides', () => {
  it('turns a box round so the visitor listed first lands on the away side', () => {
    const s = swapBoxSides(box);
    expect(s.home.name).toBe('Piedmont'); expect(s.home.isHome).toBe(true); expect(s.home.score).toBe(2);
    expect(s.away.name).toBe('Marietta'); expect(s.away.isHome).toBe(false); expect(s.away.score).toBe(3);
    expect(s.events[0]).toMatchObject({ side: 'away', homeScore: 0, awayScore: 1 });
    expect(s.events[1]).toMatchObject({ side: 'home', homeScore: 1, awayScore: 1 });
    expect(box.home.name).toBe('Marietta'); // input untouched
  });
});
