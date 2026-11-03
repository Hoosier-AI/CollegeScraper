import { describe, expect, it } from 'vitest';
import { newLinesFor, oldestFetch, withNewMatches, type FinalRef, type FixtureLine } from '../../src/pro/catchUp.js';

// Kahlina-like: the provider row was fetched on Nov 2 at 01:46; Charlotte played Orlando on Oct 31 (in it) and plays
// Miami on Nov 7 (ends 23:05, after the fetch: not in it yet).
const row = { player_id: 14356, league_id: 253, season: 2026, team_id: 18310, source: 'provider', computed_at: '2026-11-02T01:46:06Z',
  apps: 33, starts: 33, minutes: 2897, goals: 0, assists: 0, yellow: 2, red: 0, saves: 148, conceded: 44, rating: 7.0 };
const finals = new Map<number, FinalRef>([
  [1490587, { id: 1490587, league_id: 253, season: 2026, final_at: '2026-10-31T19:07:27Z' }],
  [1490600, { id: 1490600, league_id: 253, season: 2026, final_at: '2026-11-07T23:05:00Z' }],
  [7001, { id: 7001, league_id: 772, season: 2026, final_at: '2026-11-08T02:00:00Z' }],
]);
const line = (fixture_id: number, extra: Partial<FixtureLine> = {}): FixtureLine => ({ fixture_id, team_id: 18310, player_id: 14356, starter: true, minutes: 94, goals: 0, assists: 0, yellow: 0, red: 0, saves: 5, conceded: 2, rating: 7.6, ...extra });

describe('season totals with the newest matches', () => {
  it('adds a final that ended after the fetch, once', () => {
    const out = withNewMatches(row, [line(1490587), line(1490600)], finals);
    expect(out.apps).toBe(34); expect(out.starts).toBe(34); expect(out.minutes).toBe(2991);
    expect(out.saves).toBe(153); expect(out.conceded).toBe(46); expect(out.latest_added).toBe(1);
    expect(out.rating).toBe(7.02);
  });
  it('leaves the row alone when the provider has caught up, or for another competition, club or player', () => {
    expect(withNewMatches({ ...row, computed_at: '2026-11-08T01:46:00Z' }, [line(1490600)], finals)).toEqual({ ...row, computed_at: '2026-11-08T01:46:00Z' });
    expect(newLinesFor(row, [line(7001)], finals)).toEqual([]);
    expect(newLinesFor(row, [line(1490600, { team_id: 1 })], finals)).toEqual([]);
    expect(newLinesFor(row, [line(1490600, { player_id: 2 })], finals)).toEqual([]);
  });
  it('never touches our own computed rows, an unused sub, or a row without a fetch time', () => {
    expect(newLinesFor({ ...row, source: 'computed' }, [line(1490600)], finals)).toEqual([]);
    expect(newLinesFor(row, [line(1490600, { minutes: 0, starter: false })], finals)).toEqual([]);
    expect(newLinesFor(row, [line(1490600, { minutes: 0, starter: false, from_events: true })], finals)).toHaveLength(1);
    expect(newLinesFor({ ...row, computed_at: null }, [line(1490600)], finals)).toEqual([]);
  });
  it('counts a goal and keeps stats the row never had', () => {
    const out = withNewMatches({ ...row, goals: 12, assists: 8, rating: null }, [line(1490600, { goals: 2, assists: 1, shots: 4, rating: 9.1 })], finals);
    expect(out.goals).toBe(14); expect(out.assists).toBe(9); expect(out.shots).toBe(4); expect(out.rating).toBe(9.1);
  });
  it('the oldest fetch among provider rows', () => {
    expect(oldestFetch([row, { ...row, computed_at: '2026-11-01T00:00:00Z' }, { ...row, source: 'computed', computed_at: '2020-01-01T00:00:00Z' }])).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(oldestFetch([])).toBeNull();
  });
});
