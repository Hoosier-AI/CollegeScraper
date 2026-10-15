import { describe, expect, it } from 'vitest';
import { confTables, magicNumbers, seeded, simulate, type PlayedGame, type SimGame, type SimTeam } from '../src/college/sim.js';

const DRAW = [0.27, 0.26, 0.24, 0.22, 0.2, 0.17, 0.14, 0.11, 0.08, 0.05];
const teams: SimTeam[] = [
  { id: 'A', rating: 1800, conf: 'X' }, { id: 'B', rating: 1600, conf: 'X' }, { id: 'C', rating: 1500, conf: 'X' }, { id: 'D', rating: 1400, conf: 'X' },
  { id: 'E', rating: 1700, conf: 'Y' }, { id: 'F', rating: 1500, conf: 'Y' }, { id: 'G', rating: 1450, conf: 'Y' }, { id: 'H', rating: 1300, conf: 'Y' },
];
const g = (home: string, away: string, hs: number, as: number, conf = true): PlayedGame => ({ home, away, hs, as, neutral: false, conf });
const played: PlayedGame[] = [g('A', 'B', 2, 0), g('C', 'D', 1, 1), g('E', 'F', 1, 0), g('G', 'H', 0, 1), g('A', 'E', 1, 1, false), g('B', 'F', 2, 1, false), g('C', 'G', 0, 2, false), g('D', 'H', 3, 0, false)];
const remaining: SimGame[] = [{ home: 'A', away: 'C', neutral: false, conf: true }, { home: 'B', away: 'D', neutral: false, conf: true }, { home: 'E', away: 'G', neutral: false, conf: true }, { home: 'F', away: 'H', neutral: false, conf: true }];

describe('season simulation', () => {
  it('is repeatable with a seed and sums sensibly', () => {
    const run = () => simulate({ teams, played, remaining, autoConfs: new Set(['X', 'Y']), field: 4, seeds: 2, sims: 2000, draw: DRAW, homeEdge: 60, rng: seeded(7) });
    const a = run(), b = run();
    expect(a).toEqual(b);
    const sum = (k: 'reg_title' | 'auto_bid' | 'bid' | 'seed') => a.reduce((s, r) => s + (r[k] ?? 0), 0);
    expect(sum('reg_title')).toBeCloseTo(2, 1);
    expect(sum('auto_bid')).toBeCloseTo(2, 1);
    expect(sum('bid')).toBeCloseTo(4, 1);
    expect(sum('seed')).toBeCloseTo(2, 1);
    const A = a.find((r) => r.team === 'A')!, D = a.find((r) => r.team === 'D')!;
    expect(A.reg_title).toBeGreaterThan(D.reg_title);
    expect(A.bid!).toBeGreaterThan(D.bid!);
  });
  it('conference odds only when there is no field', () => {
    const r = simulate({ teams, played, remaining, autoConfs: new Set(), field: null, seeds: 0, sims: 200, draw: DRAW, homeEdge: 60, rng: seeded(1) });
    expect(r.every((x) => x.bid === null && x.auto_bid === 0)).toBe(true);
  });
});

describe('magic numbers', () => {
  it('clinched, eliminated and the leader’s magic number', () => {
    const { row, left } = confTables(teams, played, remaining);
    const m = magicNumbers(teams, row, left);
    // X: A 3 pts (1 left), B 0 (1 left), C 1 (1 left), D 1 (1 left): B, C, D can reach 3 or 4.
    expect(m.get('A')).toMatchObject({ points_now: 3, max_points: 6, left: 1, clinched: false, magic: 1 });
    expect(m.get('B')).toMatchObject({ points_now: 0, max_points: 3, eliminated: false });
    const done = confTables(teams, [...played, g('A', 'C', 1, 0), g('B', 'D', 0, 0)], []);
    const m2 = magicNumbers(teams, done.row, done.left);
    expect(m2.get('A')!.clinched).toBe(true);
    expect(m2.get('B')!.eliminated).toBe(true);
  });
});
