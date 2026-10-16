// Drop-in client for Plaibook's api/_lib: the same op names and { unavailable, note } contract as
// api/_lib/college.mjs, backed by the College Soccer API instead of direct PostgREST reads.
//
//   import { createCollegeApi } from './collegeApi.mjs';
//   export const college = createCollegeApi({ baseUrl: process.env.COLLEGE_API_URL, apiKey: process.env.COLLEGE_API_KEY });
//   const out = await college.run('college_team', { program_id, season }, ctx);
//
// Never throws: bad input, an unknown op, a network failure or any non-2xx answer come back as
// { unavailable: true, note }. Successful answers are { source: 'college', fetchedAt, ...body }; a route that
// answers with a JSON array (/v1/programs) comes back as { source, fetchedAt, rows }.
//
// Everything else the Stats site shows (college, pro, international, news) is read with site(path, query, opts):
//
//   const out = await college.site('/api/programs/<id>/elo', {}, { view: true });
//
// It goes to /v1/site/* (the service runs its own GET /api/<path> and returns the answer). SITE_ROUTES below is every
// route Plaibook may ask for; the service's tests/api/site-parity.test.ts fails when the site gains a route that is in
// neither this list nor its SITE_EXCLUDED, and Plaibook's tests/college-client-sync.test.mjs fails until this file is
// copied again. Answers: { source: 'stats', fetchedAt, route, maxAge, ...body } (arrays as rows, a calendar or other non-JSON
// body as { text, contentType }); a non-2xx is { unavailable, note, status } (+ moved, a renamed pro/intl slug).

/**
 * Every site read Plaibook may make, as the service registers it. `area` is the part of the site it belongs to (news
 * follows its ?scope=). `gender` says how a men's / women's club is kept to its side:
 *   'none'               the route has no side, or only reaches one through an id already checked elsewhere
 *   'query'              it takes ?gender=m|w (college: always the club's; pro/intl: the club's unless asked)
 *   'path:<param>'       the side is a path parameter
 *   'program:<param>'    a college program id (path parameter or query key) whose side must be the club's
 *   'result:<a.b|c.d>'   the answer says its side at the first of these paths that has one
 */
