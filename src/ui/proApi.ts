// JSON behind the /pro pages of the site. Public reads, rate-limited by the same /api hook as the college routes
// (registerUiApi). Not part of /v1: API-Football's terms allow showing its data on our pages, not passing the raw
// data on, so pro data has no public API.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getDb, kvGet, selectAll } from '../db/client.js';
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
  // Leaders and the player directory share one query (pro_leaders).
  const int = (v: unknown) => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) ? n : null; };
  app.get<{ Querystring: Record<string, string> }>('/api/pro/leaders', async (req, reply) => {
    const q = req.query;
    if (q.position && !(pro.POSITIONS as readonly string[]).includes(q.position)) return reply.code(400).send({ error: 'bad position' });
    return reply.header('Cache-Control', 'public, max-age=300').send(await pro.leaders(getDb(), {
      stat: q.stat, league: int(q.league), season: season(q.season), position: q.position || null, nationality: q.nationality || null,
      min_age: int(q.min_age), max_age: int(q.max_age), min_minutes: int(q.min_minutes), per90: q.per90 === '1', gender: q.gender === 'w' || q.gender === 'm' ? q.gender : null,
      abroad: q.abroad || null, limit: int(q.limit) ?? 50, offset: int(q.offset) ?? 0,
    }));
  });
  app.get('/api/pro/countries', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=3600').send(await pro.countries(getDb())));
  app.get<{ Params: { slug: string } }>('/api/pro/countries/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await pro.country(getDb(), req.params.slug);
    return r ? reply.header('Cache-Control', 'public, max-age=600').send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/compare', async (req, reply) => {
    const { a = '', b = '' } = req.query;
    if (!SLUG.test(a) || !SLUG.test(b)) return reply.code(400).send({ error: 'a and b must be player slugs' });
    const r = await pro.compare(getDb(), a, b);
    return r ? reply.header('Cache-Control', CACHE).send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/transfers', async (req, reply) =>
    reply.header('Cache-Control', 'public, max-age=600').send(await pro.transfersFeed(getDb(), { limit: int(req.query.limit) ?? 50, offset: int(req.query.offset) ?? 0, team: int(req.query.team) })));
  app.get<{ Querystring: Record<string, string> }>('/api/pro/college', async (req, reply) =>
    reply.header('Cache-Control', 'public, max-age=600').send(await pro.collegeHub(getDb(), { gender: req.query.gender === 'w' || req.query.gender === 'm' ? req.query.gender : null })));
  app.get<{ Params: { school: string; gender: string } }>('/api/pro/college/:school/:gender', async (req, reply) => {
    if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(req.params.school)) return reply.code(400).send({ error: 'bad school' });
    const g = req.params.gender === 'w' || req.params.gender === 'women' ? 'w' : 'm';
    return reply.header('Cache-Control', 'public, max-age=600').send({ players: await pro.collegeAlumni(getDb(), req.params.school, g) });
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
    // The crawl queue: per kind, how many tasks, how many done at least once, how many due now, requests spent.
    const tasks = await selectAll<{ kind: string; last_done_at: string | null; due_at: string; calls: number }>(db, 'pro_crawl_tasks', 'kind,last_done_at,due_at,calls');
    const nowIso = new Date().toISOString();
    const byKind: Record<string, { tasks: number; done: number; due: number; calls: number }> = {};
    for (const t of tasks) {
      const k = (byKind[t.kind] ??= { tasks: 0, done: 0, due: 0, calls: 0 });
      k.tasks += 1; if (t.last_done_at) k.done += 1; if (t.due_at <= nowIso) k.due += 1; k.calls += t.calls ?? 0;
    }
    return { quota, leagues, enabled, fixtures, finals, detailed, players, profiled, college_links: links, seasons_backfilled: seasonsDone, seasons_started: seasonsAll, crawl: byKind };
  });
}
