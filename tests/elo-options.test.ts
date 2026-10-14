import { describe, it, expect } from 'vitest';
import { drawCounter, runElo, START, type EloMatch } from '../src/sources/intl/elo.js';

const m = (date: string, home: string, away: string, hs: number, as: number, tournament = 'season'): EloMatch => ({ date, home, away, home_score: hs, away_score: as, tournament, neutral: false });
const season = [m('2025-09-01', 'A', 'B', 2, 0), m('2025-09-08', 'B', 'A', 0, 1), m('2025-09-15', 'A', 'C', 3, 1), m('2025-09-22', 'C', 'B', 1, 1)];

describe('Elo options for college and pro clubs', () => {
  it('keeps the same ratings with or without the step log', () => {
    const a = runElo(season, { provisional: 0 }), b = runElo(season, { provisional: 0, keepSteps: false });
    expect(b.steps).toHaveLength(0);
    expect([...b.ratings]).toEqual([...a.ratings]);
  });
  it('weighs matches with k and moves nothing at k 0', () => {
    const r = runElo(season, { provisional: 0, k: () => 0 });
    for (const v of r.ratings.values()) expect(v).toBe(START);
  });
  it('snapshots the ratings at the end of a date', () => {
    const r = runElo(season, { provisional: 0, snapshotAt: '2025-09-08' });
    const upTo = runElo(season.filter((x) => x.date <= '2025-09-08'), { provisional: 0 });
    expect(r.snapshot!.get('A')).toBeCloseTo(upTo.ratings.get('A')!, 6);
    expect(r.snapshot!.has('C')).toBe(false);
  });
  it('pulls a side back toward the start after an off-season', () => {
    const next = [...season, m('2026-08-30', 'A', 'B', 1, 1)];
    const none = runElo(next, { provisional: 0 }), back = runElo(next, { provisional: 0, regressAfterDays: 120, regress: 1 / 3 });
    expect(Math.abs(back.ratings.get('A')! - START)).toBeLessThan(Math.abs(none.ratings.get('A')! - START));
  });
  it('counts draws by how even the match was expected to be', () => {
    const d = drawCounter();
    const r = runElo(season, { provisional: 0, onMatch: (_x, we, w) => d.add(we, w) });
    expect(r.played.get('B')!.n).toBe(3);
    expect(d.model()).toHaveLength(10);
  });
});