export const SITE_ROUTES = [
  // College
  { path: '/api/meta', area: 'college', gender: 'none' },
  { path: '/api/search', area: 'college', gender: 'query' },
  { path: '/api/resolve', area: 'college', gender: 'none' },
  { path: '/api/follows', area: 'college', gender: 'none' },
  { path: '/api/programs', area: 'college', gender: 'query' },
  { path: '/api/programs/:id', area: 'college', gender: 'result:program.gender' },
  { path: '/api/programs/:id/roster', area: 'college', gender: 'program:id' },
  { path: '/api/programs/:id/games', area: 'college', gender: 'program:id' },
  { path: '/api/programs/:id/elo', area: 'college', gender: 'program:id' },
  { path: '/api/programs/:id/rpi', area: 'college', gender: 'program:id' },
  { path: '/api/programs/:id/periods', area: 'college', gender: 'program:id' },
  { path: '/api/programs/:id/streaks', area: 'college', gender: 'program:id' },
  { path: '/api/teams/:id/calendar.ics', area: 'college', gender: 'program:id' },
  { path: '/api/players/:id', area: 'college', gender: 'result:player.gender|seasons.0.program.gender' },
  { path: '/api/games/:id', area: 'college', gender: 'result:game.gender' },
  { path: '/api/games/:id/flow', area: 'college', gender: 'none' },
  { path: '/api/games/:id/referee', area: 'college', gender: 'none' },
  { path: '/api/matches', area: 'college', gender: 'query' },
  { path: '/api/matches/:id/preview', area: 'college', gender: 'result:game.gender' },
  { path: '/api/leaders', area: 'college', gender: 'query' },
  { path: '/api/standings', area: 'college', gender: 'query' },
  { path: '/api/rankings', area: 'college', gender: 'query' },
  { path: '/api/conferences', area: 'college', gender: 'query' },
  { path: '/api/conferences/:id', area: 'college', gender: 'query' },
  { path: '/api/conferences/:id/table', area: 'college', gender: 'query' },
  { path: '/api/elo', area: 'college', gender: 'query' },
  { path: '/api/rpi', area: 'college', gender: 'query' },
  { path: '/api/sim-odds', area: 'college', gender: 'query' },
  { path: '/api/tournament', area: 'college', gender: 'query' },
  { path: '/api/records', area: 'college', gender: 'query' },
  { path: '/api/team-of-the-week', area: 'college', gender: 'query' },
  { path: '/api/transfers', area: 'college', gender: 'query' },
  { path: '/api/referees', area: 'college', gender: 'query' },
  { path: '/api/referees/:slug', area: 'college', gender: 'none' },
  { path: '/api/coaches/:id', area: 'college', gender: 'none' },
  { path: '/api/h2h', area: 'college', gender: 'program:a' },
  { path: '/api/compare/teams', area: 'college', gender: 'program:a' },
  // News (all three areas; ?scope=college|pro|international)
  { path: '/api/news', area: 'news', gender: 'query' },
  // Pro
  { path: '/api/pro/home', area: 'pro', gender: 'none' },
  { path: '/api/pro/matches', area: 'pro', gender: 'none' },
  { path: '/api/pro/matches/:slug', area: 'pro', gender: 'none' },
  { path: '/api/pro/fixtures/:id/flow', area: 'pro', gender: 'none' },
  { path: '/api/pro/fixtures/:id/referee', area: 'pro', gender: 'none' },
  { path: '/api/pro/leagues', area: 'pro', gender: 'none' },
  { path: '/api/pro/leagues/:slug', area: 'pro', gender: 'none' },
  { path: '/api/pro/leagues/:id/table', area: 'pro', gender: 'none' },
  { path: '/api/pro/leagues/:id/team-of-week', area: 'pro', gender: 'none' },
  { path: '/api/pro/teams', area: 'pro', gender: 'query' },
  { path: '/api/pro/teams/:slug', area: 'pro', gender: 'none' },
  { path: '/api/pro/teams/:slug/extras', area: 'pro', gender: 'none' },
  { path: '/api/pro/teams/:slug/calendar.ics', area: 'pro', gender: 'none' },
  { path: '/api/pro/players/:slug', area: 'pro', gender: 'none' },
  { path: '/api/pro/leaders', area: 'pro', gender: 'query' },
  { path: '/api/pro/team-leaders', area: 'pro', gender: 'query' },
  { path: '/api/pro/rankings', area: 'pro', gender: 'query' },
  { path: '/api/pro/search', area: 'pro', gender: 'none' },
  { path: '/api/pro/compare', area: 'pro', gender: 'none' },
  { path: '/api/pro/compare/teams', area: 'pro', gender: 'none' },
  { path: '/api/pro/h2h', area: 'pro', gender: 'none' },
  { path: '/api/pro/transfers', area: 'pro', gender: 'none' },
  { path: '/api/pro/americans-abroad', area: 'pro', gender: 'query' },
  { path: '/api/pro/college', area: 'pro', gender: 'query' },
  { path: '/api/pro/college/:school/:gender', area: 'pro', gender: 'path:gender' },
  { path: '/api/pro/from-college/:id', area: 'pro', gender: 'none' },
  { path: '/api/pro/countries', area: 'pro', gender: 'none' },
  { path: '/api/pro/countries/:slug', area: 'pro', gender: 'query' },
  { path: '/api/pro/referees', area: 'pro', gender: 'query' },
  { path: '/api/pro/referees/:slug', area: 'pro', gender: 'none' },
  { path: '/api/pro/coaches/:id', area: 'pro', gender: 'none' },
  // International (a tournament, nation, player or match page also reads the /api/pro routes above)
  { path: '/api/intl/home', area: 'intl', gender: 'none' },
  { path: '/api/intl/matches', area: 'intl', gender: 'none' },
  { path: '/api/intl/around', area: 'intl', gender: 'query' },
  { path: '/api/intl/tournaments', area: 'intl', gender: 'none' },
  { path: '/api/intl/nations', area: 'intl', gender: 'none' },
  { path: '/api/intl/search', area: 'intl', gender: 'none' },
  { path: '/api/intl/leaders', area: 'intl', gender: 'query' },
  { path: '/api/intl/team-leaders', area: 'intl', gender: 'query' },
  { path: '/api/intl/rankings', area: 'intl', gender: 'query' },
  { path: '/api/intl/h2h', area: 'intl', gender: 'none' },
  { path: '/api/intl/teams/:slug/history', area: 'intl', gender: 'query' },
  { path: '/api/intl/teams/:slug/elo', area: 'intl', gender: 'query' },
  { path: '/api/intl/matches/:slug/elo', area: 'intl', gender: 'none' },
  { path: '/api/intl/players/:slug', area: 'intl', gender: 'none' },
];

