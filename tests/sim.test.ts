import { describe, expect, it } from 'vitest';
import { confTables, magicNumbers, seeded, simulate, simulateBracket, type PlayedGame, type SimGame, type SimTeam } from '../src/college/sim.js';

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

describe('real tournaments in the simulation', () => {
  const base = { teams, played, remaining, autoConfs: new Set(['X', 'Y']), field: 4, seeds: 2, sims: 1000, draw: DRAW, homeEdge: 60 };
  it('a finished conference tournament gives its champion the automatic bid', () => {
    const r = simulate({ ...base, rng: seeded(3), confTournaments: new Map([['X', { champion: 'D', alive: null }]]) });
    expect(r.find((x) => x.team === 'D')!.auto_bid).toBe(1);
    expect(r.filter((x) => x.conf === 'X' && x.team !== 'D').every((x) => x.auto_bid === 0)).toBe(true);
  });
  it('a tournament under way is played out by the teams still in it', () => {
    const r = simulate({ ...base, rng: seeded(3), confTournaments: new Map([['X', { champion: null, alive: ['B', 'C'] }]]) });
    const B = r.find((x) => x.team === 'B')!, C = r.find((x) => x.team === 'C')!;
    expect(B.auto_bid + C.auto_bid).toBeCloseTo(1, 5);
    expect(r.find((x) => x.team === 'A')!.auto_bid).toBe(0);
    expect(B.auto_bid).toBeGreaterThan(C.auto_bid);
  });
  it('once the NCAA field is out, bids and seeds are facts and each round sums to its games', () => {
    const slots = [
      { slot: 101, home: 'A', away: 'H', homeSeed: 1, awaySeed: null, winner: null, neutral: false },
      { slot: 102, home: 'E', away: 'D', homeSeed: 2, awaySeed: null, winner: 'D', neutral: false },
    ];
    const r = simulate({ ...base, rng: seeded(5), ncaa: { teams: ['A', 'H', 'E', 'D'], topSeeds: ['A', 'E'], slots } });
    expect(r.find((x) => x.team === 'E')!.bid).toBe(1);
    expect(r.find((x) => x.team === 'B')!.bid).toBe(0);
    expect(r.find((x) => x.team === 'A')!.seed).toBe(1);
    expect(r.find((x) => x.team === 'D')!.seed).toBe(0);
    // E lost its played game: never reaches round 2. D always does.
    expect(r.find((x) => x.team === 'E')!.rounds![0]).toBe(0);
    expect(r.find((x) => x.team === 'D')!.rounds![0]).toBe(1);
    const rr = (t: string) => r.find((x) => x.team === t)!.rounds!;
    expect(rr('A')[0] + rr('H')[0]).toBeCloseTo(1, 5);
    expect(rr('A')[0]).toBeGreaterThan(rr('H')[0]);
    expect(r.find((x) => x.team === 'B')!.rounds).toBeNull();
  });
});

describe('bracket simulation', () => {
  it('fills a 64-team bracket from round one and every team reaches each round at most once', () => {
    const ids = Array.from({ length: 64 }, (_, i) => `T${i + 1}`);
    const slots = Array.from({ length: 32 }, (_, i) => ({ slot: 101 + i, home: ids[2 * i]!, away: ids[2 * i + 1]!, homeSeed: null, awaySeed: null, winner: null, neutral: false }));
    const reach = simulateBracket(slots, () => ({ win: 0.45, draw: 0.2 }), 500, seeded(11));
    const sumAt = (i: number) => [...reach.values()].reduce((s, v) => s + v[i]!, 0);
    expect(sumAt(0)).toBeCloseTo(32, 5);
    expect(sumAt(4)).toBeCloseTo(2, 5);
    expect(sumAt(5)).toBeCloseTo(1, 5);
  });
});
