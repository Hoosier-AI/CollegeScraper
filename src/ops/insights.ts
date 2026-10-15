// The hub's Stats Overview and Traffic tabs in one read (/api/console/insights): service health, what needs attention,
// site traffic (migration 163), API use per caller, content growth per day (stats_daily_counts) and crawl coverage.
// The answer is kept for a minute per range and refreshed in the background, so the hub never waits on a slow count.
import { getHeapStatistics } from 'node:v8';
import { kvGet, selectAll, type Db } from '../db/client.js';
import { loadConfig } from '../config.js';
import { SCHEDULE } from '../jobs/scheduler.js';
import { currentSeason } from '../jobs/seasons.js';
import { PRO_QUOTA_KEY } from '../jobs/pro/shared.js';
import type { QuotaState } from '../sources/apiFootball/client.js';
import { BROKEN_AT } from '../pro/sources.js';
import { isUsScene } from '../sources/apiFootball/leagues.js';
import { byKind, callsPerDay, etaDays, type ProgressRow, type RunCounters } from './proProgress.js';
import { worldCoverage } from './proCrawlConsole.js';
import { health as serviceHealth, jobRollup, schedule as scheduleState, usageStored } from './consoleQueries.js';
import { crawlPaused } from './settings.js';
import { RenderClient, type RenderDeploy } from './render.js';
import type { Health } from './health.js';

export type Level = 'error' | 'warn' | 'info';
export interface AttentionItem { id: string; level: Level; title: string; detail: string; href: string }

/** Everything the attention rules look at; built from the database by insights(), and by hand in tests. */
export interface AttentionInput {
  now: number;
  health: Pick<Health, 'ok' | 'problems' | 'lanes'>;
  scheduler: { enabled: boolean; paused: boolean; tick_at: string | null; entries: { job: string; label?: string; enabled: boolean; next: string | null }[] };
  rollup: Record<string, { last_done: { finished_at?: string | null } | null; last_failed: { finished_at?: string | null; error?: string | null } | null; queued: number; running: number }>;
  crawl_paused: boolean;
  /** Every run marked running, with its last heartbeat. */
  running: { id: string; job: string; heartbeat_at: string | null }[];
  quota: { key_set: boolean; remaining: number | null; limit: number | null; blocked_until: string | null; floor: number } | null;
  live: { games_live: number; with_fresh_stats: number };
  quality: { id: string; label?: string; count: number; previous: number | null }[];
  sources: { source: string; league: string; season: number; rate: number; compared: number }[];
  deploy: { status: string; commit: string | null; at: string | null } | null;
  traffic: { views_7d: number; views_prev_7d: number; zero_searches_7d: number };
  /** News sources switched on, by kind, with how many keep failing (3+ in a row and nothing read for a day). */
  news?: { kind: string; name: string; on: number; failing: number }[];
  /** US-scene pro matches live for 15+ minutes with no events stored (live detail not coming in). */
  pro_live_stale?: { count: number; live: number; names: string[] };
  /** The latest stat-audit result per check (stat_audit_runs): our numbers against NCAA.com, ASA and the provider. */
  audits?: { check_key: string; label: string; rate: number; target: number | null; compared: number }[];
  /** Open corrections / removal requests from the public form (stats_requests), with the oldest one's time. */
  requests?: { open: number; oldest: string | null; removal: number };
  /** This process's heap against its limit (the 2026-10-15 outages were out-of-memory restarts). */
  memory?: { heap_mb: number; heap_limit_mb: number };
}

/**
 * The computed jobs that build what the site shows from crawled data, with hours between runs in season (Aug to Dec)
 * and outside it (null: only in season). One whose last success is older than twice that is stale: the site shows old
 * ratings, odds, Elo, RPI, leaders or referees. A job never run (none in the 14-day rollup) is left to job:failed.
 */
export const COMPUTED_CADENCE: Record<string, { label: string; season: number; off: number | null }> = {
  'college-ratings': { label: 'College match ratings', season: 0.5, off: null },
  'college-sims': { label: 'NCAA tournament odds', season: 3, off: 24 },
  'college-rpi': { label: 'Live RPI', season: 1, off: null },
  'college-elo': { label: 'College Elo', season: 24, off: 24 },
  'pro-elo': { label: 'Pro club Elo', season: 24, off: 24 },
  'intl-elo': { label: 'National team Elo', season: 24, off: 24 },
  'pro-leaders': { label: 'Pro leaders', season: 1, off: 1 },
  referees: { label: 'Referee stats', season: 24, off: 24 },
  'stat-audit': { label: 'Stat audit', season: 24, off: 24 },
};

