// Shape guarantees of the public API that need no database.
import { describe, it, expect } from 'vitest';
import { visibleRoster, withSchoolNames, redactGame, visibleRankings } from '../../src/api/v1.js';
import { runs, leaders } from '../../src/ui/queries.js';
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

describe('suppressed players', () => {
  const game = () => ({ game: { id: 'g' }, team: [{ goals: 2 }], raw: [{ payload: 'names everyone' }],
    players: [{ player_season_id: 'ps1', player_id: 'p1', first_name: 'Open', last_name: 'Player', goals: 1, suppress: false }, { player_season_id: 'ps2', player_id: 'p2', first_name: 'Hidden', last_name: 'Person', source_key: 'hidden-person', goals: 1, minutes: 90, suppress: true }],
    events: [{ seq: 1, event_type: 'goal', player_season_id: 'ps1', player_name_raw: 'Open Player', assist_player_season_id: 'ps2', assist_name_raw: 'Hidden Person', play_text: 'GOAL by Open Player, assist Hidden Person' },
      { seq: 2, event_type: 'goal', player_season_id: 'ps2', player_name_raw: 'Hidden Person', play_text: 'GOAL by Hidden Person' }, { seq: 3, event_type: 'corner', player_season_id: 'ps1', player_name_raw: 'Open Player', play_text: 'Corner, Open Player' }] });
  it('a box score keeps the numbers and loses the person', () => {
    const out: any = redactGame(game());
    expect(JSON.stringify(out)).not.toMatch(/Hidden|hidden-person|"p2"|"ps2"/);
    expect(out.players[1]).toMatchObject({ goals: 1, minutes: 90, first_name: null, last_name: null, player_id: null, withheld: true });
    expect(out.players.reduce((n: number, p: any) => n + p.goals, 0)).toBe(2);           // still adds up to the team's goals
    expect(out.players[0]).toEqual({ player_season_id: 'ps1', player_id: 'p1', first_name: 'Open', last_name: 'Player', goals: 1 });
    expect(out.events[0]).toMatchObject({ player_name_raw: 'Open Player', assist_name_raw: null, play_text: null, withheld: true });
    expect(out.events[2]).toEqual(game().events[2]);
    expect(out.raw).toBeUndefined();                                                     // the source payload names everyone
  });
  it('a game without one is untouched apart from the internal flag', () => {
    const g = game(); g.players[1].suppress = false;
    const out: any = redactGame(g);
    expect(out.events).toEqual(g.events); expect(out.raw).toEqual(g.raw); expect('suppress' in out.players[0]).toBe(false); expect(out.players[1].last_name).toBe('Person');
  });
  it('an individual national ranking leaves a suppressed player out', () => {
    const rows = [{ rank: 1, subject_name: 'Hidden Person', college_player_seasons: { id: 'ps2', college_players: { display_name: 'Hidden Person', suppress: true } } }, { rank: 2, subject_name: 'Open Player', college_player_seasons: { id: 'ps1', college_players: { display_name: 'Open Player', suppress: false } } }, { rank: 1, subject_name: 'Duke', college_player_seasons: null }];
    const out: any[] = visibleRankings(rows as any);
    expect(out.map((r) => r.subject_name)).toEqual(['Open Player', 'Duke']); expect(JSON.stringify(out)).not.toMatch(/Hidden|suppress":/);
  });
});

describe('leaders paging', () => {
  // Records every builder call; .range() resolves the query.
  const fakeDb = () => { const calls: any[] = []; const chain: any = new Proxy({}, { get: (_t, m: string) => (...a: any[]) => { calls.push([m, ...a]); return m === 'range' ? Promise.resolve({ data: [], error: null, count: 0 }) : chain; } }); return { db: { from: () => chain } as any, calls }; };
  it('orders by the stat, then by a unique key, so tied rows page without repeats or gaps', async () => {
    const p = fakeDb(); await leaders(p.db, { season: 2026, stat: 'goals', limit: 5, offset: 5 } as any);
    expect(p.calls.filter((c) => c[0] === 'order').map((c) => c[1])).toEqual(['goals', 'player_season_id']);
    expect(p.calls.find((c) => c[0] === 'range')).toEqual(['range', 5, 9]);
    const t = fakeDb(); await leaders(t.db, { season: 2026, kind: 'team', stat: 'gf_pg' } as any);
    expect(t.calls.filter((c) => c[0] === 'order').map((c) => c[1])).toEqual(['gf_pg', 'program_id']);
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
