// Shape guarantees of the public API that need no database.
import { describe, it, expect } from 'vitest';
import { visibleRoster, withSchoolNames } from '../../src/api/v1.js';
import { runs } from '../../src/ui/queries.js';
import { createCollegeApi } from '../../docs/plaibook-client.mjs';

describe('/v1 shapes', () => {
  it('runs() asks for exactly `limit` rows, once', async () => {
    const calls: any[] = [];
    const chain: any = { select: (c: string) => (calls.push(['select', c]), chain), order: (c: string, o: any) => (calls.push(['order', c, o]), chain), range: () => { throw new Error('runs() must not page'); },
      limit: (n: number) => { calls.push(['limit', n]); return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: i })), error: null }); } };
    const db: any = { from: (t: string) => (calls.push(['from', t]), chain) };
    const out = await runs(db, 20);
    expect(out).toHaveLength(20);
    expect(calls.filter((c) => c[0] === 'limit')).toEqual([['limit', 20]]);
    expect(calls.filter((c) => c[0] === 'from')).toHaveLength(1);
  });
  it('a suppressed player never leaves through a roster route', () => {
    const rows = [{ id: 1, player: { suppress: false } }, { id: 2, player: { suppress: true } }, { id: 3, player: null }, { id: 4 }];
    expect(visibleRoster(rows as any).map((r: any) => r.id)).toEqual([1, 3, 4]);
  });
  it('search rows carry the school name and long name', () => {
    const out = withSchoolNames([{ program_id: 'a', school_seo: 'duke' }, { program_id: 'b', school_seo: 'nowhere' }, { program_id: 'c', school_seo: 'unc' }],
      [{ seo: 'duke', name: 'Duke', long_name: 'Duke University' }, { seo: 'unc', name: 'North Carolina', long_name: null }]);
    expect(out[0]).toMatchObject({ school_name: 'Duke', school_long_name: 'Duke University' });
    expect(out[1]).toMatchObject({ school_name: null, school_long_name: null });
    expect(out[2]).toMatchObject({ school_name: 'North Carolina', school_long_name: 'North Carolina' });
  });
});

describe('plaibook client', () => {
  const api = (body: any, init: any = {}) => createCollegeApi({ baseUrl: 'https://c.example/', apiKey: 'k', now: () => 0,
    fetcher: async (url: string) => { (api as any).last = url; return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init }); } });
  it('an array answer comes back as rows, not numeric keys', async () => {
    const out: any = await api([{ id: 'x' }, { id: 'y' }]).run('college_programs', { season: 2026 });
    expect(out.rows).toEqual([{ id: 'x' }, { id: 'y' }]); expect(out['0']).toBeUndefined(); expect(out.source).toBe('college');
  });
  it('a 200 that is not JSON is unavailable, not an empty success', async () => {
    expect(await api('<html>waking up</html>').run('college_meta', {})).toEqual({ unavailable: true, note: 'College API returned an unreadable response.' });
  });
  it('college_team forwards include; leaders forwards offset and q', async () => {
    await api({}).run('college_team', { program_id: 'bc28e132-d14f-4593-81d3-e2fcff37fd4f', include: 'none' });
    expect((api as any).last).toContain('include=none');
    await api({}).run('college_leaders', { season: 2026, offset: 100, q: 'smith' });
    expect((api as any).last).toContain('offset=100'); expect((api as any).last).toContain('q=smith');
  });
});
