// JSON API behind the stats viewer. Reads are public (this is what the site itself renders); enqueueing work,
// cancelling runs and the crawl-health pages need the trigger secret. Queries run with the service role.
// Every read except the admin viewer's leaves out players under a takedown request (src/api/redact.ts). Plaibook reads
// these same routes through /v1/site (src/api/siteMirror.ts), which skips the per-visitor limit.
import { coachOnSide, refereeOnSide, sideOf } from './side.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../db/client.js';
import { enqueue, jobNames } from '../jobs/runner.js';
import * as q from './queries.js';
import { collegeElo, programElo } from './elo.js';
import { programRpi, rpiTable } from './rpi.js';
import { isBot } from '../pro/onView.js';
import { memo, memoKey } from '../pro/memo.js';
import { eastern } from '../jobs/seasons.js';
import { registerProApi } from './proApi.js';
import { adsSettings, sponsorSettings } from '../ops/settings.js';
import { currentSponsors } from '../money/config.js';
import { registerIntlApi } from './intlApi.js';
import { registerNewsApi } from '../news/queries.js';
import { follows, parseFollows } from './follows.js';
import { collegeTeamOfWeek } from '../college/teamOfWeek.js';
import { collegeFlow } from '../match/flowQueries.js';
import { simOdds, tournamentOdds } from '../college/simOdds.js';
import { collegeTableView } from '../standings/viewQueries.js';
import { icsCalendar } from '../calendar/ics.js';
import { collegeRecords } from '../college/records.js';
import { collegeTeamCompare, proTeamCompare } from '../compare/teams.js';
import { COLLEGE_REF_SORTS, collegeGameReferee, collegeReferee, collegeRefereeList } from '../referees.js';
import { redactConference, redactGame, redactPreview, visibleRankings, visibleRoster } from '../api/redact.js';

const UUID = /^[0-9a-f-]{36}$/i;

export interface UiApiOptions {
  /** True when the request carries the admin trigger secret. */
  authorized: (h: string | undefined) => boolean;
  /**
   * Rate-limits a request that is not from an admin, replying 429 itself when over the limit.
   * Returning false means the reply has already been sent.
   */
  limitAnonymous?: (req: FastifyRequest, reply: FastifyReply) => boolean | Promise<boolean>;
  /** True for a request the server made to itself for Plaibook (/v1/site): already authenticated and limited there. */
  internal?: (req: FastifyRequest) => boolean;
}

