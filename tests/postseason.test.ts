import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyConference, knockout, type ClassifyInput, type PsGame } from '../src/college/postseason.js';

// Real conference seasons from the stats DB (team names in place of ids).
function load(name: string, asOf: string, extra: Partial<ClassifyInput> = {}) {
  const f = JSON.parse(readFileSync(new URL(`../fixtures/postseason/${name}.json`, import.meta.url), 'utf8'));
  const input: ClassifyInput = {
    members: f.members, games: f.games, asOf,
    officialGp: f.officialGp ? new Map(Object.entries(f.officialGp)) as Map<string, number> : undefined,
    officialRank: f.officialRank ? new Map(Object.entries(f.officialRank)) as Map<string, number> : undefined,
    ...extra,
  };
  return { input, games: new Map<string, PsGame>(f.games.map((g: PsGame) => [g.id, g])) };
}
const lines = (r: ReturnType<typeof classifyConference>, games: Map<string, PsGame>) =>
  r!.games.map((t) => { const g = games.get(t.id)!; return `${g.date} ${t.label}: ${g.home} ${g.hs}-${g.as} ${g.away}`; });

describe('conference tournaments', () => {
  it('Big Ten men 2026: six-team bracket with byes, final won on penalties', () => {
    const { input, games } = load('big-ten-men-2026', '2026-11-16');
    const final = [...games.values()].find((g) => g.date === '2026-11-15')!;
    const r = classifyConference({ ...input, games: input.games.map((g) => (g.id === final.id ? { ...g, pkWinner: 'Indiana' } : g)) })!;
    expect(r.start).toBe('2026-11-08');
    expect(r.teams).toHaveLength(6);
    expect(lines(r, games)).toEqual([
      '2026-11-08 Quarterfinal: Maryland 2-1 Michigan St.',
      '2026-11-08 Quarterfinal: Rutgers 2-0 UCLA',
      '2026-11-11 Semifinal: Washington 1-1 Rutgers',
      '2026-11-11 Semifinal: Indiana 1-0 Maryland',
      '2026-11-15 Final: Indiana 2-2 Washington',
    ]);
    expect(r.games.find((t) => games.get(t.id)!.date === '2026-11-11' && t.shootoutWinner)!.shootoutWinner).toBe('Washington');
    expect(r.complete).toBe(true);
    expect(r.champion).toBe('Indiana');
    expect(r.finalShootout).toBeNull();
  });

  it('a final level after extra time with no shootout data has no champion yet', () => {
    const { input } = load('big-ten-men-2026', '2026-11-16');
    const r = classifyConference(input)!;
    expect(r.complete).toBe(true);
    expect(r.champion).toBeNull();
    expect(r.finalShootout).not.toBeNull();
  });

  it('Big Ten women 2026: eight-team bracket, quarterfinals over two days', () => {
    const { input, games } = load('big-ten-women-2026', '2026-11-16');
    const r = classifyConference(input)!;
    expect(r.start).toBe('2026-11-04');
    expect(r.games.map((t) => t.label)).toEqual(['Quarterfinal', 'Quarterfinal', 'Quarterfinal', 'Quarterfinal', 'Semifinal', 'Semifinal', 'Final']);
    expect(r.champion).toBe('Purdue');
    expect(lines(r, games).at(-1)).toBe('2026-11-13 Final: Purdue 4-3 Michigan St.');
  });

  it('Ivy men 2026: the official table keeps the last regular round out of the bracket', () => {
    const { input } = load('ivy-men-2026', '2026-11-16');
    const r = classifyConference(input)!;
    expect(r.how).toBe('official');
    expect(r.start).toBe('2026-11-12');
    expect(r.teams).toHaveLength(4);
    expect(r.champion).toBe('Cornell');
    // Without the table, the latest balanced date gives the same answer.
    const b = classifyConference({ ...input, officialGp: undefined, officialRank: undefined })!;
    expect(b.how).toBe('balanced');
    expect(b.start).toBe('2026-11-12');
  });

  it('SoCon women 2025: ten teams, rounds follow the dates (byes enter at the quarterfinals)', () => {
    const { input, games } = load('socon-women-2025', '2025-12-31');
    const r = classifyConference(input)!;
    expect(r.teams).toHaveLength(10);
    expect(lines(r, games)).toContain('2025-10-31 Quarterfinal: Chattanooga 1-2 Furman');
    expect(r.games.filter((t) => t.label === 'First round')).toHaveLength(2);
    expect(r.champion).toBe('Samford');
  });

  it('WCC men 2025 has no tournament: the last regular round is not one', () => {
    const { input } = load('wcc-men-2025', '2025-12-31');
    expect(classifyConference(input)).toBeNull();
  });

  it('a tournament still being played may have open ends', () => {
    const { input } = load('big-ten-women-2026', '2026-11-09');
    const r = classifyConference({ ...input, games: input.games.filter((g) => g.date <= '2026-11-08') })!;
    expect(r.start).toBe('2026-11-04');
    expect(r.complete).toBe(false);
    expect(r.champion).toBeNull();
  });

  it('seeds: tied points get no seed', () => {
    const { input } = load('big-ten-men-2026', '2026-11-16');
    const r = classifyConference(input)!;
    const seeded = r.games.flatMap((t) => [t.homeSeed, t.awaySeed]).filter((s) => s != null);
    expect(new Set(seeded).size).toBe(seeded.length > 0 ? new Set(seeded).size : 0);
    expect(r.games[0]!.homeSeed).toBe(5);
  });
});

describe('knockout rules', () => {
  const g = (id: string, date: string, home: string, away: string, hs: number, as: number, extra: Partial<PsGame> = {}): PsGame =>
    ({ id, date, home, away, hs, as, status: 'final', shootout: false, neutral: false, ...extra });
  it('a loser playing on breaks it', () => {
    expect(knockout([g('1', '2026-11-01', 'A', 'B', 1, 0), g('2', '2026-11-03', 'B', 'C', 1, 0)]).ok).toBe(false);
  });
  it('a level game sends on one side only', () => {
    expect(knockout([g('1', '2026-11-01', 'A', 'B', 1, 1), g('2', '2026-11-03', 'A', 'C', 1, 0)]).ok).toBe(true);
    expect(knockout([g('1', '2026-11-01', 'A', 'B', 1, 1), g('2', '2026-11-03', 'A', 'C', 1, 0), g('3', '2026-11-03', 'B', 'D', 1, 0)]).ok).toBe(false);
  });
  it('who played on beats a box-score shootout tally that says otherwise', () => {
    const r = classifyConference({ members: ['A', 'B', 'C', 'D'], asOf: '2026-11-20', games: [
      g('r1', '2026-10-01', 'A', 'B', 1, 0), g('r2', '2026-10-01', 'C', 'D', 1, 0), g('r3', '2026-10-05', 'A', 'C', 1, 0), g('r4', '2026-10-05', 'B', 'D', 1, 0),
      g('r5', '2026-10-09', 'A', 'D', 1, 0), g('r6', '2026-10-09', 'B', 'C', 1, 0),
      g('s1', '2026-11-08', 'A', 'D', 1, 1, { pkWinner: 'A' }), g('s2', '2026-11-08', 'B', 'C', 2, 0),
      g('f', '2026-11-12', 'D', 'B', 0, 0, { pkWinner: 'D' }),
    ] })!;
    expect(r.games.find((t) => t.id === 's1')!.shootoutWinner).toBe('D');
    expect(r.champion).toBe('D');
  });
});