const SEGMENT = /^[A-Za-z0-9._~@%:-]{1,200}$/;
const QUERY_KEY = /^[a-z_]{1,24}$/;
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ROUTE_RES = SITE_ROUTES.map((r) => ({ ...r, re: new RegExp(`^${r.path.split('/').map((seg) => (seg.startsWith(':') ? '([^/]+)' : escapeRe(seg))).join('/')}$`), names: r.path.split('/').filter((seg) => seg.startsWith(':')).map((seg) => seg.slice(1)), params: (r.path.match(/:/g) || []).length }));

/** The SITE_ROUTES entry a concrete path is served by, with its path parameters, or null. Static segments win. */
export function matchSiteRoute(path) {
  // '/api/programs/x', 'api/programs/x' and 'programs/x' are the same route.
  const p = `/${String(path ?? '').replace(/^\/+/, '').replace(/^(?!api\/)/, 'api/')}`;
  if (p.includes('..') || !p.split('/').slice(1).every((seg) => SEGMENT.test(seg))) return null;
  const hits = ROUTE_RES.filter((r) => r.re.test(p)).sort((a, b) => a.params - b.params);
  const hit = hits[0];
  if (!hit) return null;
  const m = p.match(hit.re);
  const params = Object.fromEntries(hit.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
  return { path: hit.path, area: hit.area, gender: hit.gender, url: p, params };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = (note) => ({ unavailable: true, note });

const ROUTES = {
  college_search:    (a) => ['/v1/search', { q: a.q, gender: a.gender, limit: a.limit }],
  college_team:      (a) => UUID.test(a.program_id ?? '') ? [`/v1/programs/${a.program_id}`, { season: a.season, include: a.include }] : null,
  college_player:    (a) => UUID.test(a.player_id ?? '') ? [`/v1/players/${a.player_id}`, {}] : null,
  college_game:      (a) => UUID.test(a.game_id ?? '') ? [`/v1/games/${a.game_id}`, {}] : null,
  college_leaders:   (a) => ['/v1/leaders', { season: a.season, gender: a.gender, division: a.division, conference: a.conference_id, kind: a.kind, stat: a.stat, min_minutes: a.min_minutes, limit: a.limit, offset: a.offset, q: a.q, position: a.position, class_year: a.class_year }],
  college_standings: (a) => ['/v1/standings', { season: a.season, gender: a.gender, division: a.division, conference: a.conference_id }],
  college_rankings:  (a) => ['/v1/rankings', { season: a.season, gender: a.gender, division: a.division, poll: a.poll, week_of: a.week_of }],
  college_matches:   (a) => ['/v1/matches', { date: a.date, days: a.days, gender: a.gender, division: a.division, conference: a.conference_id, status: a.status, only: a.only }],
  college_match:     (a) => [`/v1/matches/${a.match_id ?? a.game_id}/preview`, {}],
  college_conferences: (a) => ['/v1/conferences', { season: a.season, gender: a.gender, division: a.division }],
  college_conference:  (a) => [`/v1/conferences/${a.conference_id}`, { season: a.season, gender: a.gender }],
  college_programs:  (a) => ['/v1/programs', { season: a.season, gender: a.gender, division: a.division, conference: a.conference_id, q: a.q }],
  college_status:    (a) => ['/v1/status', { season: a.season }],
  college_meta:      () => ['/v1/meta', {}],
};

export function createCollegeApi({ baseUrl, apiKey, fetcher = fetch, timeoutMs = 8000, now = () => Date.now() } = {}) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  async function run(op, args = {}, _ctx) {
    if (!base || !apiKey) return unavailable('College API is not configured (COLLEGE_API_URL / COLLEGE_API_KEY).');
    const route = ROUTES[op];
    if (!route) return unavailable('Unknown college data operation.');
    const target = route(args && typeof args === 'object' ? args : {});
    if (!target) return unavailable('Invalid id.');
    const [path, params] = target;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const url = `${base}${path}${qs.size ? `?${qs}` : ''}`;
    try {
      const r = await fetcher(url, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      const body = await r.json().catch(() => null);
      if (!r.ok) return unavailable(body?.message || body?.error || `College API ${r.status}`);
      // A 200 that is not JSON (a proxy error page, a cold-start splash) is not an empty success.
      if (body === null || typeof body !== 'object') return unavailable('College API returned an unreadable response.');
      const stamp = { source: 'college', fetchedAt: new Date(now()).toISOString() };
      // Spreading an array would turn it into { "0": …, "1": … }.
      return Array.isArray(body) ? { ...stamp, rows: body } : { ...stamp, ...body };
    } catch (err) {
      return unavailable(`College API unreachable: ${err?.message || err}`);
    }
  }
  /** Any SITE_ROUTES read: path like '/api/programs/<id>/elo', query an object of strings, view true for a coach
   *  opening a page (pro pages may fetch fresh detail for a view, as they do for a site visitor). */
  async function site(path, query = {}, { view = false } = {}) {
    if (!base || !apiKey) return unavailable('Stats API is not configured (COLLEGE_API_URL / COLLEGE_API_KEY).');
    const hit = matchSiteRoute(path);
    if (!hit) return unavailable('Unknown stats route.');
    const qs = new URLSearchParams();
    const entries = Object.entries(query && typeof query === 'object' ? query : {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (entries.length > 20) return unavailable('Too many query parameters.');
    for (const [k, v] of entries) {
      if (!QUERY_KEY.test(k) || String(v).length > 200) return unavailable(`Bad query parameter: ${k}`);
      qs.set(k, String(v));
    }
    const url = `${base}/v1/site${hit.url.slice(4)}${qs.size ? `?${qs}` : ''}`;
    try {
      const headers = { 'X-Api-Key': apiKey, Accept: 'application/json' };
      if (view) headers['x-plaibook-view'] = '1';
      const r = await fetcher(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      const type = String(r.headers?.get?.('content-type') ?? '');
      const text = await r.text().catch(() => '');
      let body = null;
      if (/json/i.test(type) || /^\s*[[{]/.test(text)) { try { body = JSON.parse(text); } catch { body = null; } }
      if (!r.ok) return { ...unavailable(body?.message || body?.error || `Stats API ${r.status}`), status: r.status, ...(body?.moved ? { moved: body.moved } : {}) };
      // maxAge: how long the service says this answer stays fresh (its Cache-Control), for the caller's own cache.
      const age = String(r.headers?.get?.('cache-control') ?? '').match(/max-age=(\d+)/);
      const stamp = { source: 'stats', fetchedAt: new Date(now()).toISOString(), route: hit.path, maxAge: age ? Number(age[1]) : null };
      if (body === null) return text ? { ...stamp, text, contentType: type || 'text/plain' } : unavailable('Stats API returned an empty response.');
      if (typeof body !== 'object') return { ...stamp, value: body };
      return Array.isArray(body) ? { ...stamp, rows: body } : { ...stamp, ...body };
    } catch (err) {
      return unavailable(`Stats API unreachable: ${err?.message || err}`);
    }
  }
  return { run, site, ops: Object.keys(ROUTES) };
}