const FAILED_DEPLOY = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated']);
const ago = (now: number, iso: string | null | undefined) => (iso ? now - Date.parse(iso) : Infinity);
const mins = (ms: number) => (ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : ms < 48 * 3600_000 ? `${Math.round(ms / 3600_000)} h` : `${Math.round(ms / 86400_000)} days`);

/** What needs the owner's attention, worst first. Pure, so the rules are tested without a database. */
export function attentionFrom(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  const add = (level: Level, id: string, title: string, detail: string, href: string) => out.push({ id, level, title, detail, href });

  const laneDown = i.health.problems.filter((p) => /worker heartbeat/.test(p));
  if (laneDown.length) add('error', 'health:lanes', `${laneDown.length} of ${Object.keys(i.health.lanes).length || laneDown.length} worker lanes not running`, laneDown.map((p) => p.split(' ')[0]).join(', '), '/stats/service');
  for (const p of i.health.problems.filter((x) => !laneDown.includes(x))) add('error', `health:${p}`, 'Service health check failing', p, '/stats/service');
  if (i.deploy && FAILED_DEPLOY.has(i.deploy.status)) add('error', 'deploy', 'Last deploy did not go live', `${i.deploy.status.replace(/_/g, ' ')}${i.deploy.commit ? ` (${i.deploy.commit.slice(0, 7)})` : ''}`, '/stats/service');
  if (i.quota?.blocked_until && Date.parse(i.quota.blocked_until) > i.now) add('error', 'quota:blocked', 'API-Football refused requests', `Blocked until ${new Date(i.quota.blocked_until).toUTCString().slice(17, 22)} UTC. Pro scores and the crawl wait.`, '/stats/crawling');
  else if (i.quota?.key_set && i.quota.remaining != null && i.quota.remaining < i.quota.floor) add('warn', 'quota:floor', 'API-Football quota at its floor', `${i.quota.remaining.toLocaleString('en-US')} requests left today (floor ${i.quota.floor.toLocaleString('en-US')}). Only everyday jobs run until it resets.`, '/stats/crawling');

  if (i.scheduler.enabled && !i.scheduler.paused && ago(i.now, i.scheduler.tick_at) > 10 * 60_000) add('error', 'scheduler:stalled', 'Scheduler stopped', `Last tick ${i.scheduler.tick_at ? `${mins(ago(i.now, i.scheduler.tick_at))} ago` : 'never'}. No scheduled job is starting.`, '/stats/jobs');
  // Visitors waiting on us: removal and privacy requests first (the privacy policy promises an answer).
  if (i.requests && i.requests.open > 0) {
    const old = ago(i.now, i.requests.oldest);
    add(i.requests.removal > 0 || old > 5 * 86400_000 ? 'warn' : 'info', 'requests:open', `${i.requests.open} open correction or removal request${i.requests.open > 1 ? 's' : ''}`,
      `${i.requests.removal ? `${i.requests.removal} about removal or privacy. ` : ''}Oldest ${mins(old)} ago. Answer them in Stats > Requests.`, '/stats/requests');
  }
  if (i.scheduler.paused) add('info', 'scheduler:paused', 'Scheduler paused', 'No scheduled job starts until it is resumed in Settings.', '/stats/settings');
  if (i.crawl_paused) add('info', 'crawl:paused', 'College crawl paused', 'School-site crawling is off until it is resumed in Settings.', '/stats/settings');

  for (const e of i.scheduler.entries) {
    if (!e.enabled) continue;
    const r = i.rollup[e.job];
    const failedAt = r?.last_failed?.finished_at, doneAt = r?.last_done?.finished_at;
    if (failedAt && (!doneAt || Date.parse(failedAt) > Date.parse(doneAt))) {
      add('warn', `job:failed:${e.job}`, `${e.label ?? e.job} failed`, (r?.last_failed?.error ?? 'Last run failed').slice(0, 160), `/stats/jobs?job=${encodeURIComponent(e.job)}`);
    }
    if (i.scheduler.enabled && !i.scheduler.paused && e.next && i.now - Date.parse(e.next) > 30 * 60_000 && !(r && (r.running || r.queued))) {
      add('warn', `job:overdue:${e.job}`, `${e.label ?? e.job} is overdue`, `Due ${mins(i.now - Date.parse(e.next))} ago and not queued.`, `/stats/jobs?job=${encodeURIComponent(e.job)}`);
    }
  }
  // A run with no heartbeat for 15 minutes was cut off (usually a deploy restarting the service). A free worker of its
  // lane picks it up again, so it is only a problem when nothing of that job is moving.
  const byJob = new Map<string, { stale: typeof i.running; alive: number }>();
  for (const r of i.running) {
    const g = byJob.get(r.job) ?? { stale: [], alive: 0 };
    if (ago(i.now, r.heartbeat_at) > 15 * 60_000) g.stale.push(r); else g.alive += 1;
    byJob.set(r.job, g);
  }
  for (const [job, g] of byJob) {
    if (!g.stale.length) continue;
    const oldest = Math.max(...g.stale.map((r) => ago(i.now, r.heartbeat_at)));
    const n = g.stale.length, runs = `${n} ${job} ${n === 1 ? 'run' : 'runs'}`;
    if (g.alive) add('info', `runs:waiting:${job}`, `${runs} waiting to resume`, `Cut off up to ${mins(oldest)} ago; each continues where it stopped when the ${job} run in progress finishes.`, `/stats/jobs?job=${encodeURIComponent(job)}`);
    else add('warn', `runs:stalled:${job}`, `${runs} stalled`, `No heartbeat for ${mins(oldest)} and nothing of this job is moving.`, `/stats/jobs?job=${encodeURIComponent(job)}`);
  }

  // Live college scores: the live job keeps running while games are on. Many schools publish no live stats, so a
  // share of games without them is normal; none at all across several games is not.
  if (i.live.games_live > 0) {
    const liveDone = i.rollup.live?.last_done?.finished_at;
    if (ago(i.now, liveDone) > 10 * 60_000) add('error', 'live:stopped', 'Live scores stopped updating', `${i.live.games_live} college ${i.live.games_live === 1 ? 'game is' : 'games are'} live; the live job last finished ${liveDone ? `${mins(ago(i.now, liveDone))} ago` : 'never'}.`, '/stats/jobs?job=live');
    else if (i.live.games_live >= 3 && i.live.with_fresh_stats === 0) add('warn', 'live:stale', 'No live game stats coming in', `${i.live.games_live} college games are live and none has stats from the last 5 minutes.`, '/stats/crawling?part=college');
  }

  for (const c of i.quality) {
    if (c.previous == null || c.count <= c.previous) continue;
    const up = c.count - c.previous;
    if (up >= 5 && up >= c.previous * 0.2) add('warn', `quality:${c.id}`, `${c.label ?? c.id} up ${up.toLocaleString('en-US')}`, `${c.previous.toLocaleString('en-US')} to ${c.count.toLocaleString('en-US')} since the previous quality check.`, '/stats/quality');
  }
  const hidden = i.sources.filter((s) => s.compared >= 20 && s.rate < BROKEN_AT);
  if (hidden.length) add('info', 'sources:disagree', `${hidden.length} source ${hidden.length === 1 ? 'season disagrees' : 'seasons disagree'} with API-Football`, `${hidden.slice(0, 3).map((s) => `${s.league} ${s.season} (${Math.round(s.rate * 100)}%)`).join(', ')}${hidden.length > 3 ? ' ...' : ''}. Hidden from the site until they agree ${Math.round(BROKEN_AT * 100)}%.`, '/stats/quality');

  // Pro live detail: matches in play for a while with nothing but the score.
  const pl = i.pro_live_stale;
  if (pl && pl.count > 0) add('warn', 'pro:live-detail', `${pl.count} live US ${pl.count === 1 ? 'match has' : 'matches have'} no events`, `${pl.names.slice(0, 3).join(', ')}${pl.count > 3 ? ' ...' : ''}: in play 15+ minutes with only the score. pro-live reads events, lineups and stats every 2 minutes.`, '/stats/jobs?job=pro-live');

  // Stat accuracy: an agreement rate under its target (enough rows compared to mean something).
  const low = (i.audits ?? []).filter((a) => a.target != null && a.compared >= 20 && a.rate < a.target);
  for (const a of low) add('warn', `audit:${a.check_key}`, `${a.label} below target`, `${(a.rate * 100).toFixed(1)}% agree of ${a.compared.toLocaleString('en-US')} compared; the target is ${Math.round(a.target! * 100)}%.`, '/stats/quality');

  // Memory: the heap near its limit means an out-of-memory restart is close (the site goes down for a minute or two).
  const m = i.memory;
  if (m && m.heap_limit_mb > 0 && m.heap_mb / m.heap_limit_mb > 0.85) add('warn', 'health:memory', 'Stats service memory nearly full', `Heap ${m.heap_mb.toLocaleString('en-US')} of ${m.heap_limit_mb.toLocaleString('en-US')} MB (${Math.round((m.heap_mb / m.heap_limit_mb) * 100)}%). Past the limit the service restarts.`, '/stats/service#health');

  // Computed data: the site's ratings, odds, Elo, RPI, leaders and referees left behind their cadence.
  const inSeason = new Date(i.now).getUTCMonth() >= 7;
  for (const [job, c] of Object.entries(COMPUTED_CADENCE)) {
    const every = inSeason ? c.season : c.off;
    const e = i.scheduler.entries.find((x) => x.job === job);
    const doneAt = i.rollup[job]?.last_done?.finished_at;
    if (every == null || (e && !e.enabled) || i.scheduler.paused || !doneAt) continue;
    const age = ago(i.now, doneAt);
    if (age > every * 2 * 3600_000) add('warn', `computed:stale:${job}`, `${c.label} out of date`, `Last worked ${mins(age)} ago; it runs every ${every < 1 ? `${Math.round(every * 60)} min` : `${every} h`}.`, '/stats/coverage');
  }

  const t = i.traffic;
  if (t.views_prev_7d >= 50 && t.views_7d < t.views_prev_7d * 0.6) add('warn', 'traffic:drop', 'Site traffic down', `${t.views_7d.toLocaleString('en-US')} page views in the last 7 days, ${Math.round((1 - t.views_7d / t.views_prev_7d) * 100)}% fewer than the 7 days before.`, '/stats/traffic');
  if (t.zero_searches_7d >= 5) add('info', 'search:zero', `${t.zero_searches_7d} searches found nothing this week`, 'What visitors looked for and did not find: content to add.', '/stats/traffic#searches');

  // News: a publisher, GDELT, Guardian, club or federation source that keeps failing, or school feeds failing at scale.
  for (const n of i.news ?? []) {
    if (!n.failing) continue;
    if (n.kind === 'school') { if (n.on >= 20 && n.failing / n.on > 0.2) add('warn', 'news:schools', `${n.failing} of ${n.on} school news feeds failing`, 'Their athletics sites stopped answering the feed. The rest keep coming in.', '/stats/crawling?part=pro'); }
    else add('warn', `news:${n.kind}`, `${n.name} news ${n.failing === 1 ? 'feed' : `feeds (${n.failing})`} failing`, 'No stories read from it for a day. See its card on Crawling; switch it off in Settings if it moved.', '/stats/crawling?part=pro');
  }

  const rank: Record<Level, number> = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** US-scene pro matches in play for 15+ minutes that have no events stored. */
export async function proLiveStale(db: Db, now = Date.now()): Promise<NonNullable<AttentionInput['pro_live_stale']>> {
  const { data } = await db.from('pro_fixtures').select('id,kickoff,league_id,slug').eq('status', 'live').lte('kickoff', new Date(now - 15 * 60_000).toISOString());
  const rows = (data ?? []) as any[];
  const { data: lg } = rows.length ? await db.from('pro_leagues').select('id,country').in('id', [...new Set(rows.map((f) => f.league_id))]) : { data: [] };
  const country = new Map(((lg ?? []) as any[]).map((l) => [l.id, l.country]));
  const live = rows.filter((f) => isUsScene(f.league_id, country.get(f.league_id)));
  if (!live.length) return { count: 0, live: 0, names: [] };
  const { data: ev } = await db.from('pro_fixture_events').select('fixture_id').in('fixture_id', live.map((f) => f.id));
  const has = new Set(((ev ?? []) as any[]).map((e) => e.fixture_id));
  const stale = live.filter((f) => !has.has(f.id));
  return { count: stale.length, live: live.length, names: stale.map((f) => String(f.slug).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')) };
}

/** The newest stat-audit row per check (the last week's runs; none before migration 182). */
export async function latestAudits(db: Db): Promise<NonNullable<AttentionInput['audits']>> {
  const { data, error } = await db.from('stat_audit_runs').select('check_key,label,rate,target,compared,run_at').gte('run_at', new Date(Date.now() - 7 * 86400_000).toISOString()).order('run_at', { ascending: false }).limit(500);
  if (error) return [];
  const seen = new Map<string, any>(); for (const r of data ?? []) if (!seen.has(r.check_key)) seen.set(r.check_key, r);
  return [...seen.values()].map((r) => ({ check_key: r.check_key, label: r.label, rate: Number(r.rate), target: r.target == null ? null : Number(r.target), compared: r.compared }));
}

/** News sources by kind (publishers one by one): how many are on and how many keep failing (3+ failures, nothing for a day). */
export function newsGroups(rows: { kind: string; name: string; enabled: boolean; fails: number; last_ok_at: string | null }[], now = Date.now()): NonNullable<AttentionInput['news']> {
  const failing = (r: (typeof rows)[number]) => r.fails >= 3 && (!r.last_ok_at || now - Date.parse(r.last_ok_at) > 86400_000);
  const out = new Map<string, { kind: string; name: string; on: number; failing: number }>();
  for (const r of rows) {
    const key = r.kind === 'school' ? 'school' : r.kind === 'publisher' ? `publisher:${r.name}` : r.kind === 'gdelt' ? 'gdelt' : r.kind;
    const name = r.kind === 'school' ? 'School' : r.kind === 'gdelt' ? 'GDELT' : r.kind === 'club' ? 'Club' : r.kind === 'federation' ? 'Federation' : r.name;
    const g = out.get(key) ?? { kind: r.kind, name, on: 0, failing: 0 };
    g.on += 1; if (failing(r)) g.failing += 1;
    out.set(key, g);
  }
  return [...out.values()];
}

/** The content counts charted day by day. Cheap: the world numbers come from their 5-minute cache. */
export async function contentCounts(db: Db): Promise<Record<string, number>> {
  const season = currentSeason();
  const n = (t: string, f?: (q: any) => any, mode: 'exact' | 'estimated' = 'exact') => { let q = db.from(t).select('*', { count: mode, head: true }); if (f) q = f(q); return q.then((r: { count: number | null }) => r.count ?? 0); };
  const [world, games, finals, boxed, programs, links, predictions, americans, newsTotal, newsLinked] = await Promise.all([
    worldCoverage(db),
    n('college_games', (q) => q.eq('season', season)),
    n('college_games', (q) => q.eq('season', season).eq('status', 'final')),
    n('college_games', (q) => q.eq('season', season).eq('status', 'final').not('source_of_truth', 'is', null)),
    n('college_program_seasons', (q) => q.eq('season', season).eq('ncaa_member', true)),
    n('pro_college_links', (q) => q.eq('rejected', false).or('verified.eq.true,confidence.gte.0.85')),
    n('pro_fixture_predictions', undefined, 'estimated'),
    n('pro_players', (q) => q.eq('american', true), 'estimated'),
    n('news_articles', (q) => q.gte('fetched_at', new Date(Date.now() - 86400_000).toISOString())),
    db.from('news_links').select('article_id', { count: 'exact', head: true }).eq('is_primary', true).gte('published_at', new Date(Date.now() - 86400_000).toISOString()).then((r: { count: number | null }) => r.count ?? 0),
  ]);
  return {
    college_games: games, college_finals: finals, college_finals_with_box: boxed, college_programs: programs,
    college_box_pct: finals ? Math.round((boxed / finals) * 1000) / 10 : 0,
    pro_finals: world?.finals ?? 0, pro_finals_detailed: world?.finals_detailed ?? 0,
    pro_detail_pct: world?.finals ? Math.round((world.finals_detailed / world.finals) * 1000) / 10 : 0,
    pro_players_with_stats: world?.players_with_season_stats ?? 0, pro_clubs_with_squad: world?.clubs_with_squad ?? 0,
    pro_leagues_live: world?.leagues_current_with_fixtures ?? 0, pro_transfers: world?.transfers ?? 0,
    college_to_pro_links: links, predictions, americans, db_bytes: world?.db_bytes ?? 0,
    news_stories_24h: newsTotal, news_linked_24h: newsLinked,
  };
}

/** Today's row in stats_daily_counts (the last write of the day stands). Called by pro-rank daily and by insights hourly. */
export async function saveDailyCounts(db: Db): Promise<void> {
  const counts = await contentCounts(db);
  const { error } = await db.from('stats_daily_counts').upsert({ day: new Date().toISOString().slice(0, 10), counts, taken_at: new Date().toISOString() });
  if (error) throw new Error(`stats_daily_counts: ${error.message}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const humanize = (slug: string) => slug.replace(/-\d+$/, '').split('-').filter(Boolean).map((w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');

/** Readable names for the top pages: college teams and players by id, pro pages by slug. */
async function pageTitles(db: Db, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const ids = (re: RegExp) => [...new Set(paths.map((p) => p.match(re)?.[1]).filter((x): x is string => !!x && UUID.test(x)))];
  const teamIds = ids(/^\/teams\/([^/]+)$/), playerIds = ids(/^\/players\/([^/]+)$/);
  const slugs = (re: RegExp) => [...new Set(paths.map((p) => p.match(re)?.[1]).filter((x): x is string => !!x))];
  const proPlayers = slugs(/^\/pro\/players\/([^/]+)$/), proTeams = slugs(/^\/pro\/teams\/([^/]+)$/), proLeagues = slugs(/^\/pro\/leagues\/([^/]+)$/);
  const [t, p, pp, pt, pl] = await Promise.all([
    teamIds.length ? db.from('college_programs').select('id,name,gender').in('id', teamIds) : null,
    playerIds.length ? db.from('college_players').select('id,display_name').in('id', playerIds) : null,
    proPlayers.length ? db.from('pro_players').select('slug,display_name,name').in('slug', proPlayers) : null,
    proTeams.length ? db.from('pro_teams').select('slug,display_name,name').in('slug', proTeams) : null,
    proLeagues.length ? db.from('pro_leagues').select('slug,name,country').in('slug', proLeagues) : null,
  ]);
  for (const r of (t?.data ?? []) as any[]) out[`/teams/${r.id}`] = `${r.name} (${r.gender === 'w' ? 'women' : 'men'})`;
  for (const r of (p?.data ?? []) as any[]) out[`/players/${r.id}`] = r.display_name;
  for (const r of (pp?.data ?? []) as any[]) out[`/pro/players/${r.slug}`] = r.display_name ?? r.name;
  for (const r of (pt?.data ?? []) as any[]) out[`/pro/teams/${r.slug}`] = r.display_name ?? r.name;
  for (const r of (pl?.data ?? []) as any[]) out[`/pro/leagues/${r.slug}`] = r.country ? `${r.name} (${r.country})` : r.name;
  for (const path of paths) {
    if (out[path]) continue;
    const m = path.match(/^\/(?:pro\/)?(?:matches|teams|players|leagues|countries|conferences)\/(.+)$/);
    if (path === '/') out[path] = 'Home';
    else if (m && !UUID.test(m[1]!)) out[path] = humanize(m[1]!.replace(/\//g, ' '));
  }
  return out;
}

type Traffic = {
  days: { day: string; uniques: number; views: number }[]; pages: { path: string; page_group: string; views: number; title?: string }[];
  groups: { page_group: string; views: number }[]; referrers: { host: string; views: number }[]; devices: { device: string; views: number }[];
  searches: { scope: string; query: string; searches: number; zero_results: number }[]; zero: { scope: string; query: string; searches: number; last_day: string }[];
  search_days: { day: string; searches: number; zero_results: number }[]; section_days: { day: string; college: number | null; pro: number | null; intl?: number | null }[];
};

const sumSince = (rows: { day: string; views: number }[], from: number, to: number) => rows.filter((r) => { const t = Date.parse(r.day); return t >= from && t < to; }).reduce((n, r) => n + r.views, 0);

async function build(db: Db, days: number, startedAt: number) {
  const cfg = loadConfig();
  const now = Date.now();
  const season = currentSeason();
  const since = new Date(now - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const render = cfg.RENDER_API_KEY && cfg.RENDER_SERVICE_ID ? new RenderClient(cfg.RENDER_API_KEY, cfg.RENDER_SERVICE_ID) : null;
  const n = (t: string, f: (q: any) => any) => f(db.from(t).select('*', { count: 'exact', head: true })).then((r: { count: number | null }) => r.count ?? 0);

  const [h, sched, rollup, paused, traffic, traffic14, usage, growth, quota, progress, proRuns, live, liveFresh, running, queued, quality, agreement, deploys, world, stages, newsSources, audits, proStale] = await Promise.all([
    serviceHealth(db, startedAt),
    scheduleState(db),
    jobRollup(db),
    crawlPaused(db),
    db.rpc('stats_traffic', { p_days: days }).then((r) => (r.data ?? null) as Traffic | null),
    days >= 14 ? Promise.resolve(null) : db.rpc('stats_traffic', { p_days: 14 }).then((r) => (r.data ?? null) as Traffic | null),
    usageStored(db, days),
    selectAll<{ day: string; counts: Record<string, number> }>(db, 'stats_daily_counts', 'day,counts', (q) => q.gte('day', since).order('day', { ascending: true })),
    kvGet<QuotaState & { saved_at?: string }>(db, PRO_QUOTA_KEY),
    db.rpc('pro_crawl_progress').then((r) => (r.data ?? []) as ProgressRow[]),
    selectAll<RunCounters>(db, 'college_crawl_runs', 'job,finished_at,counters', (q) => q.like('job', 'pro-%').gte('finished_at', new Date(now - 7 * 86400_000).toISOString())),
    n('college_games', (q) => q.eq('season', season).eq('status', 'live').gte('game_date', new Date(now - 36 * 3600_000).toISOString().slice(0, 10)).lte('game_date', new Date(now + 36 * 3600_000).toISOString().slice(0, 10))),
    n('college_games', (q) => q.eq('season', season).eq('status', 'live').gte('live_stats_at', new Date(now - 5 * 60_000).toISOString())),
    db.from('college_crawl_runs').select('id,job,heartbeat_at,started_at').eq('status', 'running').then((r) => (r.data ?? []) as { id: string; job: string; heartbeat_at: string | null; started_at: string | null }[]),
    n('college_crawl_runs', (q) => q.eq('status', 'queued')),
    db.from('college_quality_snapshots').select('taken_at,checks').eq('season', season).order('taken_at', { ascending: false }).limit(2).then((r) => (r.data ?? []) as { taken_at: string; checks: { id: string; label?: string; count: number }[] }[]),
    db.rpc('pro_source_agreement').then((r) => (r.data ?? []) as { source: string; league_id: number; season: number; agree: number; differ: number }[]),
    render ? render.deploys(1).catch(() => [] as RenderDeploy[]) : Promise.resolve([] as RenderDeploy[]),
    worldCoverage(db),
    db.rpc('college_sync_progress', { p_season: season }).then((r) => (r.data ?? []) as any[]),
    selectAll<{ kind: string; name: string; enabled: boolean; fails: number; last_ok_at: string | null }>(db, 'news_sources', 'kind,name,enabled,fails,last_ok_at', (q) => q.eq('enabled', true)).catch(() => []),
    latestAudits(db),
    proLiveStale(db, now),
  ]);

  // Traffic: names for the top pages, and this week against last week.
  const t: Traffic = traffic ?? { days: [], pages: [], groups: [], referrers: [], devices: [], searches: [], zero: [], search_days: [], section_days: [] };
  const titles = await pageTitles(db, t.pages.map((p) => p.path)).catch(() => ({} as Record<string, string>));
  t.pages = t.pages.map((p) => ({ ...p, title: titles[p.path] }));
  const dayRows = (traffic14 ?? t).days;
  const today0 = Date.parse(new Date(now).toISOString().slice(0, 10));
  const views7 = sumSince(dayRows, today0 - 6 * 86400_000, today0 + 86400_000), viewsPrev7 = sumSince(dayRows, today0 - 13 * 86400_000, today0 - 6 * 86400_000);
  const zero7 = (traffic14 ?? t).search_days.filter((d) => Date.parse(d.day) > today0 - 7 * 86400_000).reduce((s, d) => s + d.zero_results, 0);

  // API use per day by kind of caller: the site's own reads, keyless /v1, named keys, the owner.
  const apiDays = new Map<string, { day: string; site: number; anon: number; keys: number; admin: number; limited: number }>();
  const byPrincipal = new Map<string, number>();
  for (const u of usage) {
    const d = apiDays.get(u.day) ?? { day: u.day, site: 0, anon: 0, keys: 0, admin: 0, limited: 0 };
    const k = u.principal === 'site' ? 'site' : u.principal === 'anon' ? 'anon' : u.principal === 'admin' ? 'admin' : 'keys';
    d[k] += u.requests; d.limited += u.limited;
    apiDays.set(u.day, d);
    byPrincipal.set(u.principal, (byPrincipal.get(u.principal) ?? 0) + u.requests);
  }

  // Pro crawl: tasks left and how many days that is at the recent pace.
  const kinds = byKind(progress);
  const left = kinds.reduce((s, k) => s + k.calls_left, 0), tasks = kinds.reduce((s, k) => s + k.tasks, 0), done = kinds.reduce((s, k) => s + k.done, 0);
  const perDay = callsPerDay(proRuns, 7);
  const budget = Math.max(0, (quota?.limit ?? 7500) - cfg.PRO_BACKFILL_RESERVE);

  // Source agreement per league season (the same sums as the Quality tab).
  const agreeBy = new Map<string, { source: string; league_id: number; season: number; agree: number; differ: number }>();
  for (const a of agreement) { const k = `${a.source}|${a.league_id}|${a.season}`; const x = agreeBy.get(k) ?? { source: a.source, league_id: a.league_id, season: a.season, agree: 0, differ: 0 }; x.agree += Number(a.agree); x.differ += Number(a.differ); agreeBy.set(k, x); }
  const leagueIds = [...new Set([...agreeBy.values()].map((a) => a.league_id))];
  const leagueNames = new Map(leagueIds.length ? ((await db.from('pro_leagues').select('id,name').in('id', leagueIds)).data ?? []).map((l: any) => [l.id as number, l.name as string]) : []);
  const sources = [...agreeBy.values()].map((a) => ({ source: a.source, league: leagueNames.get(a.league_id) ?? String(a.league_id), season: a.season, compared: a.agree + a.differ, rate: a.agree + a.differ ? a.agree / (a.agree + a.differ) : 1 }));

  const [latestQ, prevQ] = quality;
  const prevCount = new Map((prevQ?.checks ?? []).map((c) => [c.id, c.count]));
  const deploy = deploys[0] ? { status: deploys[0].status, commit: deploys[0].commit?.id ?? null, message: deploys[0].commit?.message?.split('\n')[0] ?? null, at: deploys[0].finishedAt ?? deploys[0].createdAt } : null;
  const quotaOut = quota ? { key_set: !!cfg.API_FOOTBALL_KEY, remaining: quota.remaining, limit: quota.limit, used_today: quota.day === new Date(now).toISOString().slice(0, 10) ? quota.usedToday : 0, blocked_until: quota.blockedUntil, floor: cfg.PRO_RESERVE, crawl_floor: cfg.PRO_BACKFILL_RESERVE, at: quota.at } : null;

  const attention = attentionFrom({
    now, health: h, scheduler: { enabled: sched.enabled, paused: sched.paused, tick_at: sched.tick_at, entries: sched.entries },
    rollup, crawl_paused: paused, running: running.map((r) => ({ id: r.id, job: r.job, heartbeat_at: r.heartbeat_at ?? r.started_at })),
    quota: quotaOut ? { key_set: quotaOut.key_set, remaining: quotaOut.remaining, limit: quotaOut.limit, blocked_until: quotaOut.blocked_until, floor: quotaOut.floor } : null,
    live: { games_live: live, with_fresh_stats: liveFresh },
    quality: (latestQ?.checks ?? []).map((c) => ({ id: c.id, label: c.label, count: c.count, previous: prevCount.get(c.id) ?? null })),
    sources, deploy, traffic: { views_7d: views7, views_prev_7d: viewsPrev7, zero_searches_7d: zero7 },
    news: newsGroups(newsSources, now),
    audits,
    pro_live_stale: proStale,
    requests: await openRequests(db),
    memory: heapNow(),
  });

  const lanes = Object.values(h.lanes);
  const collegeTotals = stages.reduce((a: Record<string, number>, r: any) => { for (const k of ['programs', 'roster', 'schedule', 'stats', 'boxscores', 'failing']) a[k] = (a[k] ?? 0) + Number(r[k] ?? 0); return a; }, {} as Record<string, number>);
  return {
    generated_at: new Date(now).toISOString(), days, season,
    health: {
      ok: h.ok, problems: h.problems, lanes_alive: lanes.filter((l) => l.alive).length, lanes_total: lanes.length,
      scheduler: { enabled: sched.enabled, paused: sched.paused, tick_at: sched.tick_at }, crawl_paused: paused,
      queue: { queued, running: running.length }, deploy, quota: quotaOut,
    },
    attention,
    traffic: { ...t, views_7d: views7, views_prev_7d: viewsPrev7 },
    api: { days: [...apiDays.values()].sort((a, b) => a.day.localeCompare(b.day)), by_principal: [...byPrincipal].map(([principal, requests]) => ({ principal, requests })).sort((a, b) => b.requests - a.requests) },
    growth: growth.map((g) => ({ day: g.day, ...g.counts })),
    coverage: {
      college: { season, by_division: stages, totals: collegeTotals },
      pro: { tasks, done, pct: tasks ? Math.round((done / tasks) * 1000) / 10 : 0, calls_left: left, eta_days: etaDays(left, perDay, budget), calls_per_day: perDay, world },
    },
    live: { games_live: live, with_fresh_stats: liveFresh },
  };
}

export type Insights = Awaited<ReturnType<typeof build>>;

const cache = new Map<number, { at: number; data: Insights }>();
const inflight = new Map<number, Promise<Insights>>();
let countsSavedAt = 0;

/** The cached answer for a range (7, 30 or 90 days): fresh for a minute, then served stale while a refresh runs. */
export async function insights(db: Db, days: number, startedAt: number): Promise<Insights> {
  const d = [7, 30, 90].includes(days) ? days : 30;
  const refresh = () => {
    let p = inflight.get(d);
    if (!p) {
      p = build(db, d, startedAt).then((data) => { cache.set(d, { at: Date.now(), data }); return data; }).finally(() => inflight.delete(d));
      inflight.set(d, p);
    }
    return p;
  };
  // Today's content counts, at most hourly (pro-rank writes the row daily too, for days nobody opens the hub).
  if (Date.now() - countsSavedAt > 3600_000) { countsSavedAt = Date.now(); void saveDailyCounts(db).catch(() => { countsSavedAt = 0; }); }
  const hit = cache.get(d);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  if (hit) { void refresh().catch(() => {}); return hit.data; }
  return refresh();
}

/** This process's heap in MB (the web server and every worker lane share it). */
function heapNow(): NonNullable<AttentionInput['memory']> {
  const h = getHeapStatistics();
  return { heap_mb: Math.round(h.used_heap_size / 1e6), heap_limit_mb: Math.round(h.heap_size_limit / 1e6) };
}

/** Open requests from the public corrections / removal form (migration 192). */
async function openRequests(db: Db): Promise<AttentionInput['requests']> {
  const { data } = await db.from('stats_requests').select('kind,created_at').eq('status', 'open').order('created_at').limit(200);
  const rows = (data ?? []) as { kind: string; created_at: string }[];
  return { open: rows.length, oldest: rows[0]?.created_at ?? null, removal: rows.filter((r) => r.kind === 'removal' || r.kind === 'privacy').length };
}
