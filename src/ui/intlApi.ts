// JSON behind the International pages (/intl): national-team football. The lists differ from Pro's (tournaments by
// confederation, nations, the international scoreboard and leaders); a tournament, nation, player or match page reads
// the same /api/pro/:kind/:slug routes as Pro. Same terms as Pro: shown on our pages, no public API (/v1 stays college).
import { intlHomeOnSide, matchesOnSide, sideOf } from './side.js';
import { isMinor } from '../pro/minor.js';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';
import * as pro from '../pro/queries.js';
import { memo, memoKey } from '../pro/memo.js';
import * as intl from '../pro/intl.js';
import { eastern } from '../jobs/seasons.js';
import { intlConsole } from '../ops/intlConsole.js';
import { SLUG } from '../seo/util.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE = 'public, max-age=30';
const season = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 1900 && n < 2100 ? n : null; };
const int = (v: unknown) => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) ? n : null; };
const level = (v: unknown) => (v === 'youth' || v === 'senior' ? v : null);

export function registerIntlApi(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>('/api/intl/home', async (req, reply) => {
    const date = req.query.date && DATE.test(req.query.date) ? req.query.date : eastern().date;
    return reply.header('Cache-Control', CACHE).send(intlHomeOnSide(await intl.home(getDb(), date), sideOf(req.query.gender)));
  });
  app.get<{ Querystring: Record<string, string> }>('/api/intl/matches', async (req, reply) => {
    const date = req.query.date ?? eastern().date;
    if (!DATE.test(date)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    if (req.query.status && !['scheduled', 'live', 'final', 'postponed', 'cancelled', 'abandoned'].includes(req.query.status)) return reply.code(400).send({ error: 'bad status' });
    const league = int(req.query.league);
    return reply.header('Cache-Control', CACHE).send(matchesOnSide(await pro.matchesByDate(getDb(), { date, league, status: req.query.status ?? null, featured: req.query.featured === '1', scope: 'intl' }), sideOf(req.query.gender)));
  });
  // An empty day's neighbours: the next match day and the last one, as scoreboards (one game: ?gender=m|w).
  app.get<{ Querystring: Record<string, string> }>('/api/intl/around', async (req, reply) => {
    const date = req.query.date ?? eastern().date;
    if (!DATE.test(date)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    const gender = req.query.gender === 'w' ? 'w' : 'm';
    const db = getDb();
    const [next, prev] = await Promise.all([intl.adjacentDay(db, date, gender, 'next'), intl.adjacentDay(db, date, gender, 'prev')]);
    return reply.header('Cache-Control', 'public, max-age=120').send({ date, gender, next, prev });
  });
  app.get('/api/intl/tournaments', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=300').send(await intl.tournaments(getDb())));
  app.get('/api/intl/nations', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=600').send(await intl.nations(getDb())));
  app.get<{ Querystring: Record<string, string> }>('/api/intl/search', async (req, reply) =>
    reply.header('Cache-Control', 'public, max-age=60').send(await pro.search(getDb(), String(req.query.q ?? ''), Math.min(20, Number(req.query.limit) || 8), 'intl', sideOf(req.query.gender))));
  // International leaders and the player directory: pro_leaders over national-team competitions.
  app.get<{ Querystring: Record<string, string> }>('/api/intl/team-leaders', async (req, reply) => {
    const q = req.query;
    const f: pro.TeamLeadersFilter = { stat: q.stat, scope: 'intl', gender: q.gender === 'w' ? 'w' : 'm', league: int(q.league), level: level(q.level), limit: int(q.limit) ?? 50, offset: int(q.offset) ?? 0 };
    return reply.header('Cache-Control', 'public, max-age=300').send(await memo(memoKey('team-leaders', f), () => pro.teamLeaders(getDb(), f)));
  });
  app.get<{ Querystring: Record<string, string> }>('/api/intl/leaders', async (req, reply) => {
    const q = req.query;
    if (q.position && !(pro.POSITIONS as readonly string[]).includes(q.position)) return reply.code(400).send({ error: 'bad position' });
    const f: pro.LeadersFilter = {
      stat: q.stat, league: int(q.league), season: season(q.season), position: q.position || null, nationality: q.nationality || null,
      min_age: int(q.min_age), max_age: int(q.max_age), min_minutes: int(q.min_minutes), per90: q.per90 === '1', gender: q.gender === 'w' || q.gender === 'm' ? q.gender : null,
      limit: int(q.limit) ?? 50, offset: int(q.offset) ?? 0, scope: 'intl', level: level(q.level),
    };
    return reply.header('Cache-Control', 'public, max-age=300').send(await memo(memoKey('leaders', f), () => pro.leaders(getDb(), f)));
  });

  // A nation's history (open sources): its address is its senior side's slug, or the nation's key when the provider
  // never had it (Yugoslavia). ?gender= for a nation addressed by key.
  app.get<{ Params: { slug: string }; Querystring: Record<string, string> }>('/api/intl/teams/:slug/history', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const db = getDb();
    const n = await intl.nationOf(db, req.params.slug);
    if (!n) return reply.code(404).send({ error: 'not found' });
    const gender = n.team_id == null && req.query.gender === 'w' ? 'w' : n.gender;
    const h = await intl.nationHistory(db, n.key, gender);
    return h ? reply.header('Cache-Control', 'public, max-age=600').send(h) : reply.code(404).send({ error: 'not found' });
  });
  // A nation's every Elo move with its reasons, its world ranks and its moments (the Elo chart).
  app.get<{ Params: { slug: string }; Querystring: Record<string, string> }>('/api/intl/teams/:slug/elo', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const db = getDb();
    const n = await intl.nationOf(db, req.params.slug);
    if (!n) return reply.code(404).send({ error: 'not found' });
    const r = await intl.eloSeries(db, n.key, n.team_id == null && req.query.gender === 'w' ? 'w' : n.gender);
    return r ? reply.header('Cache-Control', 'public, max-age=600').send(r) : reply.code(404).send({ error: 'not found' });
  });
  // An international match's Plaibook Elo: the chances before kickoff, each side's move once played.
  app.get<{ Params: { slug: string } }>('/api/intl/matches/:slug/elo', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await intl.matchElo(getDb(), req.params.slug);
    return r ? reply.header('Cache-Control', 'public, max-age=120').send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/intl/rankings', async (req, reply) =>
    reply.header('Cache-Control', 'public, max-age=600').send(await intl.rankings(getDb(), req.query.gender === 'w' ? 'w' : 'm')));
  app.get<{ Querystring: Record<string, string> }>('/api/intl/h2h', async (req, reply) => {
    const { a = '', b = '' } = req.query;
    if (!SLUG.test(a) || !SLUG.test(b)) return reply.code(400).send({ error: 'a and b must be team addresses' });
    const db = getDb();
    const [x, y] = await Promise.all([intl.nationOf(db, a), intl.nationOf(db, b)]);
    if (!x || !y) return reply.code(404).send({ error: 'not found' });
    return reply.header('Cache-Control', 'public, max-age=600').send(await intl.headToHead(db, x.key, y.key, x.team_id != null ? x.gender : y.gender));
  });
  app.get<{ Params: { slug: string } }>('/api/intl/players/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const db = getDb();
    const { data } = await db.from('pro_players').select('id,birth_date').eq('slug', req.params.slug).maybeSingle();
    // Under 18: no international career page either (src/pro/minor.ts).
    const id = isMinor((data as { birth_date?: string | null } | null)?.birth_date) ? undefined : (data as { id?: number } | null)?.id;
    return id == null ? reply.code(404).send({ error: 'not found' }) : reply.header('Cache-Control', 'public, max-age=600').send(await intl.playerInternational(db, id));
  });

  // Owner console (behind the trigger secret like every /api/console route): the hub's Stats -> International.
  app.get('/api/console/intl', async () => intlConsole(getDb()));
}
