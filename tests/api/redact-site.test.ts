// A player under a takedown request is withheld on the site's own /api reads (and so on Plaibook's /v1/site mirror),
// not only on /v1: the profile is 404, rosters and rankings leave them out, box scores and previews keep the numbers
// without the name, and no answer carries the stored source payloads. The admin viewer still sees everything.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../src/db/client.js', async (orig) => ({ ...(await orig<any>()), getDb: () => ({}) }));
vi.mock('../../src/ui/queries.js', async (orig) => {
  const real = await orig<any>();
  const hidden = { id: 'p2', suppress: true };
  return {
    ...real,
    meta: async () => ({ seasons: [2025], currentSeason: 2025, genders: ['m', 'w'], divisions: ['d1'], conferences: [] }),
    player: async (_db: unknown, id: string) => ({ player: { id, suppress: id === '00000000-0000-4000-8000-000000000002' }, seasons: [], gameLog: [] }),
    roster: async () => [{ id: 'a', player: { id: 'p1', suppress: false } }, { id: 'b', player: hidden }],
    game: async (_db: unknown, _id: string, opts: { raw?: boolean } = {}) => ({
      game: { id: 'g', status: 'final', gender: 'm' },
      players: [{ player_season_id: 's1', first_name: 'Ann', last_name: 'One', suppress: false }, { player_season_id: 's2', first_name: 'Hid', last_name: 'Den', suppress: true }],
      events: [{ player_season_id: 's2', player_name_raw: 'Den, Hid', play_text: 'Goal by Den, Hid' }],
      raw: opts.raw ? [{ source: 'ncaa', payload: {} }] : [],
    }),
    matchPreview: async () => ({ game: { status: 'scheduled' }, head_to_head: {}, sides: { home: { leaders: { scorers: [{ name: 'Hid', suppress: true }, { name: 'Ann', suppress: false }], assists: [], keeper: null }, lineup: null, last_lineup: null }, away: null } }),
    rankings: async () => ({ polls: [], rows: [{ rank: 1, college_player_seasons: { college_players: { display_name: 'Hid', suppress: true } } }, { rank: 2, college_player_seasons: null }] }),
    conference: async () => ({ conference: { id: 'c' }, leaders: { points: [{ display_name: 'Hid', suppress: true }, { display_name: 'Ann', suppress: false }] } }),
  };
});

const { registerUiApi } = await import('../../src/ui/api.js');
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe('takedowns on the site API', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    registerUiApi(app, { authorized: (h) => h === 'Bearer adm' });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  const get = (url: string, admin = false) => app.inject({ method: 'GET', url, headers: admin ? { authorization: 'Bearer adm' } : {} });

  it('a suppressed player has no profile (the admin viewer still opens it)', async () => {
    expect((await get(`/api/players/${ID(2)}`)).statusCode).toBe(404);
    expect((await get(`/api/players/${ID(1)}`)).statusCode).toBe(200);
    expect((await get(`/api/players/${ID(2)}`, true)).statusCode).toBe(200);
  });
  it('rosters leave them out', async () => {
    expect((await get(`/api/programs/${ID(3)}/roster?season=2025`)).json().map((r: any) => r.id)).toEqual(['a']);
    expect((await get(`/api/programs/${ID(3)}/roster?season=2025`, true)).json()).toHaveLength(2);
  });
  it('box scores keep the numbers, drop the name, and never carry source payloads', async () => {
    const r = (await get(`/api/games/${ID(4)}`)).json();
    expect(r.raw).toBeUndefined();
    expect(r.players[1]).toMatchObject({ first_name: null, last_name: null, withheld: true });
    expect(r.players[1].suppress).toBeUndefined();
    expect(r.events[0].player_name_raw).toBeNull();
    expect(r.events[0].play_text).toBeNull();
    expect((await get(`/api/games/${ID(4)}`, true)).json().raw).toHaveLength(1);
  });
  it('previews, rankings and conference leaders withhold them', async () => {
    const p = (await get(`/api/matches/${ID(5)}/preview`)).json();
    expect(p.sides.home.leaders.scorers.map((x: any) => x.name)).toEqual(['Ann']);
    const k = (await get('/api/rankings?season=2025')).json();
    expect(k.rows.map((x: any) => x.rank)).toEqual([2]);
    const c = (await get(`/api/conferences/${ID(6)}?season=2025`)).json();
    expect(c.leaders.points.map((x: any) => x.display_name)).toEqual(['Ann']);
  });
  it('a conference filter that is not an id is a 400, not a database error', async () => {
    for (const path of ['/api/programs', '/api/leaders', '/api/standings']) expect((await get(`${path}?season=2025&conference=nope`)).statusCode).toBe(400);
  });
});
