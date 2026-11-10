import { describe, it, expect } from 'vitest';
import { drawCounter, runElo, runEloSettled, START, type EloMatch } from '../src/sources/intl/elo.js';

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

  // Two tiers that mostly play themselves and meet a few times a year, the top tier winning those meetings.
  const tiers = () => {
    const out: EloMatch[] = [], top = ['T1', 'T2', 'T3', 'T4'], low = ['L1', 'L2', 'L3', 'L4'];
    for (let y = 2023; y <= 2025; y++) for (let w = 0; w < 30; w++) {
      const d = `${y}-0${3 + Math.floor(w / 6)}-${String(1 + (w % 6) * 4).padStart(2, '0')}`;
      for (const g of [top, low]) { const a = g[w % 4]!, b = g[(w + 1 + (w >> 2) % 3) % 4]!; if (a !== b) out.push(m(d, a, b, w % 3 === 0 ? 1 : 2, 1)); }
      if (w % 5 === 0) out.push(m(d, top[w % 4]!, low[(w + 2) % 4]!, 2, 0, 'cup'));
    }
    return { out, region: new Map([...top.map((t) => [t, 'top'] as [string, string]), ...low.map((t) => [t, 'low'] as [string, string])]) };
  };
  it('separates tiers that seldom meet further when the levels settle', () => {
    const { out, region } = tiers();
    const gap = (r: ReturnType<typeof runElo>) => (r.levels.get('top') ?? 0) - (r.levels.get('low') ?? 0);
    const once = runElo(out, { confederations: region, share: 0.2, provisional: 0 }), settled = runEloSettled(out, { confederations: region, share: 0.2, provisional: 0 }, 6);
    expect(gap(settled)).toBeGreaterThan(gap(once) * 1.5);
    // Re-centred: the levels average out at 0 over the sides.
    expect((settled.levels.get('top')! + settled.levels.get('low')!) / 2).toBeCloseTo(0, 0);
  });
  it('moves an outer level (a division) from results between its groups', () => {
    const { out, region } = tiers();
    const r = runElo(out, { outer: region, outerShare: 0.3, provisional: 0 });
    expect(r.outerLevels.get('top')!).toBeGreaterThan(0);
    expect(r.outerLevels.get('low')!).toBeCloseTo(-r.outerLevels.get('top')!, 6);
  });
  it('gains a favourite less for a big win with the margin correction', () => {
    const games = [m('2025-01-01', 'A', 'B', 1, 0), m('2025-01-02', 'A', 'B', 1, 0), m('2025-01-03', 'A', 'B', 1, 0), m('2025-01-04', 'A', 'B', 6, 0)].map((g) => ({ ...g, neutral: true }));
    const plain = runElo(games, { provisional: 0, keepSteps: true }), damped = runElo(games, { provisional: 0, keepSteps: true, mov: true });
    expect(damped.steps[6]!.delta).toBeLessThan(plain.steps[6]!.delta);
    expect(damped.steps[0]!.delta).toBeCloseTo(plain.steps[0]!.delta, 6);
  });
});
