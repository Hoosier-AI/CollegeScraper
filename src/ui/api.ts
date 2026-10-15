// JSON API behind the stats viewer. Reads are public (this is what the site itself renders); enqueueing work,
// cancelling runs and the crawl-health pages need the trigger secret. Queries run with the service role.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../db/client.js';
import { enqueue, jobNames } from '../jobs/runner.js';
import * as q from './queries.js';
import { collegeElo, programElo } from './elo.js';
import { programRpi, rpiTable } from './rpi.js';
import { isBot } from '../pro/onView.js';
import { eastern } from '../jobs/seasons.js';
import { registerProApi } from './proApi.js';
import { registerIntlApi } from './intlApi.js';
import { registerNewsApi } from '../news/queries.js';
import { follows, parseFollows } from './follows.js';
import { COLLEGE_REF_SORTS, collegeGameReferee, collegeReferee, collegeRefereeList } from '../referees.js';

const UUID = /^[0-9a-f-]{36}$/i;

export interface UiApiOptions {
  /** True when the request carries the admin trigger secret. */
  authorized: (h: string | undefined) => boolean;
  /**
   * Rate-limits a request that is not from an admin, replying 429 itself when over the limit.
   * Returning false means the reply has already been sent.
   */
  limitAnonymous?: (req: FastifyRequest, reply: FastifyReply) => boolean | Promise<boolean>;
}

