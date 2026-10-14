import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeRpi, spearman, RPI_DEFAULT } from '../src/college/rpi.js';
import { parseRpi, rpiUrl } from '../src/sources/ncaa/rankings.js';

const g = (home: string, away: string, hs: number, as: number) => ({ home, away, hs, as, neutral: false });
// A beats B, A ties C, B beats C, C beats D. D also played X (outside the pool: ignored).
const games = [g('A', 'B', 2, 0), g('A', 'C', 1, 1), g('B', 'C', 1, 0), g('C', 'D', 3, 1), g('D', 'X', 5, 0)];
const pool = new Set(['A', 'B', 'C', 'D']);

describe('RPI', () => {
  it('works out WP, OWP (without games against the team) and OOWP by hand', () => {
    const r = computeRpi(games, pool, { tie: 0.5, homeWin: 1, roadWin: 1, homeLoss: 1, roadLoss: 1 });
    const a = r.get('A')!;
    expect(a.w).toBe(1); expect(a.t).toBe(1);
    expect(a.wp).toBeCloseTo(0.75, 6); // (1 + 0.5) / 2
    // B without A: 1-0 (1.0); C without A: B loss, D win -> 0.5; OWP = (1 + 0.5) / 2
    expect(a.owp).toBeCloseTo(0.75, 6);
    expect(r.has('X')).toBe(false);
    expect(r.get('D')!.w + r.get('D')!.l + r.get('D')!.t).toBe(1);
    const b = r.get('B')!, c = r.get('C')!;
    expect(a.oowp).toBeCloseTo((b.owp + c.owp) / 2, 6);
    expect(a.rpi).toBeCloseTo(0.25 * a.wp + 0.5 * a.owp + 0.25 * a.oowp, 9);
  });
  it('values a tie at a third in the team\'s own record by default', () => {
    expect(computeRpi(games, pool, RPI_DEFAULT).get('A')!.wp).toBeCloseTo((1 + 1 / 3) / 2, 6);
  });
  it('weights road wins when asked', () => {
    const plain = computeRpi(games, pool).get('B')!.wp, road = computeRpi([g('A', 'B', 0, 1), g('B', 'C', 0, 1)], new Set(['A', 'B', 'C']), { ...RPI_DEFAULT, roadWin: 1.4, homeLoss: 1.4 }).get('B')!.wp;
    expect(plain).toBe(0.5); expect(road).toBeCloseTo(1.4 / 2.8, 6);
  });
  it('compares orders', () => {
    expect(spearman(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
    expect(spearman(['a', 'b', 'c'], ['c', 'b', 'a'])).toBe(-1);
  });
  it('reads NCAA.com\'s published D1 order', () => {
    expect(rpiUrl('w')).toBe('https://www.ncaa.com/rankings/soccer-women/d1/ncaa-womens-soccer-rpi');
    const w = parseRpi(readFileSync('fixtures/ncaa/rpi-women.html', 'utf8'));
    expect(w.rows.length).toBeGreaterThan(300);
    expect(w.rows[0]).toMatchObject({ rank: 1, school: 'North Carolina', record: '11-1-0', conference: 'ACC' });
    expect(w.asOf).toMatch(/Oct\. 13/);
  });
});
