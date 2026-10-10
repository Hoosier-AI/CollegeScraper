// The `crawl` block of /api/console/pro, for the hub's Crawling page: every site the pro crawl reads (requests,
// seasons done of the seasons it should have, rows, agreement with API-Football, what is running), every league
// season with the source that supplies each kind of data, and what is running right now.
import { selectAll, type Db } from '../db/client.js';
import { cachedKv, KV } from './settings.js';
import { CRAWL_SITES, CHECK_JOBS, expectedSeasons, siteOfJob } from '../pro/crawlSites.js';
import { tierOf } from '../jobs/pro/plan.js';
import type { QuotaState } from '../sources/apiFootball/client.js';

type ReqRow = { day: string; source: string; host: string; requests: number; errors: number; not_modified: number; bytes: number; last_at: string | null; last_error: string | null };
type SeasonRow = { source: string; league_id: number; season: number; synced_at: string | null; games: number; player_rows: number; last_error: string | null };
type MatrixRow = { league_id: number; season: number; fixtures: number; fixtures_by: Record<string, number>; finals: number; detailed: number; table_by: string | null; table_rows: number; players_by: Record<string, number>; club_stats: number; src: Record<string, { synced_at: string | null; games: number; player_rows: number; last_error: string | null }> };

const day = (offset = 0) => new Date(Date.now() - offset * 86400_000).toISOString().slice(0, 10);
const sum = (rows: Record<string, number>, keep: (k: string) => boolean) => Object.entries(rows).reduce((n, [k, v]) => n + (keep(k) ? Number(v) : 0), 0);
const isApi = (k: string) => k === 'api-football' || k === 'provider';

/** Every row of pro_crawl_matrix(): PostgREST caps an answer at 1,000 rows, so it is read a page at a time. */
async function matrixRows(db: Db): Promise<MatrixRow[]> {
  const out: MatrixRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.rpc('pro_crawl_matrix').range(from, from + 999);
    if (error) throw new Error(`crawl matrix: ${error.message}`);
    out.push(...((data ?? []) as MatrixRow[]));
    if (!data || data.length < 1000) return out;
  }
}

export type LeagueScope = 'us' | 'top' | 'all';

/** The leagues list for the Crawling page, filtered (US scene, top competitions, or everything) and to current seasons unless asked. */
export async function crawlLeagues(db: Db, o: { scope: LeagueScope; seasons: 'current' | 'all' }) {
  const b = await crawlBlock(db, { quota: null, overall: { tasks: 0, done: 0, pct: 0, calls_left: 0, eta_days: null } }, { leagues: true });
  const rows = b.leagues.filter((l) => (o.scope === 'us' ? l.tier === 1 : o.scope === 'top' ? l.tier <= 2 : true) && (o.seasons === 'all' || l.current || l.tier === 1));
  return { generated_at: b.generated_at, scope: o.scope, seasons: o.seasons, total: b.leagues.length, leagues: rows };
}

