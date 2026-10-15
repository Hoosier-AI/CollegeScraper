import { describe, expect, it } from 'vitest';
import { tableView, type ViewMatch } from '../src/standings/views.js';

const m = (home: string, away: string, hs: number, as: number, date: string): ViewMatch => ({ home, away, hs, as, date });
const ms = [m('A', 'B', 2, 0, '2026-01-01'), m('B', 'C', 1, 1, '2026-01-08'), m('C', 'A', 3, 1, '2026-01-15'), m('A', 'C', 0, 0, '2026-01-22'), m('B', 'A', 0, 1, '2026-01-29')];

describe('table views', () => {
  it('home and away add up to the whole table', () => {
    const all = tableView(ms, ['A', 'B', 'C'], 'all'), home = tableView(ms, ['A', 'B', 'C'], 'home'), away = tableView(ms, ['A', 'B', 'C'], 'away');
    for (const t of ['A', 'B', 'C']) {
      const [x, h, a] = [all, home, away].map((rows) => rows.find((r) => r.team === t)!);
      expect(h.p + a.p).toBe(x.p); expect(h.pts + a.pts).toBe(x.pts); expect(h.gf + a.gf).toBe(x.gf);
    }
    expect(all[0]).toMatchObject({ team: 'A', p: 4, w: 2, d: 1, l: 1, pts: 7, gd: 1, form: 'WLDW' });
  });
  it('form counts only the last N', () => {
    const f = tableView(ms, ['A', 'B', 'C'], 'form', 2);
    expect(f.find((r) => r.team === 'A')).toMatchObject({ p: 2, pts: 4 });
  });
});
