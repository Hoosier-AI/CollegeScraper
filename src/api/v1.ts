// Public read API: /v1/* is open to anyone. Callers with no credentials get the free tier, limited per client IP
// and callable from any origin; a named key from COLLEGE_API_KEYS raises the limit and is restricted to the
// configured browser origins. Every route maps onto the same query helpers the viewer uses.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb, selectAll } from '../db/client.js';
import * as q from '../ui/queries.js';
import { openapiSpec } from './openapi.js';
import { anonPrincipal, bearerOf, type ApiPrincipal, type RateLimiter } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface PublicApiOptions {
  authenticate: (token: string | null) => ApiPrincipal | null;
  /** Limiter for admin and named keys. */
  limiter: RateLimiter;
  /** Limiter for the keyless free tier, bucketed per client IP. */
  anonLimiter: RateLimiter;
  corsOrigins: string[];
  /** Base URL advertised in the OpenAPI document. */
  publicUrl?: string;
  /** Address published in /v1/meta for people who need a higher limit. */
  contact?: string;
}

const seasonOf = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n > 1990 && n < 2100 ? n : null; };
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const bad = (reply: FastifyReply, message: string) => reply.code(400).send({ error: 'bad_request', message });

export function registerPublicApi(app: FastifyInstance, opts: PublicApiOptions): void {
  const origins = new Set(opts.corsOrigins.map((o) => o.replace(/\/+$/, '')));
  // Keyless responses are public data, so any origin may read them. A request that carries a key is only
  // answered for the configured origins, so a leaked key cannot be replayed from someone else's page.
  const cors = (req: FastifyRequest, reply: FastifyReply, credentialed: boolean) => {
    const origin = String(req.headers.origin ?? '').replace(/\/+$/, '');
    if (!origin) return;
    const allow = !credentialed || origins.has('*') ? '*' : origins.has(origin) ? origin : null;
    if (!allow) return;
    reply.header('Access-Control-Allow-Origin', allow);
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Headers', 'Authorization, X-Api-Key, Content-Type');
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Max-Age', '600');
  };

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return;
    const token = bearerOf(req.headers as never);
    // A preflight never carries the key itself, so ask whether the real request intends to send one.
    const credentialed = req.method === 'OPTIONS'
      ? /authorization|x-api-key/i.test(String(req.headers['access-control-request-headers'] ?? ''))
      : !!token;
    cors(req, reply, credentialed);
    if (req.method === 'OPTIONS') return reply.code(204).send();
    if (req.url.startsWith('/v1/openapi.json')) return;
    let principal: ApiPrincipal;
    if (token) {
      const named = opts.authenticate(token);
      if (!named) return reply.code(401).send({ error: 'unauthorized', message: 'That API key is not valid. Send no key at all to use the free tier.' });
      principal = named;
    } else {
      principal = anonPrincipal(req.ip);
    }
    const limiter = principal.kind === 'anon' ? opts.anonLimiter : opts.limiter;
    const r = limiter.take(principal.name);
    reply.header('X-RateLimit-Limit', String(limiter.max));
    reply.header('X-RateLimit-Remaining', String(r.remaining));
    if (!r.ok) {
      reply.header('Retry-After', String(Math.ceil(r.resetMs / 1000)));
      return reply.code(429).send({
        error: 'rate_limited',
        message: principal.kind === 'anon'
          ? `The free tier allows ${limiter.max} requests per minute per IP. An API key raises the limit.`
          : 'Too many requests for this key.',
        retry_after_seconds: Math.ceil(r.resetMs / 1000),
      });
    }
    (req as FastifyRequest & { principal?: ApiPrincipal }).principal = principal;
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/v1/') && req.method === 'GET' && reply.statusCode === 200 && !reply.getHeader('Cache-Control')) {
      const principal = (req as FastifyRequest & { principal?: ApiPrincipal }).principal;
      reply.header('Cache-Control', principal && principal.kind !== 'anon' ? 'private, max-age=60' : 'public, max-age=60');
    }
    return payload;
  });

  app.get('/v1/openapi.json', async (req) => openapiSpec(opts.publicUrl ?? `${req.protocol}://${req.headers.host}`));

  app.get('/v1/meta', async () => {
    const db = getDb();
    const [meta, runs] = await Promise.all([q.meta(db), selectAll<any>(db, 'college_crawl_runs', 'job,status,started_at,finished_at', (x) => x.eq('status', 'done').order('finished_at', { ascending: false }).limit(40))]);
    const last: Record<string, string> = {};
    for (const r of runs) if (!last[r.job]) last[r.job] = r.finished_at;
    return {
      ...meta,
      last_completed_runs: last,
      // The docs page reads its stat dictionary and limits from here so there is only one copy of either.
      player_stats: q.PLAYER_STATS,
      team_stats: q.TEAM_STATS,
      limits: { anon_per_min: opts.anonLimiter.max, key_per_min: opts.limiter.max },
      contact: opts.contact ?? null,
      generated_at: new Date().toISOString(),
    };
  });

  // Crawl health without the viewer's full quality pass (that scans every game and takes minutes): recent runs,
  // record-check counts from the standings verification, and game/final counts.
  app.get<{ Querystring: Record<string, string> }>('/v1/status', async (req) => {
    const db = getDb();
    const season = seasonOf(req.query.season) ?? (await q.meta(db)).currentSeason;
    const count = async (table: string, apply: (x: any) => any) => { const { count: n, error } = await apply(db.from(table).select('*', { count: 'exact', head: true })); if (error) throw new Error(error.message); return n ?? 0; };
    const [runs, checks, games, finals, programs] = await Promise.all([
      q.runs(db, 20),
      selectAll<{ field: string }>(db, 'college_standings_checks', 'field', (x) => x.eq('season', season)),
      count('college_games', (x) => x.eq('season', season)),
      count('college_games', (x) => x.eq('season', season).eq('status', 'final')),
      count('college_program_seasons', (x) => x.eq('season', season).eq('ncaa_member', true)),
    ]);
    const byField: Record<string, number> = {};
    for (const c of checks) byField[c.field] = (byField[c.field] ?? 0) + 1;
    return {
      season, programs, games, finals,
      record_checks: byField,
      runs: runs.map((r: any) => ({ id: r.id, job: r.job, status: r.status, started_at: r.started_at, finished_at: r.finished_at, error: r.error, counters: r.counters })),
      generated_at: new Date().toISOString(),
    };
  });

  app.get<{ Querystring: Record<string, string> }>('/v1/search', async (req, reply) => {
    const query = String(req.query.q ?? '').trim();
    if (query.length < 2 || query.length > 60) return bad(reply, 'q must be 2-60 characters');
    const gender = str(req.query.gender); if (gender && gender !== 'm' && gender !== 'w') return bad(reply, 'gender must be m or w');
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const db = getDb();
    const [programs, players] = await Promise.all([
      db.rpc('college_search_programs', { q: query, p_gender: gender ?? null, p_limit: limit }),
      db.rpc('college_search_players', { q: query, p_gender: gender ?? null, p_limit: limit }),
    ]);
    if (programs.error) throw new Error(programs.error.message);
    if (players.error) throw new Error(players.error.message);
    return { q: query, programs: programs.data ?? [], players: players.data ?? [] };
  });

  app.get<{ Querystring: Record<string, string> }>('/v1/programs', async (req, reply) => {
    const season = seasonOf(req.query.season); if (!season) return bad(reply, 'season required');
    return q.programs(getDb(), { season, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference), q: str(req.query.q), members: req.query.members !== 'all' });
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/v1/programs/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return bad(reply, 'id must be a uuid');
    const db = getDb();
    const season = seasonOf(req.query.season) ?? (await q.meta(db)).currentSeason;
    const include = new Set((str(req.query.include) ?? 'roster,games').split(',').map((s) => s.trim()));
    const [team, roster, games] = await Promise.all([
      q.program(db, req.params.id, season),
      include.has('roster') ? q.roster(db, req.params.id, season) : Promise.resolve(undefined),
      include.has('games') ? q.programGames(db, req.params.id, season) : Promise.resolve(undefined),
    ]);
    if (!team) return reply.code(404).send({ error: 'not_found' });
    return { ...team, season_year: season, roster, games };
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/v1/programs/:id/roster', async (req, reply) => {
    if (!UUID.test(req.params.id)) return bad(reply, 'id must be a uuid');
    const season = seasonOf(req.query.season); if (!season) return bad(reply, 'season required');
    return q.roster(getDb(), req.params.id, season);
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/v1/programs/:id/games', async (req, reply) => {
    if (!UUID.test(req.params.id)) return bad(reply, 'id must be a uuid');
    const season = seasonOf(req.query.season); if (!season) return bad(reply, 'season required');
    return q.programGames(getDb(), req.params.id, season);
  });

  app.get<{ Params: { id: string } }>('/v1/players/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return bad(reply, 'id must be a uuid');
    const r = await q.player(getDb(), req.params.id);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.player?.suppress) return reply.code(404).send({ error: 'not_found', message: 'This player profile is unavailable.' });
    return r;
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/v1/games/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return bad(reply, 'id must be a uuid');
    const r = await q.game(getDb(), req.params.id);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (!(str(req.query.include) ?? '').split(',').includes('raw')) return { ...r, raw: undefined };
    return r;
  });

  app.get<{ Querystring: Record<string, string> }>('/v1/leaders', async (req, reply) => {
    const season = seasonOf(req.query.season); if (!season) return bad(reply, 'season required');
    const kind = req.query.kind === 'team' ? 'team' : 'player';
    const allowed = kind === 'team' ? q.TEAM_STATS : q.PLAYER_STATS;
    if (req.query.stat && !allowed.includes(req.query.stat)) return bad(reply, `stat must be one of: ${allowed.join(', ')}`);
    const rows = await q.leaders(getDb(), { season, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference), kind, stat: str(req.query.stat), min_minutes: req.query.min_minutes, limit: req.query.limit, members: req.query.members !== 'all' });
    return { kind, stat: req.query.stat ?? (kind === 'team' ? 'w' : 'goals'), stats: allowed, rows };
  });

  app.get<{ Querystring: Record<string, string> }>('/v1/standings', async (req, reply) => {
    const season = seasonOf(req.query.season); if (!season) return bad(reply, 'season required');
    const r = await q.standings(getDb(), { season, gender: str(req.query.gender), division: str(req.query.division) });
    const conf = str(req.query.conference);
    const groups = new Map<string, { conference: unknown; source: string; source_url: string | null; rows: any[] }>();
    for (const row of r.rows) {
      if (conf && row.conference_id !== conf) continue;
      const key = row.conference_id ?? 'independent';
      if (!groups.has(key)) groups.set(key, { conference: row.college_conferences ?? { id: null, name: 'Independent' }, source: row.source, source_url: row.source_url ?? null, rows: [] });
      const { college_conferences: _c, ...rest } = row;
      groups.get(key)!.rows.push(rest);
    }
    return { season, source: r.source, official: r.official, computed: r.computed, conferences: [...groups.values()] };
  });

  app.get<{ Querystring: Record<string, string> }>('/v1/rankings', async (req, reply) => {
    const season = seasonOf(req.query.season); if (!season) return bad(reply, 'season required');
    if (req.query.week_of && !DATE.test(req.query.week_of)) return bad(reply, 'week_of must be YYYY-MM-DD');
    return q.rankings(getDb(), { season, gender: str(req.query.gender), division: str(req.query.division), poll: str(req.query.poll), week_of: str(req.query.week_of) });
  });
}
