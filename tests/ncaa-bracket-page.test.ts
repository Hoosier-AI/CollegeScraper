import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBracketPage, unflattenNuxt } from '../src/sources/ncaa/bracketPage.js';

const men = readFileSync(new URL('../fixtures/ncaa-bracket/soccer-men-d1-2026-11-17.html', import.meta.url), 'utf8');

describe('NCAA.com bracket page', () => {
  it('unflattens Nuxt payload references, wrappers and shared objects', () => {
    const flat = [['Reactive', 1], { a: 2, b: 3, c: 2 }, { x: 4 }, [4, 5], 'hi', 7];
    const out = unflattenNuxt(flat) as any;
    expect(out.a).toEqual({ x: 'hi' });
    expect(out.a).toBe(out.c);
    expect(out.b).toEqual(['hi', 7]);
  });

  it('reads the 2026 men\'s bracket the day after Selection Monday', () => {
    const page = parseBracketPage(men)!;
    expect(page.championshipId).toBe(6438);
    expect(page.games).toHaveLength(63);
    // First round: 16 games with both teams, home side and kickoff.
    const r1 = page.games.filter((g) => g.round === 1 && g.teams.length === 2);
    expect(r1).toHaveLength(16);
    const creighton = page.games.find((g) => g.slot === 103)!;
    expect(creighton).toMatchObject({ contestId: 6663794, date: '2026-11-19', startEpoch: 1795134600, state: 'pre' });
    expect(creighton.teams.find((t) => t.isHome)).toMatchObject({ seo: 'creighton', seed: 5 });
    // Second round: the 16 seeded teams with byes, each waiting for an opponent.
    const r2 = page.games.filter((g) => g.round === 2);
    expect(r2.every((g) => g.teams.length === 1 && g.teams[0]!.seed! >= 1 && g.teams[0]!.seed! <= 4)).toBe(true);
    expect(r2.find((g) => g.slot === 201)!.teams[0]).toMatchObject({ seo: 'georgetown', seed: 1 });
    // TBA slots carry no teams.
    expect(page.games.find((g) => g.slot === 601)!.teams).toEqual([]);
  });

  it('returns null for a page without bracket data', () => {
    expect(parseBracketPage('<html><body>Not found</body></html>')).toBeNull();
  });
});
