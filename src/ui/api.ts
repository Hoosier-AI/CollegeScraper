// JSON API behind the stats viewer. Every route needs the trigger secret; reads use the service role.
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';
import { enqueue, jobNames } from '../jobs/runner.js';
import * as q from './queries.js';

const UUID = /^[0-9a-f-]{36}$/i;

export function registerUiApi(app: FastifyInstance, authorized: (h: string | undefined) => boolean): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (!authorized(req.headers.authorization)) return reply.code(401).send({ error: 'unauthorized' });
  });
  const season = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 1990 && n < 2100 ? n : null; };
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

  app.get('/api/meta', async () => ({ ...(await q.meta(getDb())), jobs: jobNames() }));

  app.get<{ Querystring: Record<string, string> }>('/api/programs', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    return q.programs(getDb(), { season: s, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference), q: str(req.query.q) });
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/programs/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const s = season(req.query.season) ?? (await q.meta(getDb())).currentSeason;
    const r = await q.program(getDb(), req.params.id, s);
    return r ?? reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/programs/:id/roster', async (req, reply) => {
    const s = season(req.query.season); if (!s || !UUID.test(req.params.id)) return reply.code(400).send({ error: 'season + id required' });
    return q.roster(getDb(), req.params.id, s);
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/programs/:id/games', async (req, reply) => {
    const s = season(req.query.season); if (!s || !UUID.test(req.params.id)) return reply.code(400).send({ error: 'season + id required' });
    return q.programGames(getDb(), req.params.id, s);
  });
  app.post<{ Params: { id: string }; Body: { season?: number; force?: boolean } | null }>('/api/programs/:id/sync', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const db = getDb();
    const { data: p } = await db.from('college_programs').select('school_seo,gender').eq('id', req.params.id).maybeSingle();
    if (!p) return reply.code(404).send({ error: 'not found' });
    const s = season(req.body?.season) ?? (await q.meta(db)).currentSeason;
    return reply.code(202).send(await enqueue(db, 'sync-program', { season: s, program: p.school_seo, gender: p.gender, force: !!req.body?.force }));
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const r = await q.game(getDb(), req.params.id);
    return r ?? reply.code(404).send({ error: 'not found' });
  });
  app.post<{ Params: { id: string } }>('/api/games/:id/refetch', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const db = getDb();
    const { data: g } = await db.from('college_games').select('season,ncaa_contest_id,home_program_id,away_program_id,college_programs!college_games_home_program_id_fkey(school_seo,gender)').eq('id', req.params.id).maybeSingle();
    if (!g) return reply.code(404).send({ error: 'not found' });
    const out: unknown[] = [];
    const home = (g as any).college_programs;
    if (home?.school_seo) out.push(await enqueue(db, 'sync-site', { season: g.season, program: home.school_seo, gender: home.gender, stages: ['schedule', 'boxscores'], force: true }));
    if (g.ncaa_contest_id) out.push(await enqueue(db, 'fetch-games-ncaa', { season: g.season, contest_ids: [String(g.ncaa_contest_id)], refetch: true }));
    out.push(await enqueue(db, 'reconcile-games', { season: g.season, all: true }));
    return reply.code(202).send(out);
  });

  app.get<{ Params: { id: string } }>('/api/players/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const r = await q.player(getDb(), req.params.id);
    return r ?? reply.code(404).send({ error: 'not found' });
  });

  app.get<{ Querystring: Record<string, string> }>('/api/leaders', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    return { stats: req.query.kind === 'team' ? q.TEAM_STATS : q.PLAYER_STATS, rows: await q.leaders(getDb(), { season: s, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference), kind: str(req.query.kind), stat: str(req.query.stat), min_minutes: req.query.min_minutes, limit: req.query.limit }) };
  });
  app.get<{ Querystring: Record<string, string> }>('/api/standings', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    return q.standings(getDb(), { season: s, gender: str(req.query.gender), division: str(req.query.division) });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/rankings', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    return q.rankings(getDb(), { season: s, gender: str(req.query.gender), division: str(req.query.division), poll: str(req.query.poll), week_of: str(req.query.week_of) });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/quality', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    return q.quality(getDb(), s);
  });
  app.get<{ Querystring: Record<string, string> }>('/api/runs', async (req) => q.runs(getDb(), Math.min(200, Number(req.query.limit) || 50)));
  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => (await q.run(getDb(), req.params.id)) ?? reply.code(404).send({ error: 'not found' }));
  app.post<{ Body: { job?: string; params?: Record<string, unknown> } | null }>('/api/jobs/enqueue', async (req, reply) => {
    const job = req.body?.job;
    if (!job || !jobNames().includes(job)) return reply.code(400).send({ error: 'unknown job', jobs: jobNames() });
    return reply.code(202).send(await enqueue(getDb(), job, req.body?.params ?? {}));
  });
  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (req, reply) => {
    const { error } = await getDb().from('college_crawl_runs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', req.params.id).in('status', ['queued', 'running']);
    if (error) return reply.code(500).send({ error: error.message });
    return { ok: true };
  });
}
