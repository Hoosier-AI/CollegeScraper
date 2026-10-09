// JSON behind the /pro pages of the site. Public reads, rate-limited by the same /api hook as the college routes
// (registerUiApi). Not part of /v1: API-Football's terms allow showing its data on our pages, not passing the raw
// data on, so pro data has no public API.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getDb, kvGet, selectAll } from '../db/client.js';
import { loadConfig } from '../config.js';
import type { QuotaState } from '../sources/apiFootball/client.js';
import { byKind, byTier, callsPerDay, etaDays, type ProgressRow, type RunCounters } from '../ops/proProgress.js';
import { schedule as cqSchedule } from '../ops/consoleQueries.js';
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

  // Owner console (behind the trigger secret, like every /api/console route): the crawl's progress for the console and the
  // PlaibookOS hub (Stats -> Pro). Counts are estimates on the big tables (exact on the small ones) so it stays cheap to poll.
  app.get('/api/console/pro', async () => {
    const db = getDb();
    const cfg = loadConfig();
    const count = (t: string, f?: (q: any) => any, mode: 'exact' | 'estimated' = 'exact') => { let q = db.from(t).select('*', { count: mode, head: true }); if (f) q = f(q); return q.then((r: { count: number | null }) => r.count ?? 0); };
    const est = (t: string, f?: (q: any) => any) => count(t, f, 'estimated');
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const [quota, progress, recent, last, sched, leagues, enabled, teams, players, profiled, fixtures, finals, detailed, provider, computed, squads, transfers, coaches, trophies, injuries, links, countries] = await Promise.all([
      kvGet<QuotaState & { saved_at?: string }>(db, PRO_QUOTA_KEY),
      db.rpc('pro_crawl_progress').then((r) => { if (r.error) throw new Error(r.error.message); return (r.data ?? []) as ProgressRow[]; }),
      selectAll<RunCounters>(db, 'college_crawl_runs', 'job,finished_at,counters', (q) => q.like('job', 'pro-%').gte('finished_at', since)),
      db.from('college_crawl_runs').select('id,job,status,created_at,started_at,finished_at,counters,error').in('job', ['pro-crawl', 'pro-plan', 'pro-rank', 'pro-scoreboard', 'pro-final-detail']).order('created_at', { ascending: false }).limit(60).then((r) => (r.data ?? []) as any[]),
      cqSchedule(db),
      count('pro_leagues'), count('pro_leagues', (q) => q.eq('enabled', true)),
      est('pro_teams'), est('pro_players'), est('pro_players', (q) => q.not('profile_synced_at', 'is', null)),
      est('pro_fixtures'), est('pro_fixtures', (q) => q.eq('status', 'final')), est('pro_fixtures', (q) => q.not('detail_fetched_at', 'is', null)),
      est('pro_player_season_stats', (q) => q.eq('source', 'provider')), est('pro_player_season_stats', (q) => q.eq('source', 'computed')),
      est('pro_squads'), est('pro_transfers'), count('pro_coaches'), est('pro_trophies'), count('pro_injuries'),
      count('pro_college_links', (q) => q.gte('confidence', 0.85).eq('rejected', false)), count('pro_countries'),
    ]);
    const perDay = callsPerDay(recent, 7);
    const kinds = byKind(progress).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const left = kinds.reduce((n, k) => n + k.calls_left, 0);
    const tasks = kinds.reduce((n, k) => n + k.tasks, 0), done = kinds.reduce((n, k) => n + k.done, 0);
    // By the end of the UTC day the crawl may spend down to its lowest floor (see ApiFootball.floor).
    const lowestFloor = cfg.PRO_EVERYDAY_PER_HOUR ? Math.min(cfg.PRO_BACKFILL_RESERVE, cfg.PRO_RESERVE + 300) : cfg.PRO_BACKFILL_RESERVE;
    const budget = Math.max(0, (quota?.limit ?? 7500) - lowestFloor);
    const lastRuns: Record<string, unknown> = {};
    for (const r of last) if (!lastRuns[r.job] && r.status !== 'queued') lastRuns[r.job] = r;
    const entry = (job: string) => sched.entries.find((e: { job: string }) => e.job === job) as { enabled: boolean; last_fired: string | null; next: string | null } | undefined;
    return {
      generated_at: new Date().toISOString(),
      quota,
      overall: { tasks, done, pct: tasks ? Math.round((done / tasks) * 1000) / 10 : 0, calls_left: left, eta_days: etaDays(left, perDay, budget) },
      pace: { calls_today: quota?.day === new Date().toISOString().slice(0, 10) ? quota.usedToday : 0, crawl_budget_today: budget, per_day: perDay, calls_7d: perDay.reduce((n, d) => n + d.calls, 0) },
      by_kind: kinds, by_tier: byTier(progress),
      tables: { leagues, enabled, countries, teams, players, profiled, fixtures, finals, detailed, season_rows_provider: provider, season_rows_computed: computed, squads, transfers, coaches, trophies, injuries, college_links: links },
      last_runs: lastRuns,
      flags: {
        key_set: !!cfg.API_FOOTBALL_KEY, blocked_until: quota?.blockedUntil ?? null, scheduler_paused: sched.paused,
        crawl_enabled: entry('pro-crawl')?.enabled ?? false, plan_enabled: entry('pro-plan')?.enabled ?? false,
        next_crawl: entry('pro-crawl')?.next ?? null, next_plan: entry('pro-plan')?.next ?? null,
      },
      // Kept for the Stats console's own Pro card (older shape).
      leagues, enabled, fixtures, finals, detailed, players, profiled, college_links: links,
    };
  });
}

/** Display order of the crawl kinds: what is crawled first, first. */
const KIND_ORDER = ['countries', 'country_teams', 'profiles_page', 'profile', 'season_fixtures', 'standings', 'league_players', 'detail', 'squad', 'transfers', 'coach', 'injuries', 'trophies'];
