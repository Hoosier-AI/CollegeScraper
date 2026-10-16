// JSON behind the /pro pages of the site. Public reads, rate-limited by the same /api hook as the college routes
// (registerUiApi). Not part of /v1: API-Football's terms allow showing its data on our pages, not passing the raw
// data on, so pro data has no public API.
import { matchesOnSide, proHomeOnSide, sideOf, transfersOnSide } from './side.js';
import { isMinor } from '../pro/minor.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getDb, kvGet, selectAll } from '../db/client.js';
import { loadConfig } from '../config.js';
import type { QuotaState } from '../sources/apiFootball/client.js';
import { byKind, byTier, callsPerDay, etaDays, type ProgressRow, type RunCounters } from '../ops/proProgress.js';
import { schedule as cqSchedule } from '../ops/consoleQueries.js';
import * as pro from '../pro/queries.js';
import { proElo as proEloList } from './elo.js';
import { memo, memoKey } from '../pro/memo.js';
import { eastern } from '../jobs/seasons.js';
import { SLUG } from '../seo/util.js';
import { PRO_QUOTA_KEY } from '../jobs/pro/shared.js';
import { cachedKv, KV } from '../ops/settings.js';
import { isBot, refreshPlayerOnView } from '../pro/playerRefresh.js';
import { refreshTeamOnView } from '../pro/teamRefresh.js';
import { crawlBlock, crawlLeagues } from '../ops/proCrawlConsole.js';
import { BROKEN_AT, advForLeaders, sourcesOff } from '../pro/sources.js';
import { swr } from '../ops/swr.js';
import { teamOfWeek } from '../pro/teamOfWeek.js';
import { proFlow } from '../match/flowQueries.js';
import { proTableView } from '../standings/viewQueries.js';
import { icsCalendar } from '../calendar/ics.js';
import { PRO_REF_SORTS, proMatchReferee, proReferee, proRefereeLeagues, proRefereeList } from '../referees.js';

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
    return reply.header('Cache-Control', CACHE).send(proHomeOnSide(await pro.home(getDb(), date), sideOf(req.query.gender)));
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/matches', async (req, reply) => {
    const date = req.query.date ?? eastern().date;
    if (!DATE.test(date)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    if (req.query.status && !['scheduled', 'live', 'final', 'postponed', 'cancelled', 'abandoned'].includes(req.query.status)) return reply.code(400).send({ error: 'bad status' });
    const league = req.query.league ? Number(req.query.league) : null;
    return reply.header('Cache-Control', CACHE).send(matchesOnSide(await pro.matchesByDate(getDb(), { date, league: Number.isInteger(league) ? league : null, status: req.query.status ?? null, featured: req.query.featured === '1' }), sideOf(req.query.gender)));
  });
  app.get('/api/pro/leagues', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=300').send(await pro.leagues(getDb())));
  app.get<{ Params: { slug: string }; Querystring: Record<string, string> }>('/api/pro/leagues/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await pro.league(getDb(), req.params.slug, season(req.query.season));
    return r ? reply.header('Cache-Control', CACHE).send(r) : notFound(reply, 'league', req.params.slug);
  });
  app.get<{ Params: { slug: string }; Querystring: Record<string, string> }>('/api/pro/teams/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const db = getDb();
    // Someone opening a club we have little on: match detail, transfers, squad, coaches, season stats first (capped,
    // see teamRefresh.ts). Only the current season's page; bots never trigger it.
    if (!isBot(req.headers['user-agent']) && !req.query.season) {
      const { data: hit } = await db.from('pro_teams').select('id,national').eq('slug', req.params.slug).maybeSingle();
      const t = hit as { id?: number; national?: boolean } | null;
      if (t?.id != null && !t.national) await refreshTeamOnView(db, t.id).catch(() => 'failed');
    }
    const r = await pro.team(db, req.params.slug, season(req.query.season));
    return r ? reply.header('Cache-Control', CACHE).send(r) : notFound(reply, 'team', req.params.slug);
  });
  app.get<{ Params: { slug: string } }>('/api/pro/players/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const db = getDb();
    // Someone opening a player we have little on: fetch their transfers, honours and seasons first (capped, see
    // playerRefresh.ts). Bots never trigger it.
    if (!isBot(req.headers['user-agent'])) {
      const { data: hit } = await db.from('pro_players').select('id,current_team_id,birth_date').eq('slug', req.params.slug).maybeSingle();
      const pl = hit as { id?: number; current_team_id?: number | null; birth_date?: string | null } | null;
      // Nothing to fetch for a player under 18: the page is a short notice (src/pro/minor.ts).
      if (pl?.id != null && !isMinor(pl.birth_date)) {
        // His club too (its match detail is his match log): the squad's club, else his latest club season.
        let club = pl.current_team_id ?? null;
        if (club == null) {
          const { data: rows } = await db.from('pro_player_season_stats').select('team_id').eq('player_id', pl.id).order('season', { ascending: false }).limit(6);
          const ids = [...new Set(((rows ?? []) as { team_id: number }[]).map((r) => r.team_id))];
          const { data: clubs } = ids.length ? await db.from('pro_teams').select('id').in('id', ids).eq('national', false) : { data: [] };
          const ok = new Set(((clubs ?? []) as { id: number }[]).map((c) => c.id));
          club = ids.find((id) => ok.has(id)) ?? null;
        }
        await Promise.all([refreshPlayerOnView(db, pl.id).catch(() => 'failed'), club != null && club > 0 ? refreshTeamOnView(db, club).catch(() => 'failed') : null]);
      }
    }
    const r = await pro.player(db, req.params.slug);
    return r ? reply.header('Cache-Control', CACHE).send(r) : notFound(reply, 'player', req.params.slug);
  });
  app.get<{ Params: { slug: string } }>('/api/pro/matches/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await pro.match(getDb(), req.params.slug);
    return r ? reply.header('Cache-Control', CACHE).send(r) : notFound(reply, 'match', req.params.slug);
  });
  app.get<{ Params: { slug: string } }>('/api/pro/teams/:slug/calendar.ics', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const db = getDb();
    const { data: t } = await db.from('pro_teams').select('id,name,national').eq('slug', req.params.slug).maybeSingle();
    if (!t) return reply.code(404).send({ error: 'not found' });
    const tid = (t as any).id;
    const from = new Date(Date.now() - 60 * 86400_000).toISOString(), to = new Date(Date.now() + 365 * 86400_000).toISOString();
    const { data } = await db.from('pro_fixtures').select(pro.FIXTURE_SELECT).or(`home_team_id.eq.${tid},away_team_id.eq.${tid}`).gte('kickoff', from).lte('kickoff', to).order('kickoff').limit(200);
    const base = `https://${req.headers.host ?? 'www.plaibook.live'}`;
    const ms = ((data ?? []) as any[]).map(pro.toMatchRow).filter((m) => m.status !== 'cancelled');
    const ics = icsCalendar((t as any).name, ms.map((m) => ({
      uid: `pro-${m.id}@plaibook.live`, start: new Date(m.kickoff), date: m.kickoff.slice(0, 10),
      summary: `${m.home.name} vs ${m.away.name}${m.status === 'final' && m.home.score != null ? ` (${m.home.score}-${m.away.score})` : ''}, ${m.league.name}`,
      location: m.venue ?? null, description: `${base}${m.league.scope === 'intl' ? '/intl' : '/pro'}/matches/${m.slug}`, url: `${base}${m.league.scope === 'intl' ? '/intl' : '/pro'}/matches/${m.slug}`,
    })));
    return reply.header('Content-Type', 'text/calendar; charset=utf-8').header('Cache-Control', 'public, max-age=3600').send(ics);
  });
  // A club's Plaibook Elo (rating, world and country rank, last 30 days) and the seasons it finished top of a table.
  app.get<{ Params: { slug: string } }>('/api/pro/teams/:slug/extras', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const db = getDb();
    const { data: t } = await db.from('pro_teams').select('id').eq('slug', req.params.slug).maybeSingle();
    if (!t) return reply.code(404).send({ error: 'not found' });
    const tid = (t as any).id;
    const [eloRes, tops] = await Promise.all([
      db.from('pro_elo').select('rating,rank,games,change_30d,country,gender,updated_at').eq('team_id', tid).maybeSingle(),
      selectAll<any>(db, 'pro_standings', 'league_id,season,group_name,points', (q) => q.eq('team_id', tid).eq('rank', 1)),
    ]);
    const e = eloRes.data as any;
    let country_rank: number | null = null;
    if (e?.country && e.rating != null) {
      const { count } = await db.from('pro_elo').select('team_id', { count: 'exact', head: true }).eq('country', e.country).eq('gender', e.gender).gt('rating', e.rating).gte('games', 10);
      country_rank = (count ?? 0) + 1;
    }
    const ids = [...new Set(tops.map((x) => x.league_id))];
    const [leagues, cur] = await Promise.all([pro.leaguesById(db, ids), ids.length ? selectAll<any>(db, 'pro_leagues', 'id,current_season', (q) => q.in('id', ids)) : Promise.resolve([])]);
    const current = new Map(cur.map((l) => [l.id, l.current_season ?? 9999]));
    const finished = tops.filter((x) => { const l = leagues.get(x.league_id) as any; return l && x.season < (current.get(x.league_id) ?? 9999) && l.type !== 'cup'; })
      .map((x) => ({ league: leagues.get(x.league_id)!, season: x.season, group: /^(overall|league|regular|table)/i.test(x.group_name ?? '') || !x.group_name || x.group_name === leagues.get(x.league_id)!.name ? null : x.group_name, points: x.points }))
      .sort((a, b) => b.season - a.season || (a.group ? 1 : 0) - (b.group ? 1 : 0));
    return reply.header('Cache-Control', 'public, max-age=3600').send({
      elo: e && e.games >= 10 ? { rating: Math.round(Number(e.rating)), rank: e.rank ?? null, country: e.country ?? null, country_rank, change_30d: e.change_30d == null ? null : Math.round(Number(e.change_30d)), games: e.games, as_of: String(e.updated_at).slice(0, 10) } : null,
      tops: finished,
    });
  });
  // Home / Away / Form tables (src/standings/views.ts).
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/pro/leagues/:id/table', async (req, reply) => {
    const id = Number(req.params.id), s = season(req.query.season);
    const view = (['all', 'home', 'away', 'form'] as const).find((v) => v === req.query.view) ?? 'home';
    if (!Number.isInteger(id) || id <= 0 || !s) return reply.code(400).send({ error: 'league id and season required' });
    return reply.header('Cache-Control', 'public, max-age=300').send(await proTableView(getDb(), id, s, view));
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/pro/leagues/:id/team-of-week', async (req, reply) => {
    const id = Number(req.params.id), s = season(req.query.season);
    if (!Number.isInteger(id) || id <= 0 || !s) return reply.code(400).send({ error: 'league id and season required' });
    const round = req.query.round ? String(req.query.round).slice(0, 80) : null;
    return reply.header('Cache-Control', 'public, max-age=300').send(await teamOfWeek(getDb(), id, s, round));
  });
  // Referees (migration 187): the list, one referee's page and the card on a match page.
  app.get<{ Querystring: Record<string, string> }>('/api/pro/referees', async (req, reply) => {
    const q = req.query;
    const n = (v: unknown) => { const x = Number(v); return v != null && v !== '' && Number.isInteger(x) ? x : null; };
    const gender: 'm' | 'w' | null = q.gender === 'w' || q.gender === 'm' ? q.gender : null;
    const all = q.period === 'all';
    // US first: 'default' (or nothing) is the gender's top competition with referee data this season; 'all' every one.
    const leagues = await proRefereeLeagues(getDb(), gender);
    const pick = q.league === 'all' ? null : n(q.league) ?? (all ? null : leagues[0]?.league?.id ?? null);
    const f = {
      gender, league: pick, season: season(q.season), current: !all, q: q.q ? String(q.q).trim().slice(0, 60) || null : null,
      min: Math.min(200, Math.max(1, n(q.min) ?? 5)), sort: (PRO_REF_SORTS as readonly string[]).includes(q.sort ?? '') ? q.sort! : 'matches',
      limit: Math.min(100, Math.max(1, n(q.limit) ?? 50)), offset: Math.max(0, n(q.offset) ?? 0),
    };
    const list = await proRefereeList(getDb(), f);
    return reply.header('Cache-Control', 'public, max-age=300').send({ ...list, leagues, league_id: pick });
  });
  app.get<{ Params: { slug: string } }>('/api/pro/referees/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const r = await proReferee(getDb(), req.params.slug);
    return r ? reply.header('Cache-Control', 'public, max-age=300').send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Params: { id: string } }>('/api/pro/fixtures/:id/flow', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'bad id' });
    const f = await proFlow(getDb(), id);
    return reply.header('Cache-Control', f?.live ? 'public, max-age=20' : 'public, max-age=600').send({ flow: f });
  });
  app.get<{ Params: { id: string } }>('/api/pro/fixtures/:id/referee', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'bad id' });
    return reply.header('Cache-Control', 'public, max-age=600').send({ referee: await proMatchReferee(getDb(), id) });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/search', async (req, reply) => {
    const q = String(req.query.q ?? '');
    return reply.header('Cache-Control', 'public, max-age=60').send(await pro.search(getDb(), q, Math.min(20, Number(req.query.limit) || 8), 'club', sideOf(req.query.gender)));
  });
  // Leaders and the player directory share one query (pro_leaders).
  const int = (v: unknown) => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) ? n : null; };
  app.get<{ Querystring: Record<string, string> }>('/api/pro/leaders', async (req, reply) => {
    const q = req.query;
    if (q.position && !(pro.POSITIONS as readonly string[]).includes(q.position)) return reply.code(400).send({ error: 'bad position' });
    const f: pro.LeadersFilter = {
      stat: q.stat, league: int(q.league), season: season(q.season), position: q.position || null, nationality: q.nationality || null,
      min_age: int(q.min_age), max_age: int(q.max_age), min_minutes: int(q.min_minutes), per90: q.per90 === '1', gender: q.gender === 'w' || q.gender === 'm' ? q.gender : null,
      abroad: q.abroad || null, country: q.country && /^[A-Za-z-]{2,40}$/.test(q.country) ? q.country : null, limit: int(q.limit) ?? 50, offset: int(q.offset) ?? 0,
    };
    // xG and xA beside each row where American Soccer Analysis covers the competition (MLS, NWSL, USL…).
    return reply.header('Cache-Control', 'public, max-age=300').send(await memo(memoKey('leaders', f), async () => {
      const page = await pro.leaders(getDb(), f);
      const adv = await advForLeaders(getDb(), page.rows.filter((r) => r.league).map((r) => ({ player: r.player.id, league: r.league!.id, season: r.season }))).catch(() => new Map<string, { xg: number | null; xa: number | null }>());
      return { ...page, rows: page.rows.map((r) => { const a = r.league ? adv.get(`${r.player.id}|${r.league.id}|${r.season}`) : undefined; return a ? { ...r, xg: a.xg, xa: a.xa } : r; }) };
    }));
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/teams', async (req, reply) => {
    const q = req.query;
    const f = { gender: q.gender === 'w' ? 'w' as const : 'm' as const, scope: q.scope === 'world' ? 'world' as const : 'us' as const, league: int(q.league) };
    return reply.header('Cache-Control', 'public, max-age=600').send(await memo(memoKey('teams-list', f), () => pro.teamsList(getDb(), f)));
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/rankings', async (req, reply) => {
    const country = req.query.scope === 'world' ? null : req.query.country && /^[A-Za-z' -]{2,40}$/.test(req.query.country) ? req.query.country : 'USA';
    return reply.header('Cache-Control', 'public, max-age=600').send(await proEloList(getDb(), { gender: req.query.gender === 'w' ? 'w' : 'm', country, limit: req.query.limit, offset: req.query.offset }));
  });
  app.get<{ Params: { id: string } }>('/api/pro/coaches/:id', async (req, reply) => {
    const id = int(req.params.id); if (!id || id < 1) return reply.code(400).send({ error: 'id required' });
    const r = await pro.proCoach(getDb(), id);
    return r ? reply.header('Cache-Control', 'public, max-age=3600').send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/h2h', async (req, reply) => {
    const { a = '', b = '' } = req.query;
    if (!SLUG.test(a) || !SLUG.test(b) || a === b) return reply.code(400).send({ error: 'a and b must be two club addresses' });
    const r = await pro.teamH2H(getDb(), a, b);
    return r ? reply.header('Cache-Control', 'public, max-age=600').send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/team-leaders', async (req, reply) => {
    const q = req.query;
    const f: pro.TeamLeadersFilter = { stat: q.stat, scope: 'club', gender: q.gender === 'w' ? 'w' : 'm', league: int(q.league), us: q.scope !== 'world', limit: int(q.limit) ?? 50, offset: int(q.offset) ?? 0 };
    return reply.header('Cache-Control', 'public, max-age=300').send(await memo(memoKey('team-leaders', f), () => pro.teamLeaders(getDb(), f)));
  });
  app.get('/api/pro/countries', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=3600').send(await pro.countries(getDb())));
  app.get<{ Params: { slug: string }; Querystring: { gender?: string } }>('/api/pro/countries/:slug', async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ error: 'bad slug' });
    const g = req.query.gender === 'm' || req.query.gender === 'w' ? req.query.gender : undefined;
    const r = await memo(memoKey('country', [req.params.slug, g]), () => pro.country(getDb(), req.params.slug, g));
    return r ? reply.header('Cache-Control', 'public, max-age=600').send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/compare', async (req, reply) => {
    const { a = '', b = '' } = req.query;
    if (!SLUG.test(a) || !SLUG.test(b)) return reply.code(400).send({ error: 'a and b must be player slugs' });
    const r = await pro.compare(getDb(), a, b);
    return r ? reply.header('Cache-Control', CACHE).send(r) : reply.code(404).send({ error: 'not found' });
  });
  app.get<{ Querystring: Record<string, string> }>('/api/pro/transfers', async (req, reply) =>
    reply.header('Cache-Control', 'public, max-age=600').send(transfersOnSide(await pro.transfersFeed(getDb(), { limit: int(req.query.limit) ?? 50, offset: int(req.query.offset) ?? 0, team: int(req.query.team), us: req.query.scope !== 'world' }), sideOf(req.query.gender))));
  app.get<{ Querystring: Record<string, string> }>('/api/pro/americans-abroad', async (req, reply) => {
    const o = { gender: (req.query.gender === 'w' || req.query.gender === 'm' ? req.query.gender : null) as 'm' | 'w' | null, stat: (pro.LEADER_STATS as readonly string[]).includes(req.query.stat ?? '') ? req.query.stat! : 'goals', leaderboard: true };
    return reply.header('Cache-Control', 'public, max-age=300').send(await memo(memoKey('abroad', o), () => pro.americansAbroad(getDb(), o), { fresh: 5 * 60_000 }));
  });
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
  // The Crawling page's leagues list (every league season and the source of each kind of data), apart from the main
  // document so the 30-second poll stays small. ?scope=us|top|all&seasons=current|all
  app.get<{ Querystring: Record<string, string> }>('/api/console/pro/leagues', async (req) => {
    const scope = (['us', 'top', 'all'] as const).find((x) => x === req.query.scope) ?? 'us';
    const seasons = req.query.seasons === 'all' ? 'all' : 'current';
    return swr(`console-pro:leagues:${scope}:${seasons}`, 60_000, () => crawlLeagues(getDb(), { scope, seasons }));
  });

  // ?parts=summary leaves out the sources and crawl blocks (the heavy part) for callers that only show the numbers.
  app.get<{ Querystring: Record<string, string> }>('/api/console/pro', async (req) => {
    const summary = req.query.parts === 'summary';
    return swr(`console-pro:${summary ? 'summary' : 'full'}`, 45_000, () => proConsole(summary));
  });
  async function proConsole(summary: boolean) {
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
    const budget = Math.max(0, (quota?.limit ?? 7500) - cfg.PRO_BACKFILL_RESERVE);
    const lastRuns: Record<string, unknown> = {};
    for (const r of last) if (!lastRuns[r.job] && r.status !== 'queued') lastRuns[r.job] = r;
    const overall = { tasks, done, pct: tasks ? Math.round((done / tasks) * 1000) / 10 : 0, calls_left: left, eta_days: etaDays(left, perDay, budget) };
    const entry = (job: string) => sched.entries.find((e: { job: string }) => e.job === job) as { enabled: boolean; last_fired: string | null; next: string | null } | undefined;
    return {
      generated_at: new Date().toISOString(),
      quota,
      overall,
      pace: { calls_today: quota?.day === new Date().toISOString().slice(0, 10) ? quota.usedToday : 0, crawl_budget_today: budget, per_day: perDay, calls_7d: perDay.reduce((n, d) => n + d.calls, 0) },
      by_kind: kinds, by_tier: byTier(progress),
      tables: { leagues, enabled, countries, teams, players, profiled, fixtures, finals, detailed, season_rows_provider: provider, season_rows_computed: computed, squads, transfers, coaches, trophies, injuries, college_links: links },
      last_runs: lastRuns,
      flags: {
        key_set: !!cfg.API_FOOTBALL_KEY, blocked_until: quota?.blockedUntil ?? null, scheduler_paused: sched.paused,
        crawl_enabled: entry('pro-crawl')?.enabled ?? false, plan_enabled: entry('pro-plan')?.enabled ?? false,
        next_crawl: entry('pro-crawl')?.next ?? null, next_plan: entry('pro-plan')?.next ?? null,
      },
      sources: summary ? null : await sourcesBlock(db),
      // Every site the crawl reads, every league season's sources, and what is running (the hub's Crawling page).
      crawl: summary ? null : await crawlBlock(db, { quota, overall, perDay }),
      // Kept for the Stats console's own Pro card (older shape).
      leagues, enabled, fixtures, finals, detailed, players, profiled, college_links: links,
    };
  }
}

