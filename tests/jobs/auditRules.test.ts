// The audit has to measure the right thing: a wrong check reads as bad data (2026-11-24: brackets "35% right" were
// 100% right, assists "65%" were 82%).
import { describe, expect, it } from 'vitest';
import { bracketTree, hasValue, type BracketGame } from '../../src/jobs/statAudit.js';

const game = (division: string, slot: number, home: string | null, away: string | null, hs: number | null = null, as: number | null = null, extra: Partial<BracketGame> = {}): BracketGame =>
  ({ division, game_date: '2026-11-20', status: hs == null ? 'scheduled' : 'final', bracket_slot: slot, home_program_id: home, away_program_id: away, home_score: hs, away_score: as, shootout_winner: null, ...extra });

describe('bracketTree', () => {
  it('reads each division as its own tree (they number their slots alike)', () => {
    const rows = [
      game('d1', 101, 'a', 'b', 2, 0), game('d1', 102, 'c', 'd', 0, 1), game('d1', 201, 'a', 'd'),
      game('d2', 101, 'p', 'q', 3, 1), game('d2', 102, 'r', 's', 1, 0), game('d2', 201, 'p', 'r'),
    ];
    expect(bracketTree(rows, "Men's")).toEqual({ compared: 4, bad: [] });
  });
  it('flags a winner who is not in the slot the game feeds', () => {
    const r = bracketTree([game('d1', 101, 'a', 'b', 2, 0), game('d1', 102, 'c', 'd', 0, 1), game('d1', 201, 'b', 'd')], "Women's");
    expect(r.compared).toBe(2);
    expect(r.bad).toHaveLength(1);
    expect(r.bad[0]!.who).toBe("Women's D1 slot 101 (2026-11-20)");
  });
  it('takes the shootout winner of a level game and skips games whose next slot is not set yet', () => {
    const rows = [game('d3', 101, 'a', 'b', 1, 1, { shootout_winner: 'b' }), game('d3', 102, 'c', 'd', 2, 1), game('d3', 201, 'b', 'c'), game('d3', 103, 'e', 'f', 1, 0), game('d3', 202, null, null)];
    expect(bracketTree(rows, "Men's")).toEqual({ compared: 2, bad: [] });
  });
});

describe('hasValue', () => {
  it('a leaderboard row NCAA.com printed without a value is not a zero', () => {
    expect(hasValue({ value: null })).toBe(false);
    expect(hasValue({ value: '' })).toBe(false);
    expect(hasValue({ value: 0 })).toBe(true);
    expect(hasValue({ value: '0.35' })).toBe(true);
  });
});