export function registerUiApi(app: FastifyInstance, opts: UiApiOptions | ((h: string | undefined) => boolean)): void {
  const { authorized, limitAnonymous, internal } = typeof opts === 'function' ? { authorized: opts, limitAnonymous: undefined, internal: undefined } : opts;
  // Admin-only paths: anything that starts work or cancels it, plus the crawl-health surfaces.
  const adminOnly = (req: FastifyRequest): boolean =>
    req.method !== 'GET' || req.url.startsWith('/api/quality') || req.url.startsWith('/api/console') || /^\/api\/runs(\/|\?|$)/.test(req.url);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    // The analytics beacon (src/server.ts) keeps its own limit and is not an API read.
    if (req.url === '/api/t') return;
    // The public corrections form (src/legal/routes.ts) keeps its own per-visitor limit.
    if (req.method === 'POST' && req.url === '/api/requests') return;
    // So does the player photo form (src/legal/photos.ts).
    if (req.method === 'POST' && req.url === '/api/photo-submissions') return;
    if (adminOnly(req)) {
      if (!authorized(req.headers.authorization)) return reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (authorized(req.headers.authorization)) return;
    if (internal?.(req)) return;
    if (limitAnonymous && !(await limitAnonymous(req, reply))) return reply;
  });
  const season = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 1990 && n < 2100 ? n : null; };
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  // The busiest college reads are the same for every visitor: cached in the process for `fresh` ms (src/pro/memo.ts:
  // a slightly older answer is served while one refresh runs, and visitors arriving together share one load). The
  // admin viewer reads fresh. Pages for one team or player are left to the browser cache (a long tail would push
  // the shared entries out).
  const shared = <T>(req: FastifyRequest, name: string, args: unknown, fresh: number, load: () => Promise<T>): Promise<T> =>
    authorized(req.headers.authorization) ? load() : memo(memoKey(`college:${name}`, args), load, { fresh, stale: fresh * 4 });
  // What the page needs to show ads and sponsors: the ad ids only while ads are on, and the sponsors running today.
  const money = async () => {
    const db = getDb();
    const [ads, sponsors] = await Promise.all([adsSettings(db), sponsorSettings(db)]);
    const today = new Date().toISOString().slice(0, 10);
    return {
      ads: ads.enabled ? ads : { enabled: false, client: null, slots: { rail: null, inline: null } },
      sponsors: currentSponsors(sponsors, today).map(({ placement, name, url, tagline }) => ({ placement, name, url, tagline })),
    };
  };
  const meta = () => memo('college:meta', () => q.meta(getDb()), { fresh: 5 * 60_000, stale: 30 * 60_000 });
  const cache = (reply: FastifyReply, seconds: number) => reply.header('Cache-Control', `public, max-age=${seconds}`);
  const admin = (req: FastifyRequest) => authorized(req.headers.authorization);
  // A conference filter must be an id: anything else was a 500 from Postgres's uuid cast.
  const badConference = (v: unknown) => v != null && v !== '' && !UUID.test(String(v));
  // The home page's Explore counts (programs this season, games, finals), five minutes old at most.
  const coverage = () => memo('college:coverage', async () => {
    const db = getDb(); const s = (await meta()).currentSeason;
    const count = async (table: string, apply: (x: any) => any) => { const { count: n, error } = await apply(db.from(table).select('*', { count: 'exact', head: true })); if (error) throw new Error(error.message); return n ?? 0; };
    const [programs, games, finals] = await Promise.all([
      count('college_program_seasons', (x) => x.eq('season', s).eq('ncaa_member', true)),
      count('college_games', (x) => x.eq('season', s)),
      count('college_games', (x) => x.eq('season', s).eq('status', 'final')),
    ]);
    return { season: s, programs, games, finals };
  }, { fresh: 5 * 60_000, stale: 30 * 60_000 }).catch(() => null);

  app.get('/api/meta', async (_req, reply) => { cache(reply, 300); return { ...(await meta()), ...(await money()), coverage: await coverage(), jobs: jobNames() }; });

  // Team and player search (the header search, pickers): every program's school, division and conference.
  app.get<{ Querystring: Record<string, string> }>('/api/search', async (req, reply) => {
    const query = String(req.query.q ?? '').trim();
    if (query.length < 2 || query.length > 60) return reply.code(400).send({ error: 'q must be 2-60 characters' });
    const gender = str(req.query.gender); if (gender && gender !== 'm' && gender !== 'w') return reply.code(400).send({ error: 'gender must be m or w' });
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    cache(reply, 120);
    return shared(req, 'search', [query.toLowerCase(), gender, limit], 120_000, () => q.search(getDb(), { q: query, gender, limit }));
  });

  // Plaibook Stats Pro (/pro pages) and International (/intl pages).
  registerProApi(app);
  registerIntlApi(app);
  // News for College, Pro and International (src/news).
  registerNewsApi(app);

  app.get<{ Querystring: Record<string, string> }>('/api/programs', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    if (badConference(req.query.conference)) return reply.code(400).send({ error: 'conference must be a uuid' });
    const f = { season: s, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference), q: str(req.query.q), members: req.query.members !== 'all' };
    cache(reply, 120);
    return shared(req, 'programs', f, 120_000, () => q.programs(getDb(), f));
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/programs/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const s = season(req.query.season) ?? (await meta()).currentSeason;
    const r = await q.program(getDb(), req.params.id, s);
    return r ? cache(reply, 60).send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/programs/:id/roster', async (req, reply) => {
    const s = season(req.query.season); if (!s || !UUID.test(req.params.id)) return reply.code(400).send({ error: 'season + id required' });
    const rows = await q.roster(getDb(), req.params.id, s);
    return cache(reply, 300).send(admin(req) ? rows : visibleRoster(rows));
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/programs/:id/games', async (req, reply) => {
    const s = season(req.query.season); if (!s || !UUID.test(req.params.id)) return reply.code(400).send({ error: 'season + id required' });
    return cache(reply, 60).send(await q.programGames(getDb(), req.params.id, s));
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
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/coaches/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'id required' });
    const r = await q.coach(getDb(), req.params.id);
    return r ? reply.header('Cache-Control', 'public, max-age=600').send(coachOnSide(r, sideOf(req.query.gender))) : reply.code(404).send({ error: 'not found' });
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
    const s = season(req.body?.season) ?? (await meta()).currentSeason;
    return reply.code(202).send(await enqueue(db, 'sync-program', { season: s, program: p.school_seo, gender: p.gender, force: !!req.body?.force }));
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    // The stored source payloads are other sites' data: only the admin viewer's Raw tab reads them.
    const r = await q.game(getDb(), req.params.id, { raw: admin(req) });
    if (!r) return reply.code(404).send({ error: 'not found' });
    return admin(req) ? r : { ...redactGame(r), raw: undefined };
  });
  // Win probability, attack momentum (src/match/flow.ts).
  app.get<{ Params: { id: string } }>('/api/games/:id/flow', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const f = await collegeFlow(getDb(), req.params.id);
    return reply.header('Cache-Control', f?.live ? 'public, max-age=20' : 'public, max-age=600').send({ flow: f });
  });
  app.get<{ Params: { id: string } }>('/api/games/:id/referee', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    return reply.header('Cache-Control', 'public, max-age=600').send({ referee: await collegeGameReferee(getDb(), req.params.id) });
  });
  // College Team of the Week (migration 189).
  app.get<{ Querystring: Record<string, string> }>('/api/team-of-the-week', async (req, reply) => {
    const r = req.query;
    const f = {
      season: season(r.season) ?? (await meta()).currentSeason,
      gender: (r.gender === 'w' ? 'w' : 'm') as 'm' | 'w',
      division: ['d1', 'd2', 'd3'].includes(r.division ?? '') ? r.division! : r.division === 'all' ? null : 'd1',
      week: /^\d{4}-\d{2}-\d{2}$/.test(r.week ?? '') ? r.week! : null,
      conference: UUID.test(r.conference ?? '') ? r.conference! : null,
    };
    return reply.header('Cache-Control', 'public, max-age=300').send({ ...(await collegeTeamOfWeek(getDb(), f)), season: f.season, division: f.division });
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/conferences/:id/table', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const s = season(req.query.season) ?? (await meta()).currentSeason;
    const view = (['all', 'home', 'away', 'form'] as const).find((v) => v === req.query.view) ?? 'home';
    return reply.header('Cache-Control', 'public, max-age=300').send(await collegeTableView(getDb(), req.params.id, s, req.query.gender === 'w' ? 'w' : 'm', view));
  });
  // A team's matches as a calendar feed (webcal subscribe or download).
  app.get<{ Params: { id: string } }>('/api/teams/:id/calendar.ics', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const db = getDb();
    const { data: p } = await db.from('college_programs').select('id,name,gender').eq('id', req.params.id).maybeSingle();
    if (!p) return reply.code(404).send({ error: 'not found' });
    const s = (await meta()).currentSeason;
    const games = await q.programGames(db, req.params.id, s);
    const base = `https://${req.headers.host ?? 'www.plaibook.live'}`;
    const ics = icsCalendar(`${(p as any).name} ${(p as any).gender === 'w' ? "women's" : "men's"} soccer`, games.filter((g: any) => g.status !== 'cancelled').map((g: any) => ({
      uid: `${g.id}@plaibook.live`, start: g.start_epoch && !q.kickoffTbd(g.start_epoch) ? new Date(g.start_epoch * 1000) : null, date: String(g.game_date).slice(0, 10),
      summary: `${g.away_name ?? '?'} at ${g.home_name ?? '?'}${g.status === 'final' && g.home_score != null ? ` (${g.away_score}-${g.home_score})` : g.status === 'postponed' ? ' (postponed)' : ''}`,
      location: [g.venue_name, g.venue_city].filter(Boolean).join(', ') || null,
      description: [g.broadcast ? `On ${g.broadcast}` : null, `${base}/matches/${g.id}`].filter(Boolean).join('\n'), url: `${base}/matches/${g.id}`,
    })));
    return reply.header('Content-Type', 'text/calendar; charset=utf-8').header('Content-Disposition', `inline; filename="${String((p as any).name).replace(/[^A-Za-z0-9]+/g, '-')}.ics"`).header('Cache-Control', 'public, max-age=3600').send(ics);
  });
  app.get<{ Querystring: Record<string, string> }>('/api/compare/teams', async (req, reply) => {
    const { a, b } = req.query;
    if (!UUID.test(a ?? '') || !UUID.test(b ?? '')) return reply.code(400).send({ error: 'a and b program ids required' });
    const s = season(req.query.season) ?? (await meta()).currentSeason;
    const r = await collegeTeamCompare(getDb(), a!, b!, s);
    return r ? reply.header('Cache-Control', 'public, max-age=300').send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/compare/teams', async (req, reply) => {
    const { a, b } = req.query;
    if (!/^[a-z0-9-]{1,160}$/.test(a ?? '') || !/^[a-z0-9-]{1,160}$/.test(b ?? '')) return reply.code(400).send({ error: 'a and b club slugs required' });
    const r = await proTeamCompare(getDb(), a!, b!);
    return r ? reply.header('Cache-Control', 'public, max-age=300').send(r) : reply.code(404).send({ error: 'not found' });
  });
  // Records and streaks.
  app.get<{ Querystring: Record<string, string> }>('/api/records', async (req, reply) => {
    const s = season(req.query.season) ?? (await meta()).currentSeason;
    const division = ['d1', 'd2', 'd3'].includes(req.query.division ?? '') ? req.query.division! : 'd1';
    const { runs, ...r } = await collegeRecords(getDb(), { season: s, gender: req.query.gender === 'w' ? 'w' : 'm', division });
    return reply.header('Cache-Control', 'public, max-age=300').send(r);
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/programs/:id/streaks', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const db = getDb();
    const s = season(req.query.season) ?? (await meta()).currentSeason;
    const [{ data: ps }, { data: p }] = await Promise.all([
      db.from('college_program_seasons').select('division').eq('program_id', req.params.id).eq('season', s).maybeSingle(),
      db.from('college_programs').select('gender').eq('id', req.params.id).maybeSingle(),
    ]);
    if (!ps || !p) return reply.send({ streaks: null });
    const r = await collegeRecords(db, { season: s, gender: (p as any).gender === 'w' ? 'w' : 'm', division: (ps as any).division });
    return reply.header('Cache-Control', 'public, max-age=300').send({ streaks: r.runs[req.params.id] ?? null, division: (ps as any).division });
  });
  // Season simulations (migration 190): the NCAA tournament page, a conference's title race, a team's chances.
  app.get<{ Querystring: Record<string, string> }>('/api/tournament', async (req, reply) => {
    const s = season(req.query.season) ?? (await meta()).currentSeason;
    const r = await tournamentOdds(getDb(), s, req.query.gender === 'w' ? 'w' : 'm');
    return reply.header('Cache-Control', 'public, max-age=300').send(r ?? { season: s, field: [], teams: [] });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/sim-odds', async (req, reply) => {
    const r = req.query;
    const conference = UUID.test(r.conference ?? '') ? r.conference! : null, program = UUID.test(r.program ?? '') ? r.program! : null;
    if (!conference && !program) return reply.code(400).send({ error: 'conference or program required' });
    const s = season(r.season) ?? (await meta()).currentSeason;
    return reply.header('Cache-Control', 'public, max-age=300').send(await simOdds(getDb(), { season: s, conference, program, gender: r.gender === 'w' || r.gender === 'm' ? r.gender : null }));
  });
  // College referees (migration 187): the list and one referee's page.
  app.get<{ Querystring: Record<string, string> }>('/api/referees', async (req, reply) => {
    const r = req.query;
    const n = (v: unknown) => { const x = Number(v); return v != null && v !== '' && Number.isInteger(x) ? x : null; };
    const f = {
      season: r.season === 'all' ? null : season(r.season) ?? (await meta()).currentSeason,
      gender: (r.gender === 'w' || r.gender === 'm' ? r.gender : null) as 'm' | 'w' | null, division: ['d1', 'd2', 'd3'].includes(r.division ?? '') ? r.division! : null,
      q: r.q ? String(r.q).trim().slice(0, 60) || null : null, min: Math.min(100, Math.max(1, n(r.min) ?? 5)),
      sort: (COLLEGE_REF_SORTS as readonly string[]).includes(r.sort ?? '') ? r.sort! : 'games',
      limit: Math.min(100, Math.max(1, n(r.limit) ?? 50)), offset: Math.max(0, n(r.offset) ?? 0),
    };
    return reply.header('Cache-Control', 'public, max-age=300').send(await collegeRefereeList(getDb(), f));
  });
  app.get<{ Params: { slug: string }; Querystring: Record<string, string> }>('/api/referees/:slug', async (req, reply) => {
    if (!/^[a-z0-9-]{2,120}$/.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await collegeReferee(getDb(), req.params.slug);
    return r ? reply.header('Cache-Control', 'public, max-age=300').send(refereeOnSide(r, sideOf(req.query.gender))) : reply.code(404).send({ error: 'not found' });
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
    if (!r || (r.player?.suppress && !admin(req))) return reply.code(404).send({ error: 'not found' });
    return cache(reply, 300).send(r);
  });

  app.get<{ Querystring: Record<string, string> }>('/api/leaders', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    if (badConference(req.query.conference)) return reply.code(400).send({ error: 'conference must be a uuid' });
    cache(reply, 300);
    const page = await shared(req, 'leaders', req.query, 300_000, () => q.leaders(getDb(), { season: s, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference), kind: str(req.query.kind), stat: str(req.query.stat), min_minutes: req.query.min_minutes, limit: req.query.limit, offset: req.query.offset, q: str(req.query.q), members: req.query.members !== 'all', position: str(req.query.position), class_year: req.query.class_year }));
    return { stats: req.query.kind === 'team' ? q.TEAM_STATS : q.PLAYER_STATS, ...page };
  });
  app.get<{ Querystring: Record<string, string> }>('/api/matches', async (req, reply) => {
    const date = str(req.query.date) ?? eastern().date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    if (req.query.conference && !UUID.test(req.query.conference)) return reply.code(400).send({ error: 'conference must be a uuid' });
    if (req.query.status && !['scheduled', 'live', 'final', 'postponed', 'cancelled'].includes(req.query.status)) return reply.code(400).send({ error: 'bad status' });
    const f = { date, days: req.query.days, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference), status: str(req.query.status), only: str(req.query.only), on_tv: req.query.on_tv === '1', network: str(req.query.network) };
    // Live scores change by the minute: today's (and yesterday's late games) short, other days longer.
    const today = eastern().date, recent = Math.abs(Date.parse(date) - Date.parse(today)) <= 86400_000;
    cache(reply, recent ? 15 : 120);
    return shared(req, 'matches', f, recent ? 15_000 : 120_000, () => q.gamesByDate(getDb(), f));
  });
  app.get<{ Params: { id: string } }>('/api/matches/:id/preview', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const r = await q.matchPreview(getDb(), req.params.id, { queue: !isBot(req.headers['user-agent']) });
    if (!r) return reply.code(404).send({ error: 'not found' });
    return admin(req) ? r : redactPreview(r);
  });
  app.get<{ Querystring: Record<string, string> }>('/api/conferences', async (req, reply) => {
    const s = season(req.query.season) ?? (await meta()).currentSeason;
    const f = { season: s, gender: str(req.query.gender), division: str(req.query.division) };
    cache(reply, 300);
    return shared(req, 'conferences', f, 300_000, () => q.conferences(getDb(), f));
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/conferences/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    const s = season(req.query.season) ?? (await meta()).currentSeason;
    const f = { season: s, gender: req.query.gender === 'w' ? 'w' as const : 'm' as const };
    const r = await shared(req, 'conference', [req.params.id, f], 120_000, () => q.conference(getDb(), req.params.id, f));
    return r ? cache(reply, 120).send(admin(req) ? r : redactConference(r)) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/standings', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    if (badConference(req.query.conference)) return reply.code(400).send({ error: 'conference must be a uuid' });
    const f = { season: s, gender: str(req.query.gender), division: str(req.query.division), conference: str(req.query.conference) };
    cache(reply, 120);
    return shared(req, 'standings', f, 120_000, () => q.standings(getDb(), f));
  });
  app.get<{ Querystring: Record<string, string> }>('/api/rankings', async (req, reply) => {
    const s = season(req.query.season); if (!s) return reply.code(400).send({ error: 'season required' });
    const f = { season: s, gender: str(req.query.gender), division: str(req.query.division), poll: str(req.query.poll), week_of: str(req.query.week_of) };
    cache(reply, 300);
    const r = await shared(req, 'rankings', f, 300_000, () => q.rankings(getDb(), f));
    return admin(req) ? r : { ...r, rows: visibleRankings(r.rows ?? []) };
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
