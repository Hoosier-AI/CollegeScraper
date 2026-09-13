// Integration test for the viewer API. Runs only against a LOCAL Supabase (SUPABASE_URL=127.0.0.1/localhost);
// skipped otherwise so `npm test` stays offline-safe.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const envFile = existsSync('.env') ? Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])) : {};
const url = process.env.SUPABASE_URL ?? envFile.SUPABASE_URL ?? '';
const local = /127\.0\.0\.1|localhost/.test(url);

describe.skipIf(!local)('viewer api (local supabase)', () => {
  let app: any;
  const secret = 'test-secret';
  beforeAll(async () => {
    for (const [k, v] of Object.entries(envFile)) if (!process.env[k]) process.env[k] = v as string;
    process.env.COLLEGE_TRIGGER_SECRET = secret;
    const { default: Fastify } = await import('fastify');
    const { registerUiApi } = await import('../../src/ui/api.js');
    const { registerAllJobs } = await import('../../src/jobs/index.js');
    registerAllJobs();
    app = Fastify();
    registerUiApi(app, (h) => h === `Bearer ${secret}`);
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });
  const get = (path: string, auth = true) => app.inject({ method: 'GET', url: path, headers: auth ? { authorization: `Bearer ${secret}` } : {} });

  it('rejects missing or wrong secrets', async () => {
    expect((await get('/api/meta', false)).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/meta', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
  });
  it('serves meta and programs', async () => {
    const meta = (await get('/api/meta')).json();
    expect(meta.seasons).toContain(2025);
    expect(meta.jobs).toContain('sync-program');
    const res = await get('/api/programs?season=2025&gender=m');
    expect(res.statusCode).toBe(200);
    const duke = res.json().find((p: any) => p.school_seo === 'duke');
    expect(duke).toBeTruthy();
    expect(duke.games.finals).toBeGreaterThanOrEqual(20);
  });
  it('serves a program, its roster, games, one game and one player', async () => {
    const duke = (await get('/api/programs?season=2025&gender=m')).json().find((p: any) => p.school_seo === 'duke');
    const team = (await get(`/api/programs/${duke.id}?season=2025`)).json();
    expect(team.teamStats.gp).toBe(20);
    const roster = (await get(`/api/programs/${duke.id}/roster?season=2025`)).json();
    expect(roster.length).toBeGreaterThanOrEqual(30);
    const hot = roster.find((r: any) => r.player.display_name === 'Kenan Hot');
    expect(hot.stats.goals).toBe(hot.site.goals);
    const games = (await get(`/api/programs/${duke.id}/games?season=2025`)).json();
    expect(games).toHaveLength(20);
    const game = (await get(`/api/games/${games[0].id}`)).json();
    expect(game.team.length).toBeGreaterThanOrEqual(2);
    expect(game.players.length).toBeGreaterThan(20);
    expect(game.events.length).toBeGreaterThan(50);
    const player = (await get(`/api/players/${hot.player.id}`)).json();
    expect(player.seasons[0].stats.goals).toBe(8);
    expect(player.gameLog.length).toBe(20);
  });
  it('serves leaders with an allowlisted stat, standings, rankings and quality', async () => {
    const l = (await get('/api/leaders?season=2025&gender=m&stat=goals&limit=5')).json();
    expect(l.rows.length).toBeLessThanOrEqual(5);
    expect(l.stats).toContain('goals_p90');
    const bad = (await get('/api/leaders?season=2025&gender=m&stat=drop_table')).json();
    expect(bad.rows.length).toBeGreaterThan(0); // falls back to goals
    expect((await get('/api/standings?season=2025&gender=m')).statusCode).toBe(200);
    expect((await get('/api/rankings?season=2025&gender=m')).json()).toHaveProperty('polls');
    const q = (await get('/api/quality?season=2025')).json();
    expect(q.checks.find((c: any) => c.id === 'score_mismatch').count).toBe(0);
    expect(q.checks.find((c: any) => c.id === 'player_goals').count).toBe(0);
  });
  it('validates ids and seasons', async () => {
    expect((await get('/api/programs/not-a-uuid')).statusCode).toBe(400);
    expect((await get('/api/programs?season=abc')).statusCode).toBe(400);
    expect((await get('/api/games/00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
  });
});
