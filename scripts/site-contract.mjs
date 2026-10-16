// Every site read Plaibook can make, against a running service: each SITE_ROUTES entry (docs/plaibook-client.mjs)
// is called through the Plaibook client's site() with real ids found on the way (Duke, an MLS club and player, the
// USA national team), and checked for a 2xx, no source payloads, and no 5xx. Also: /v1/site needs a key, admin
// paths are not reachable. Read-only.
//
//   STATS_URL=https://www.plaibook.live STATS_KEY=<plaibook key> node scripts/site-contract.mjs
import { createCollegeApi, SITE_ROUTES } from '../docs/plaibook-client.mjs';

const base = process.env.STATS_URL ?? 'http://localhost:8787';
const key = process.env.STATS_KEY ?? process.env.PLAIBOOK_API_KEY;
if (!key) { console.error('STATS_KEY is required'); process.exit(2); }
const api = createCollegeApi({ baseUrl: base, apiKey: key, timeoutMs: 45_000 });

const results = [];
async function call(path, query = {}) {
  const t = Date.now();
  const r = await api.site(path, query);
  const ms = Date.now() - t;
  const size = JSON.stringify(r).length;
  results.push({ path, query, ok: !r.unavailable, status: r.status ?? 200, ms, size, note: r.unavailable ? r.note : null, route: r.route ?? null, raw: Array.isArray(r.raw) && r.raw.length > 0 });
  return r;
}
const first = (xs) => (Array.isArray(xs) ? xs[0] : undefined);

// College ids.
const meta = await call('/api/meta');
const season = meta.currentSeason;
const search = await call('/api/search', { q: 'duke', gender: 'm' });
const duke = (search.programs ?? []).find((p) => p.school_seo === 'duke' && p.gender === 'm') ?? first(search.programs);
const P = duke?.program_id, CONF = duke?.conference?.id;
const team = await call(`/api/programs/${P}`, { season });
const coach = (team.coaches ?? []).map((c) => c.college_coaches?.id).find(Boolean);
const roster = await call(`/api/programs/${P}/roster`, { season });
const playerId = (roster.rows ?? []).map((r) => r.player?.id ?? r.player_id).find(Boolean);
const games = await call(`/api/programs/${P}/games`, { season });
const fin = (games.rows ?? []).filter((g) => g.status === 'final').at(-1);
const G = fin?.id, OPP = fin ? (fin.home_program_id === P ? fin.away_program_id : fin.home_program_id) : null;
const refs = await call('/api/referees', { season, gender: 'm' });
const refSlug = first(refs.rows ?? refs.referees)?.slug;

await call('/api/resolve', { kind: 'team', key: 'duke/men' });
await call('/api/follows', { f: `team:${P}` });
await call('/api/programs', { season, gender: 'm', division: 'd1' });
for (const sub of ['elo', 'periods', 'streaks']) await call(`/api/programs/${P}/${sub}`, { season });
await call(`/api/programs/${P}/rpi`, { season });
await call(`/api/teams/${P}/calendar.ics`);
if (playerId) await call(`/api/players/${playerId}`);
if (G) { await call(`/api/games/${G}`); await call(`/api/games/${G}/flow`); await call(`/api/games/${G}/referee`); await call(`/api/matches/${G}/preview`); }
await call('/api/matches', { gender: 'm' });
await call('/api/leaders', { season, gender: 'm', division: 'd1', stat: 'goals', limit: 5 });
await call('/api/standings', { season, gender: 'm', division: 'd1' });
await call('/api/rankings', { season, gender: 'm', division: 'd1' });
await call('/api/conferences', { season, gender: 'm', division: 'd1' });
if (CONF) { await call(`/api/conferences/${CONF}`, { season, gender: 'm' }); await call(`/api/conferences/${CONF}/table`, { season, gender: 'm', view: 'form' }); await call('/api/sim-odds', { conference: CONF, season, gender: 'm' }); }
await call('/api/elo', { gender: 'm', division: 'd1', limit: 10 });
await call('/api/rpi', { gender: 'm', division: 'd1', limit: 10 });
await call('/api/tournament', { season, gender: 'm' });
await call('/api/records', { season, gender: 'm', division: 'd1' });
await call('/api/team-of-the-week', { season, gender: 'm', division: 'd1' });
await call('/api/transfers', { season, gender: 'm', limit: 5 });
if (refSlug) await call(`/api/referees/${refSlug}`);
if (coach) await call(`/api/coaches/${coach}`);
if (OPP) { await call('/api/h2h', { a: P, b: OPP }); await call('/api/compare/teams', { a: P, b: OPP, season }); }
for (const scope of ['college', 'pro', 'international']) await call('/api/news', { scope, limit: 5 });