export async function crawlBlock(db: Db, ctx: { quota: (QuotaState & { saved_at?: string }) | null; overall: { tasks: number; done: number; pct: number; calls_left: number; eta_days: number | null }; perDay?: { day: string; calls: number }[] }, o: { leagues?: boolean } = {}) {
  const since = day(6);
  const jobs = [...new Set([...CRAWL_SITES.flatMap((s) => s.jobs), ...CHECK_JOBS])];
  const [visible, reqs, seasons, agreement, matrix, leagues, running, recent] = await Promise.all([
    cachedKv<boolean>(db, KV.proSourcesVisible, false),
    selectAll<ReqRow>(db, 'pro_source_requests', 'day,source,host,requests,errors,not_modified,bytes,last_at,last_error', (q) => q.gte('day', since)),
    selectAll<SeasonRow>(db, 'pro_source_seasons', 'source,league_id,season,synced_at,games,player_rows,last_error'),
    db.rpc('pro_source_agreement').then((r) => (r.data ?? []) as { source: string; agree: number; differ: number; unmatched: number }[]),
    matrixRows(db),
    selectAll<{ id: number; name: string; country: string | null; type: string | null; priority: number; current_season: number | null; enabled: boolean }>(db, 'pro_leagues', 'id,name,country,type,priority,current_season,enabled'),
    db.from('college_crawl_runs').select('id,job,params,started_at,heartbeat_at,counters').eq('status', 'running').order('started_at').then((r) => (r.data ?? []) as any[]),
    db.from('college_crawl_runs').select('id,job,status,created_at,started_at,finished_at,counters,error').in('job', jobs).neq('status', 'queued').order('created_at', { ascending: false }).limit(150).then((r) => (r.data ?? []) as any[]),
  ]);
  const league = new Map(leagues.map((l) => [l.id, l]));
  const year = new Date().getUTCFullYear();
  const currentOf = (id: number) => league.get(id)?.current_season ?? year;

  // Seasons each source should have against what it has synced.
  const expected = expectedSeasons(currentOf);
  const synced = new Map(seasons.map((s) => [`${s.source}|${s.league_id}|${s.season}`, s]));
  const lastRun = new Map<string, any>();
  for (const r of recent) if (!lastRun.has(r.job)) lastRun.set(r.job, r);
  const runningJobs = running.filter((r) => r.job.startsWith('pro-') || jobs.includes(r.job));

  const sites = CRAWL_SITES.map((site) => {
    const mine = reqs.filter((r) => r.source === site.id);
    const today = mine.filter((r) => r.day === day());
    // API-Football: its runs have counted requests all along (and the quota knows today's), so the larger number wins.
    const apiDay = (d: string) => (site.id === 'api-football' ? Math.max(ctx.perDay?.find((p) => p.day === d)?.calls ?? 0, d === day() && ctx.quota?.day === d ? ctx.quota.usedToday : 0) : 0);
    const perDay = Array.from({ length: 7 }, (_, i) => day(6 - i)).map((d) => ({ day: d, requests: Math.max(apiDay(d), mine.filter((r) => r.day === d).reduce((n, r) => n + r.requests, 0)) }));
    const last = mine.reduce<ReqRow | null>((a, r) => (!a || (r.last_at ?? '') > (a.last_at ?? '') ? r : a), null);
    const want = expected.filter((e) => e.source === site.id);
    const have = want.map((e) => synced.get(`${e.source}|${e.league_id}|${e.season}`));
    const done = have.filter((h) => h?.synced_at).length;
    const errors = seasons.filter((s) => s.source === site.id && s.last_error).length;
    const mineSeasons = seasons.filter((s) => s.source === site.id);
    const ag = agreement.filter((a) => a.source === site.id).reduce((x, a) => ({ agree: x.agree + Number(a.agree), differ: x.differ + Number(a.differ), unmatched: x.unmatched + Number(a.unmatched) }), { agree: 0, differ: 0, unmatched: 0 });
    const compared = ag.agree + ag.differ;
    const runs = site.jobs.map((j) => lastRun.get(j)).filter(Boolean);
    const failed = runs.find((r) => r.status === 'failed');
    const isRunning = runningJobs.some((r) => site.jobs.includes(r.job) || (site.id === 'api-football' && r.job.startsWith('pro-')));
    // Seasons synced in the last 7 days, for a time-left estimate at the current pace.
    const recentDone = mineSeasons.filter((s) => s.synced_at && s.synced_at.slice(0, 10) >= since).length;
    const left = want.length - done;
    return {
      ...site,
      on: site.scraped ? !!visible : true,
      status: isRunning ? 'crawling' : failed ? 'error' : 'idle',
      requests: { today: perDay[6]!.requests, errors_today: today.reduce((n, r) => n + r.errors, 0), week: perDay.reduce((n, d) => n + d.requests, 0), errors_week: mine.reduce((n, r) => n + r.errors, 0), bytes_week: mine.reduce((n, r) => n + Number(r.bytes), 0), per_day: perDay, last_at: last?.last_at ?? null, last_error: mine.find((r) => r.last_error)?.last_error ?? null },
      seasons: site.scraped ? { done, total: want.length, errors } : null,
      rows: { games: mineSeasons.reduce((n, s) => n + (s.games ?? 0), 0), player_rows: mineSeasons.reduce((n, s) => n + (s.player_rows ?? 0), 0) },
      agreement: site.scraped ? { ...ag, rate: compared ? Math.round((ag.agree / compared) * 1000) / 1000 : null } : null,
      eta_days: site.scraped ? (left <= 0 ? 0 : recentDone ? Math.ceil(left / (recentDone / 7)) : null) : ctx.overall.eta_days,
      tasks: site.scraped ? null : { tasks: ctx.overall.tasks, done: ctx.overall.done, pct: ctx.overall.pct, calls_left: ctx.overall.calls_left },
      quota: site.scraped ? null : ctx.quota ? { remaining: ctx.quota.remaining, limit: ctx.quota.limit, used_today: ctx.quota.usedToday, blocked_until: ctx.quota.blockedUntil } : null,
      last_runs: runs.map((r) => ({ id: r.id, job: r.job, status: r.status, started_at: r.started_at, finished_at: r.finished_at, error: r.error ?? null, counters: r.counters ?? {} })),
    };
  });

  // Every league season in view, with the source of each kind of data.
  const leagueRows = matrix.map((m) => {
    const l = league.get(m.league_id);
    const playersApi = sum(m.players_by, (k) => k === 'provider');
    const playersScraped = sum(m.players_by, (k) => k === 'asa');
    const fixturesScraped = sum(m.fixtures_by, (k) => !isApi(k));
    const sourceSeasons = Object.fromEntries(Object.entries(m.src).map(([k, v]) => [k, { synced: !!v.synced_at, games: v.games, player_rows: v.player_rows, error: v.last_error }]));
    return {
      league_id: m.league_id, league: l?.name ?? String(m.league_id), country: l?.country ?? null,
      tier: l ? tierOf({ id: l.id, country: l.country, priority: l.priority, type: l.type as any }) : 4,
      season: m.season, current: m.season === currentOf(m.league_id),
      fixtures: { total: m.fixtures, by: m.fixtures_by, scraped: fixturesScraped, finals: m.finals, detailed: m.detailed },
      table: { by: m.table_by, rows: m.table_rows },
      players: { by: m.players_by, scraped: playersScraped, api: playersApi, computed: sum(m.players_by, (k) => k === 'computed') },
      club_stats: m.club_stats,
      sources: sourceSeasons,
    };
  }).sort((a, b) => a.tier - b.tier || a.league.localeCompare(b.league) || b.season - a.season);

  // What share of what the site shows came from scraped and open sources (fixtures, tables, player season rows).
  const tot = leagueRows.reduce((x, r) => ({
    fixtures: x.fixtures + r.fixtures.total, fixtures_scraped: x.fixtures_scraped + r.fixtures.scraped,
    tables: x.tables + (r.table.rows ? 1 : 0), tables_scraped: x.tables_scraped + (r.table.rows && r.table.by && r.table.by !== 'api-football' ? 1 : 0),
    players: x.players + r.players.scraped + r.players.api + r.players.computed, players_scraped: x.players_scraped + r.players.scraped,
  }), { fixtures: 0, fixtures_scraped: 0, tables: 0, tables_scraped: 0, players: 0, players_scraped: 0 });

  return {
    generated_at: new Date().toISOString(),
    sites,
    scraped_share: tot,
    running: runningJobs.map((r) => ({ id: r.id, job: r.job, site: siteOfJob(r.job), league_id: Number(r.params?.league) || null, season: Number(r.params?.season) || null, started_at: r.started_at, heartbeat_at: r.heartbeat_at, counters: r.counters ?? {} })),
    checks: CHECK_JOBS.map((j) => lastRun.get(j)).filter(Boolean).map((r) => ({ id: r.id, job: r.job, status: r.status, started_at: r.started_at, finished_at: r.finished_at, error: r.error ?? null, counters: r.counters ?? {} })),
    league_seasons: leagueRows.length,
    leagues: o.leagues ? leagueRows : [],
  };
}
