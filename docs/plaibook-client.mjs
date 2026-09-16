// Drop-in client for Plaibook's api/_lib: the same op names and { unavailable, note } contract as
// api/_lib/college.mjs, backed by the College Soccer API instead of direct PostgREST reads.
//
//   import { createCollegeApi } from './collegeApi.mjs';
//   export const college = createCollegeApi({ baseUrl: process.env.COLLEGE_API_URL, apiKey: process.env.COLLEGE_API_KEY });
//   const out = await college.run('college_team', { program_id, season }, ctx);
//
// Never throws: bad input, an unknown op, a network failure or any non-2xx answer come back as
// { unavailable: true, note }. Successful answers are { source: 'college', fetchedAt, ...body }.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = (note) => ({ unavailable: true, note });

const ROUTES = {
  college_search:    (a) => ['/v1/search', { q: a.q, gender: a.gender, limit: a.limit }],
  college_team:      (a) => UUID.test(a.program_id ?? '') ? [`/v1/programs/${a.program_id}`, { season: a.season }] : null,
  college_player:    (a) => UUID.test(a.player_id ?? '') ? [`/v1/players/${a.player_id}`, {}] : null,
  college_game:      (a) => UUID.test(a.game_id ?? '') ? [`/v1/games/${a.game_id}`, {}] : null,
  college_leaders:   (a) => ['/v1/leaders', { season: a.season, gender: a.gender, division: a.division, conference: a.conference_id, kind: a.kind, stat: a.stat, min_minutes: a.min_minutes, limit: a.limit }],
  college_standings: (a) => ['/v1/standings', { season: a.season, gender: a.gender, division: a.division, conference: a.conference_id }],
  college_rankings:  (a) => ['/v1/rankings', { season: a.season, gender: a.gender, division: a.division, poll: a.poll, week_of: a.week_of }],
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
      return { source: 'college', fetchedAt: new Date(now()).toISOString(), ...body };
    } catch (err) {
      return unavailable(`College API unreachable: ${err?.message || err}`);
    }
  }
  return { run, ops: Object.keys(ROUTES) };
}