export function registerUiApi(app: FastifyInstance, opts: UiApiOptions | ((h: string | undefined) => boolean)): void {
  const { authorized, limitAnonymous } = typeof opts === 'function' ? { authorized: opts, limitAnonymous: undefined } : opts;
  // Admin-only paths: anything that starts work or cancels it, plus the crawl-health surfaces.
  const adminOnly = (req: FastifyRequest): boolean =>
    req.method !== 'GET' || req.url.startsWith('/api/quality') || req.url.startsWith('/api/console') || /^\/api\/runs(\/|\?|$)/.test(req.url);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    // The analytics beacon (src/server.ts) keeps its own limit and is not an API read.
    if (req.url === '/api/t') return;
    if (adminOnly(req)) {
      if (!authorized(req.headers.authorization)) return reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (authorized(req.headers.authorization)) return;
    if (limitAnonymous && !(await limitAnonymous(req, reply))) return reply;
  });
  const season = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 1990 && n < 2100 ? n : null; };
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

  app.get('/api/meta', async () => ({ ...(await q.meta(getDb())), jobs: jobNames() }));

  // Plaibook Stats Pro (/pro pages) and International (/intl pages).
  registerProApi(app);
  registerIntlApi(app);
  // News for College, Pro and International (src/news).
  registerNewsApi(app);

  app.get<{ Querystring: Record<string, string> }>('/api/programs', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    return q.programs(getDb(), { season: s, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference), q: str(req.query.q), members: req.query.members !== 'all' });
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
  app.get<{ Querystring: Record<string, string> }>('/api/elo', async (req, reply) => {
    const div = str(req.query.division), conf = str(req.query.conference);
    return reply.header('Cache-Control', 'public, max-age=600').send(await collegeElo(getDb(), { gender: req.query.gender === 'w' ? 'w' : 'm', division: div && ['d1', 'd2', 'd3'].includes(div) ? div : undefined, conference: conf && UUID.test(conf) ? conf : undefined, limit: req.query.limit, offset: req.query.offset }));
  });
  app.get<{ Querystring: Record<string, string> }>('/api/rpi', async (req, reply) => {
    const div = str(req.query.division), conf = str(req.query.conference);
    return reply.header('Cache-Control', 'public, max-age=60').send(await rpiTable(getDb(), { gender: req.query.gender === 'w' ? 'w' : 'm', division: div && ['d1', 'd2', 'd3'].includes(div) ? div : 'd1', conference: conf && UUID.test(conf) ? conf : undefined, limit: req.query.limit, offset: req.query.offset }));
  });
  app.get<{ Params: { id: string } }>('/api/programs/:id/elo', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'id required' });
    return reply.header('Cache-Control', 'public, max-age=300').send({ elo: await programElo(getDb(), req.params.id) });
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/programs/:id/rpi', async (req, reply) => {
    const s = season(req.query.season); if (!s || !UUID.test(req.params.id)) return reply.code(400).send({ error: 'season + id required' });
    return reply.header('Cache-Control', 'public, max-age=60').send({ rpi: await programRpi(getDb(), req.params.id, s) });
  });
  app.get<{ Params: { id: string } }>('/api/coaches/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'id required' });
    const r = await q.coach(getDb(), req.params.id);
    return r ? reply.header('Cache-Control', 'public, max-age=600').send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/h2h', async (req, reply) => {
    const a = str(req.query.a), b = str(req.query.b);
    if (!a || !b || !UUID.test(a) || !UUID.test(b) || a === b) return reply.code(400).send({ error: 'a and b must be two program ids' });
    const r = await q.programH2H(getDb(), a, b);
    return r ? reply.header('Cache-Control', 'public, max-age=300').send(r) : reply.code(404).send({ error: 'not found' });
  });
  // The home page's Following panel (src/ui/follows.ts): ?f=team:<id>,pro-player:<id>,...
  app.get<{ Querystring: Record<string, string> }>('/api/follows', async (req, reply) => {
    const refs = parseFollows(req.query.f);
    if (!refs.length) return reply.send({ items: [] });
    return reply.header('Cache-Control', 'public, max-age=120').send({ items: await follows(getDb(), refs) });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/transfers', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    const conf = str(req.query.conference);
    return reply.header('Cache-Control', 'public, max-age=300').send(await q.transfersFeed(getDb(), { season: s, gender: str(req.query.gender), division: str(req.query.division), conference: conf && UUID.test(conf) ? conf : undefined, q: str(req.query.q), limit: req.query.limit, offset: req.query.offset }));
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/programs/:id/periods', async (req, reply) => {
    const s = season(req.query.season); if (!s || !UUID.test(req.params.id)) return reply.code(400).send({ error: 'season + id required' });
    return reply.header('Cache-Control', 'public, max-age=300').send(await q.goalsByPeriod(getDb(), req.params.id, s));
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
  app.get<{ Params: { id: string } }>('/api/games/:id/referee', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    return reply.header('Cache-Control', 'public, max-age=600').send({ referee: await collegeGameReferee(getDb(), req.params.id) });
  });
  // College referees (migration 187): the list and one referee's page.
  app.get<{ Querystring: Record<string, string> }>('/api/referees', async (req, reply) => {
    const r = req.query;
    const n = (v: unknown) => { const x = Number(v); return v != null && v !== '' && Number.isInteger(x) ? x : null; };
    const f = {
      season: r.season === 'all' ? null : season(r.season) ?? (await q.meta(getDb())).currentSeason,
      gender: (r.gender === 'w' || r.gender === 'm' ? r.gender : null) as 'm' | 'w' | null, division: ['d1', 'd2', 'd3'].includes(r.division ?? '') ? r.division! : null,
      q: r.q ? String(r.q).trim().slice(0, 60) || null : null, min: Math.min(100, Math.max(1, n(r.min) ?? 5)),
      sort: (COLLEGE_REF_SORTS as readonly string[]).includes(r.sort ?? '') ? r.sort! : 'games',
      limit: Math.min(100, Math.max(1, n(r.limit) ?? 50)), offset: Math.max(0, n(r.offset) ?? 0),
    };
    return reply.header('Cache-Control', 'public, max-age=300').send(await collegeRefereeList(getDb(), f));
  });
  app.get<{ Params: { slug: string } }>('/api/referees/:slug', async (req, reply) => {
    if (!/^[a-z0-9-]{2,120}$/.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await collegeReferee(getDb(), req.params.slug);
    return r ? reply.header('Cache-Control', 'public, max-age=300').send(r) : reply.code(404).send({ error: 'not found' });
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
    const page = await q.leaders(getDb(), { season: s, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference), kind: str(req.query.kind), stat: str(req.query.stat), min_minutes: req.query.min_minutes, limit: req.query.limit, offset: req.query.offset, q: str(req.query.q), members: req.query.members !== 'all', position: str(req.query.position), class_year: req.query.class_year });
    return { stats: req.query.kind === 'team' ? q.TEAM_STATS : q.PLAYER_STATS, ...page };
  });
  app.get<{ Querystring: Record<string, string> }>('/api/matches', async (req, reply) => {
    const date = str(req.query.date) ?? eastern().date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    if (req.query.conference && !UUID.test(req.query.conference)) return reply.code(400).send({ error: 'conference must be a uuid' });
    if (req.query.status && !['scheduled', 'live', 'final', 'postponed', 'cancelled'].includes(req.query.status)) return reply.code(400).send({ error: 'bad status' });
    return q.gamesByDate(getDb(), { date, days: req.query.days, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference), status: str(req.query.status), only: str(req.query.only), on_tv: req.query.on_tv === '1', network: str(req.query.network) });
  });
  app.get<{ Params: { id: string } }>('/api/matches/:id/preview', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const r = await q.matchPreview(getDb(), req.params.id, { queue: !isBot(req.headers['user-agent']) });
    return r ?? reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/conferences', async (req, reply) => {
    const s = season(req.query.season) ?? (await q.meta(getDb())).currentSeason;
    return q.conferences(getDb(), { season: s, gender: str(req.query.gender), division: str(req.query.division) });
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/conferences/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const s = season(req.query.season) ?? (await q.meta(getDb())).currentSeason;
    const r = await q.conference(getDb(), req.params.id, { season: s, gender: req.query.gender === 'w' ? 'w' : 'm' });
    return r ?? reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/standings', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    return q.standings(getDb(), { season: s, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference) });
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