// Pro ids.
const proHome = await call('/api/pro/home');
const leagues = await call('/api/pro/leagues');
const allLeagues = leagues.rows ?? [];
const mls = allLeagues.find((l) => l.id === 253) ?? first(allLeagues);
const league = mls ? await call(`/api/pro/leagues/${mls.slug}`) : null;
const leagueId = league?.league?.id ?? mls?.id;
if (leagueId) { await call(`/api/pro/leagues/${leagueId}/table`, { season: league?.season, view: 'home' }); await call(`/api/pro/leagues/${leagueId}/team-of-week`, { season: league?.season }); }
const proSearch = await call('/api/pro/search', { q: 'seattle sounders' });
const clubSlug = first(proSearch.teams)?.slug;
const club = clubSlug ? await call(`/api/pro/teams/${clubSlug}`) : null;
if (clubSlug) { await call(`/api/pro/teams/${clubSlug}/extras`); await call(`/api/pro/teams/${clubSlug}/calendar.ics`); }
const pulisic = first((await call('/api/pro/search', { q: 'pulisic' })).players)?.slug;
if (pulisic) await call(`/api/pro/players/${pulisic}`);
const proMatches = await call('/api/pro/matches');
const anyMatch = [proHome, proMatches].flatMap((x) => JSON.stringify(x).match(/"slug":"[a-z0-9-]+-vs-[a-z0-9-]+[^"]*"/g) ?? []).map((s) => s.slice(8, -1))[0];
const match = anyMatch ? await call(`/api/pro/matches/${anyMatch}`) : null;
const fixtureId = match?.fixture?.id ?? match?.match?.id ?? match?.id;
if (fixtureId) { await call(`/api/pro/fixtures/${fixtureId}/flow`); await call(`/api/pro/fixtures/${fixtureId}/referee`); }
await call('/api/pro/leaders', { stat: 'goals' });
await call('/api/pro/team-leaders', { stat: 'points' });
await call('/api/pro/rankings');
await call('/api/pro/teams');
await call('/api/pro/transfers');
await call('/api/pro/americans-abroad');
await call('/api/pro/college');
await call('/api/pro/college/duke/m');
if (playerId) await call(`/api/pro/from-college/${playerId}`);
const countries = await call('/api/pro/countries');
const country = first(countries.rows ?? countries.countries)?.slug ?? 'usa';
await call(`/api/pro/countries/${country}`);
const proRefs = await call('/api/pro/referees');
const proRef = first(proRefs.rows ?? proRefs.referees)?.slug;
if (proRef) await call(`/api/pro/referees/${proRef}`);
const proCoach = (club?.coaches ?? []).map((c) => c.id ?? c.coach_id).find(Boolean);
if (proCoach) await call(`/api/pro/coaches/${proCoach}`);
const other = (proSearch.teams ?? [])[1]?.slug ?? first((await call('/api/pro/search', { q: 'portland timbers' })).teams)?.slug;
if (clubSlug && other) { await call('/api/pro/h2h', { a: clubSlug, b: other }); await call('/api/pro/compare/teams', { a: clubSlug, b: other }); }
const other2 = first((await call('/api/pro/search', { q: 'weston mckennie' })).players)?.slug;
if (pulisic && other2) await call('/api/pro/compare', { a: pulisic, b: other2 });

// International ids.
const intlHome = await call('/api/intl/home');
await call('/api/intl/matches');
await call('/api/intl/around', { date: new Date().toISOString().slice(0, 10), gender: 'm' });
await call('/api/intl/tournaments');
await call('/api/intl/nations');
await call('/api/intl/search', { q: 'mexico' });
await call('/api/intl/leaders', { stat: 'goals' });
await call('/api/intl/team-leaders', { stat: 'points' });
await call('/api/intl/rankings', { gender: 'm' });
await call('/api/intl/h2h', { a: 'usa', b: 'mexico' });
await call('/api/intl/teams/usa/history');
await call('/api/intl/teams/usa/elo');
// A senior match (youth sides have no Elo).
const intlMatch = (JSON.stringify(intlHome).match(/"slug":"[a-z0-9-]+-vs-[a-z0-9-]+[^"]*"/g) ?? []).map((s) => s.slice(8, -1)).find((x) => !/-u\d\d/.test(x));
if (intlMatch) await call(`/api/intl/matches/${intlMatch}/elo`);
const intlPlayer = first((await call('/api/intl/search', { q: 'pulisic' })).players)?.slug;
if (intlPlayer) await call(`/api/intl/players/${intlPlayer}`);

// Guards.
const guard = [];
const anon = await fetch(`${base}/v1/site/meta`); guard.push(['keyless /v1/site → 401', anon.status === 401, anon.status]);
const admin = await fetch(`${base}/v1/site/console/pro`, { headers: { 'X-Api-Key': key } }); guard.push(['admin path → 404', admin.status === 404, admin.status]);

const called = new Set(results.map((r) => r.route).filter(Boolean));
const untested = SITE_ROUTES.map((r) => r.path).filter((p) => !called.has(p));
const bad = results.filter((r) => !r.ok && !(r.status === 404));
const pad = (s, n) => String(s).padEnd(n);
for (const r of results) console.log(`${r.ok ? 'ok ' : r.status === 404 ? '404' : 'BAD'} ${pad(r.ms + 'ms', 8)} ${pad(Math.round(r.size / 1024) + 'KB', 7)} ${r.route ?? r.path}${r.note ? `  (${r.note})` : ''}${r.raw ? '  RAW PAYLOAD' : ''}`);
for (const [what, ok, got] of guard) console.log(`${ok ? 'ok ' : 'BAD'} ${what} (got ${got})`);
console.log(`\n${results.length} calls, ${results.filter((r) => r.ok).length} ok, ${results.filter((r) => r.status === 404).length} not found, ${bad.length} failed; slowest ${Math.max(...results.map((r) => r.ms))} ms`);
console.log(`routes covered ${called.size}/${SITE_ROUTES.length}${untested.length ? `; not reached: ${untested.join(', ')}` : ''}`);
process.exit(bad.length || results.some((r) => r.raw) || guard.some(([, ok]) => !ok) ? 1 : 0);
