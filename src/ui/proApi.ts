// JSON behind the /pro pages of the site. Public reads, rate-limited by the same /api hook as the college routes
// (registerUiApi). Not part of /v1: API-Football's terms allow showing its data on our pages, not passing the raw
// data on, so pro data has no public API.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getDb, kvGet } from '../db/client.js';
import * as pro from '../pro/queries.js';
import { eastern } from '../jobs/seasons.js';
import { SLUG } from '../seo/util.js';
import { PRO_QUOTA_KEY } from '../jobs/pro/shared.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const season = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 1900 && n < 2100 ? n : null; };
const CACHE = 'public, max-age=30';

export function registerProApi(app: FastifyInstance): void {
  const notFound = async (reply: FastifyReply, kind: pro.ProKind, slug: string) => {
    const moved = SLUG.test(slug) ? await pro.renamedSlug(getDb(), kind, slug) : null;
    return reply.code(404).send({ error: 'not found', moved });
  };

  app.get<{ Querystring: Record<string, string> }>('/api/pro/home', async (req, reply) => {
    const date = req.query.date && DATE.test(req.query.date) ? req.query.date : eastern().date;
    return reply.header('Cache-Control', CACHE).send(await pro.home(getDb(), date));
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/matches', async (req, reply) => {
    const date = req.query.date ?? eastern().date;
    if (!DATE.test(date)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    if (req.query.status && !['scheduled', 'live', 'final', 'postponed', 'cancelled', 'abandoned'].includes(req.query.status)) return reply.code(400).send({ error: 'bad status' });
    const league = req.query.league ? Number(req.query.league) : null;
    return reply.header('Cache-Control', CACHE).send(await pro.matchesByDate(getDb(), { date, league: Number.isInteger(league) ? league : null, status: req.query.status ?? null, featured: req.query.featured === '1' }));
  });
  app.get('/api/pro/leagues', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=300').send(await pro.leagues(getDb())));
  app.get<{ Params: { slug: string }; Querystring: Record<string, string> }>('/api/pro/leagues/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await pro.league(getDb(), req.params.slug, season(req.query.season));
    return r ? reply.header('Cache-Control', CACHE).send(r) : notFound(reply, 'league', req.params.slug);
  });
  app.get<{ Params: { slug: string }; Querystring: Record<string, string> }>('/api/pro/teams/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await pro.team(getDb(), req.params.slug, season(req.query.season));
    return r ? reply.header('Cache-Control', CACHE).send(r) : notFound(reply, 'team', req.params.slug);
  });
  app.get<{ Params: { slug: string } }>('/api/pro/players/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await pro.player(getDb(), req.params.slug);
    return r ? reply.header('Cache-Control', CACHE).send(r) : notFound(reply, 'player', req.params.slug);
  });
  app.get<{ Params: { slug: string } }>('/api/pro/matches/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await pro.match(getDb(), req.params.slug);
    return r ? reply.header('Cache-Control', CACHE).send(r) : notFound(reply, 'match', req.params.slug);
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/search', async (req, reply) => {
    const q = String(req.query.q ?? '');
    return reply.header('Cache-Control', 'public, max-age=60').send(await pro.search(getDb(), q, Math.min(20, Number(req.query.limit) || 8)));
  });
  // College player page: "now plays for ..." when the link is confident or verified.
  app.get<{ Params: { id: string } }>('/api/pro/from-college/:id', async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    return reply.header('Cache-Control', 'public, max-age=300').send({ pro: await pro.proCareerOfCollegePlayer(getDb(), req.params.id) });
  });

  // Owner console (behind the trigger secret, like every /api/console route): the shared quota and the pipeline's size.
  app.get('/api/console/pro', async () => {
    const db = getDb();
    const count = (t: string, f?: (q: any) => any) => { let q = db.from(t).select('*', { count: 'exact', head: true }); if (f) q = f(q); return q.then((r: { count: number | null }) => r.count ?? 0); };
    const [quota, leagues, enabled, fixtures, finals, detailed, players, profiled, links, seasonsDone, seasonsAll] = await Promise.all([
      kvGet(db, PRO_QUOTA_KEY),
      count('pro_leagues'), count('pro_leagues', (q) => q.eq('enabled', true)),
      count('pro_fixtures'), count('pro_fixtures', (q) => q.eq('status', 'final')), count('pro_fixtures', (q) => q.not('detail_fetched_at', 'is', null)),
      count('pro_players'), count('pro_players', (q) => q.not('profile_synced_at', 'is', null)),
      count('pro_college_links', (q) => q.gte('confidence', 0.85).eq('rejected', false)),
      count('pro_seasons', (q) => q.not('backfilled_at', 'is', null)), count('pro_seasons', (q) => q.not('fixtures_synced_at', 'is', null)),
    ]);
    return { quota, leagues, enabled, fixtures, finals, detailed, players, profiled, college_links: links, seasons_backfilled: seasonsDone, seasons_started: seasonsAll };
  });
}
