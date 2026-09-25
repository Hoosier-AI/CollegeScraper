import { describe, it, expect } from 'vitest';
import { firstLast, goalMinute, h2hSummary, toMatchRow } from '../../src/ui/queries.js';

// A = current home team, B = visitors. Meetings newest first.
const meet = (id: string, date: string, home: 'A' | 'B', hs: number, as: number, neutral = false) =>
  toMatchRow({ id, season: Number(date.slice(0, 4)), game_date: date, gender: 'm', division: 'd1', status: 'final', start_epoch: null,
    home_program_id: home, away_program_id: home === 'A' ? 'B' : 'A', home_name: home, away_name: home === 'A' ? 'B' : 'A', home_score: hs, away_score: as, neutral_site: neutral });

describe('h2hSummary', () => {
  const s = h2hSummary([
    meet('m4', '2026-09-01', 'B', 0, 2),        // A won away 2-0
    meet('m3', '2025-10-10', 'A', 1, 1),        // tie at home
    meet('m2', '2025-08-30', 'A', 3, 0),        // A won at home 3-0
    meet('m1', '2024-11-07', 'B', 4, 1, true),  // B won 4-1 at a neutral ground
  ], 'A');
  it('counts results and goals from the current home team\'s side', () => {
    expect(s).toMatchObject({ played: 4, home_wins: 2, away_wins: 1, ties: 1, home_goals: 7, away_goals: 5, avg_goals: 3, home_clean_sheets: 2, away_clean_sheets: 0 });
    expect(s.games.map((g) => g.result)).toEqual(['W', 'T', 'W', 'L']);
  });
  it('splits the record by where the current hosts played', () => {
    expect(s.at_home).toEqual({ w: 1, l: 0, t: 1 });
    expect(s.at_away).toEqual({ w: 1, l: 0, t: 0 });
    expect(s.at_neutral).toEqual({ w: 0, l: 1, t: 0 });
  });
  it('finds each side\'s biggest win, the first season and the current run', () => {
    expect(s.biggest_home_win).toMatchObject({ id: 'm2', score: '3–0', margin: 3 });
    expect(s.biggest_away_win).toMatchObject({ id: 'm1', score: '4–1', margin: 3 });
    expect(s.first_season).toBe(2024);
    expect(s.last_meeting).toEqual({ id: 'm4', game_date: '2026-09-01' });
    expect(s.streak).toEqual({ side: 'home', kind: 'unbeaten', count: 3 });
  });
  it('reads a run of wins and a run of ties', () => {
    expect(h2hSummary([meet('a', '2026-09-01', 'A', 1, 0), meet('b', '2025-09-01', 'B', 0, 2)], 'A').streak).toEqual({ side: 'home', kind: 'won', count: 2 });
    expect(h2hSummary([meet('a', '2026-09-01', 'A', 1, 1), meet('b', '2025-09-01', 'B', 1, 1)], 'A').streak).toEqual({ side: null, kind: 'drawn', count: 2 });
    expect(h2hSummary([], 'A')).toMatchObject({ played: 0, streak: null, first_season: null, avg_goals: null });
  });
  it('turns a counting-up clock into a minute', () => {
    expect(goalMinute('56:12', 2)).toBe('57′'); expect(goalMinute('45:00', 1)).toBe('45′'); expect(goalMinute(null, 3)).toBe('OT'); expect(goalMinute(null, 1)).toBeNull();
  });
  it('turns "Last, First" into "First Last"', () => {
    expect(firstLast('Carroll, Campbell')).toBe('Campbell Carroll'); expect(firstLast('Jasmine Aikey')).toBe('Jasmine Aikey'); expect(firstLast('  ')).toBeNull();
  });
});