/**
 * Other sources for the hub: whether they show on the site, each league season's sync and agreement with
 * API-Football (shown = switch on and BROKEN_AT, 90%+, agree), how many clubs, players and games are matched, the shot backlog.
 */
async function sourcesBlock(db: ReturnType<typeof getDb>) {
  const count = (t: string, f: (q: any) => any) => f(db.from(t).select('*', { count: 'exact', head: true })).then((r: { count: number | null }) => r.count ?? 0);
  const [visible, seasons, agreement, runs, ...counts] = await Promise.all([
    sourcesOff(db).then((off) => !off.has('asa')),
    selectAll<{ source: string; league_id: number; season: number; synced_at: string | null; games: number; player_rows: number; last_error: string | null }>(db, 'pro_source_seasons', 'source,league_id,season,synced_at,games,player_rows,last_error'),
    db.rpc('pro_source_agreement').then((r) => (r.data ?? []) as { source: string; league_id: number; season: number; kind: string; agree: number; differ: number; unmatched: number; checked_at: string }[]),
    db.from('college_crawl_runs').select('id,job,status,created_at,started_at,finished_at,counters,error').in('job', ['asa-sync', 'asa-shots', 'asa-fill', 'source-map', 'source-check', 'openfootball-sync', 'wikipedia-sync', 'history-fill', 'results-tables']).order('created_at', { ascending: false }).limit(20).then((r) => (r.data ?? []) as any[]),
    ...(['team', 'player', 'game'] as const).flatMap((k) => [count('pro_source_ids', (q) => q.eq('kind', k).not('pro_id', 'is', null)), count('pro_source_ids', (q) => q.eq('kind', k).is('pro_id', null))]),
    count('pro_src_games', (q) => q.eq('status', 'final')), count('pro_src_games', (q) => q.eq('status', 'final').not('shots_at', 'is', null)),
  ]);
  // A sample of disagreements to review, newest seasons first.
  const differ = ((await db.from('pro_source_checks').select('source,kind,key,field,league_id,season,pro_key,ours,api').eq('status', 'differ').order('season', { ascending: false }).limit(25)).data ?? []) as any[];
  const names = new Map((await selectAll<{ id: number; name: string }>(db, 'pro_leagues', 'id,name', (q) => q.in('id', [...new Set(seasons.map((s) => s.league_id))]))).map((l) => [l.id, l.name]));
  const agree = new Map<string, { agree: number; differ: number; unmatched: number; checked_at: string | null }>();
  for (const a of agreement) {
    const k = `${a.source}|${a.league_id}|${a.season}`;
    const x = agree.get(k) ?? { agree: 0, differ: 0, unmatched: 0, checked_at: null };
    x.agree += Number(a.agree); x.differ += Number(a.differ); x.unmatched += Number(a.unmatched);
    if (!x.checked_at || a.checked_at > x.checked_at) x.checked_at = a.checked_at;
    agree.set(k, x);
  }
  const lastRuns: Record<string, unknown> = {};
  for (const r of runs) if (!lastRuns[r.job] && r.status !== 'queued') lastRuns[r.job] = r;
  const [teamOk, teamNo, playerOk, playerNo, gameOk, gameNo, finals, withShots] = counts as number[];
  return {
    visible: !!visible, trust_at: BROKEN_AT,
    seasons: seasons.map((s) => {
      const a = agree.get(`${s.source}|${s.league_id}|${s.season}`) ?? null;
      const compared = a ? a.agree + a.differ : 0;
      const rate = compared ? Math.round((a!.agree / compared) * 1000) / 1000 : null;
      return { ...s, league: names.get(s.league_id) ?? String(s.league_id), agree: a?.agree ?? 0, differ: a?.differ ?? 0, unmatched: a?.unmatched ?? 0, checked_at: a?.checked_at ?? null, rate, shown: !!visible && (rate == null || rate >= BROKEN_AT) };
    }).sort((x, y) => x.league_id - y.league_id || y.season - x.season),
    matched: { team: { matched: teamOk, unmatched: teamNo }, player: { matched: playerOk, unmatched: playerNo }, game: { matched: gameOk, unmatched: gameNo } },
    shots: { finals, with_shots: withShots },
    differences: differ.map((d) => ({ ...d, league: names.get(d.league_id) ?? String(d.league_id), ours: d.ours == null ? null : Number(d.ours), api: d.api == null ? null : Number(d.api) })),
    last_runs: lastRuns,
  };
}

/** Display order of the crawl kinds: what is crawled first, first. */
const KIND_ORDER = ['countries', 'country_teams', 'profiles_page', 'profile', 'season_fixtures', 'standings', 'league_players', 'detail', 'team_stats', 'squad', 'transfers', 'coach', 'injuries', 'venues', 'sidelined', 'trophies', 'coach_trophies'];
