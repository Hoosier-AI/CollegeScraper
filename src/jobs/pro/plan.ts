// pro-plan: decides what the crawl should hold, as rows in pro_crawl_tasks (no API requests). Every run gives every
// planned task its priority, refresh interval and tier (progress and due dates are kept). The US scene comes first and
// in full: every US competition (pro, pre-pro and amateur) and the international ones US clubs play in, every season
// the provider has, every club that ever played in them, and the people at those clubs. Then everyone else, as before:
// the top competitions, other leagues, cups, then history.
//   tiers: 0 everyone (countries, clubs, profiles), 1 US scene, 2 top competitions (priority under 100), 3 other
//   leagues, 4 cups
//   US priorities 11-19, by what a request buys: current match detail (20 matches a request), fixtures, tables,
//   injuries and grounds; past match detail, current squads and transfers; past fixtures and tables; current season
//   totals (paged) and club season stats; past totals and club season stats; coaches and former clubs; injury history
//   and trophies; coach trophies and new players' profiles
// pro-crawl: drains the queue on the pro-bulk lane, within the backfill quota floor and a time budget.
// pro-rank: nightly recent minutes, indexable, current club and number (pro_refresh_player_rank).
import { registerJob, type JobContext } from '../runner.js';
import { selectAll, type Db } from '../../db/client.js';
import { insertTasks, leagueIndex, rescheduleTasks, type LeagueInfo, type TaskSeed } from '../../db/proRepo.js';
import { isUsScene } from '../../sources/apiFootball/leagues.js';
import { asaCovers } from '../../sources/asa/leagues.js';
import { QuotaExhausted } from '../../sources/apiFootball/client.js';
import { handlerFor, Pace, type TaskRow } from './tasks.js';
import { SCRAPED_TABLE_SOURCES } from '../../db/proRepo.js';
import { withApi } from './shared.js';
import { log } from '../../log.js';

export type Tier = 0 | 1 | 2 | 3 | 4;
type LeagueTierInfo = Pick<LeagueInfo, 'id' | 'country' | 'priority' | 'type'>;
export const tierOf = (l: LeagueTierInfo): Tier =>
  isUsScene(l.id, l.country) ? 1 : l.priority < 100 ? 2 : l.type === 'league' && l.priority < 600 ? 3 : 4;
/** Tier 2, 3 or 4: the old three-way split for everything outside the US scene. */
const by = <T>(tier: Tier, top: T, league: T, cup: T): T => (tier <= 2 ? top : tier === 3 ? league : cup);

/** playerLines: API-Football has per-player match stats for the season (its match detail fills cards, tackles, ratings). */
export interface SeasonCoverage { season: number; standings: boolean; players: boolean; injuries: boolean; playerLines?: boolean }
export interface PlanInput {
  leagues: Map<number, LeagueInfo>;
  /** League id -> seasons the provider has, with what it covers. */
  seasons: Map<number, SeasonCoverage[]>;
  /** Which clubs played in which league season (all seasons crawled so far). */
  leagueTeams: { league_id: number; season: number; team_id: number }[];
  /** Players with minutes in a top competition's current or last season (trophies, injury history). */
  topPlayers: number[];
  /** Players with minutes in a US-scene competition's current or last season. */
  usPlayers?: number[];
  /** Coaches who have managed a US club. */
  usCoaches?: number[];
  /** Country names (grounds). */
  countries?: string[];
  /** Players first seen since the last full profile pass, with no profile yet. */
  newPlayers: number[];
  /** "league|season" of finished seasons whose table a scraped source (Wikipedia) supplies: no API-Football table. */
  sourceTables?: Set<string>;
}

/**
 * US clubs: every club that has played in a competition in the USA, in any season. An international competition
 * (Leagues Cup, CONCACAF) does not make a Mexican or Canadian club a US one.
 */
export function usClubsOf(leagues: Map<number, LeagueInfo>, leagueTeams: PlanInput['leagueTeams']): Set<number> {
  const out = new Set<number>();
  for (const lt of leagueTeams) if (leagues.get(lt.league_id)?.country === 'USA') out.add(lt.team_id);
  return out;
}

/** Every task the crawl should have. Pure. */
export function planTasks(input: PlanInput): TaskSeed[] {
  const out = new Map<string, TaskSeed>();
  let tierNow: Tier = 0;
  const add = (kind: string, key: string | number, priority: number, every_days: number | null) => {
    const k = `${kind}|${key}`;
    const prev = out.get(k);
    if (!prev || priority < prev.priority) out.set(k, { kind, key: String(key), priority, every_days, tier: tierNow });
  };
  add('countries', 'all', 1, 30);
  add('profiles_page', 1, 10, 30);

  const live = [...input.leagues.values()].filter((l) => l.enabled && l.current_season != null);
  const usClubs = usClubsOf(input.leagues, input.leagueTeams);
  const teamsOf = new Map<string, number[]>();
  for (const lt of input.leagueTeams) { const k = `${lt.league_id}|${lt.season}`; teamsOf.set(k, [...(teamsOf.get(k) ?? []), lt.team_id]); }

  // ---------- the US scene: every season the provider has ----------
  tierNow = 1;
  add('venues', 'USA', 11, 90);
  const activePro = new Set<number>(); const active = new Set<number>();
  for (const l of live) {
    if (tierOf(l) !== 1) continue;
    const c = l.current_season!; const pro = l.kind === 'pro';
    const k = (s: number) => `${l.id}|${s}`;
    const cov = new Map((input.seasons.get(l.id) ?? []).map((s) => [s.season, s]));
    const now = cov.get(c);
    // A club's season stats: every club of a US competition; in an international one, the US clubs.
    // Season totals: American Soccer Analysis has minutes, goals, assists, shots and more for the leagues it covers;
    // with API-Football's match lines filling the rest, its paged totals are not needed there.
    const needTotals = (s: number) => !(asaCovers(l.id, s) && cov.get(s)?.playerLines === true);
    const statClubs = (s: number) => (teamsOf.get(k(s)) ?? []).filter((t) => l.country === 'USA' ? l.type === 'league' : usClubs.has(t));
    add('season_fixtures', k(c), 11, 3);
    // The table, every day (the scoreboard job also refreshes it after each final).
    if (now?.standings !== false) add('standings', k(c), 11, 1);
    if (now?.injuries !== false) add('injuries', k(c), 11, 1);
    // Match detail first: 20 matches a request, and it fills match logs, lineups, events, cards, ratings and club stats.
    add('detail', k(c), 11, 1);
    if (now?.players !== false && needTotals(c)) add('league_players', k(c), 14, pro ? 3 : 7);
    for (const t of statClubs(c)) add('team_stats', `${k(c)}|${t}`, 14, pro ? 7 : 30);
    for (const t of teamsOf.get(k(c)) ?? []) { if (!usClubs.has(t)) continue; active.add(t); if (pro) activePro.add(t); }
    for (const s of input.seasons.get(l.id) ?? []) {
      if (s.season >= c) continue;
      add('detail', k(s.season), 12, null);
      add('season_fixtures', k(s.season), 13, null);
      if (s.standings && !input.sourceTables?.has(k(s.season))) add('standings', k(s.season), 13, null);
      if (s.players && needTotals(s.season)) add('league_players', k(s.season), 15, null);
      for (const t of statClubs(s.season)) add('team_stats', `${k(s.season)}|${t}`, 15, null);
    }
  }
  for (const team of usClubs) {
    add('squad', team, active.has(team) ? 12 : 17, activePro.has(team) ? 3 : active.has(team) ? 30 : 90);
    add('transfers', team, active.has(team) ? 12 : 17, activePro.has(team) ? 7 : 60);
    add('coach', team, 17, activePro.has(team) ? 30 : 90);
  }
  for (const p of input.usPlayers ?? []) { add('sidelined', p, 18, 60); add('trophies', p, 18, 90); }
  for (const c of input.usCoaches ?? []) add('coach_trophies', c, 19, 180);
  tierNow = 0;
  for (const id of input.newPlayers) add('profile', id, 19, null);

  // ---------- everyone else: current seasons, then history ----------
  for (const l of live) {
    const tier = tierOf(l);
    if (tier === 1) continue;
    tierNow = tier; const c = l.current_season!;
    const k = (s: number) => `${l.id}|${s}`;
    add('season_fixtures', k(c), by(tier, 20, 40, 60), by(tier, 7, 7, 14));
    const nowCov = (input.seasons.get(l.id) ?? []).find((x) => x.season === c);
    if (nowCov?.standings !== false) add('standings', k(c), by(tier, 21, 41, 61), by(tier, 2, 7, 7));
    add('league_players', k(c), by(tier, 30, 70, 110), by(tier, 7, 14, 30));
    add('detail', k(c), by(tier, 22, 42, 62), 7);
    if (tier === 2) {
      add('injuries', k(c), 25, 1);
      for (const t of teamsOf.get(k(c)) ?? []) add('team_stats', `${k(c)}|${t}`, 90, 14);
    }
    const detailDepth = tier === 2 ? 4 : 2;
    for (const s of input.seasons.get(l.id) ?? []) {
      const back = c - s.season;
      if (back <= 0) continue;
      if (back <= detailDepth) {
        add('season_fixtures', k(s.season), by(tier, 45, 130, 150), null);
        if (s.standings && !input.sourceTables?.has(k(s.season))) add('standings', k(s.season), by(tier, 46, 131, 151), null);
        add('detail', k(s.season), back === 1 ? by(tier, 50, 140, 160) : tier === 2 ? 170 : 180, null);
      }
      if (back <= 2) add('league_players', k(s.season), tier === 2 ? 200 : 220, null);
      else if (tier === 2 && s.season >= 2015) add('league_players', k(s.season), 300, null);
    }
  }

  // Other clubs: the best tier among their current competitions (an international one counts as a top competition)
  // decides how often their squad, transfers and coach are read.
  const teamTier = new Map<number, Tier>();
  for (const lt of input.leagueTeams) {
    const l = input.leagues.get(lt.league_id);
    if (!l?.enabled || lt.season !== l.current_season || usClubs.has(lt.team_id)) continue;
    const t = Math.max(2, tierOf(l)) as Tier;
    teamTier.set(lt.team_id, Math.min(teamTier.get(lt.team_id) ?? 4, t) as Tier);
  }
  for (const [team, tier] of teamTier) {
    tierNow = tier;
    add('squad', team, by(tier, 35, 80, 120), by(tier, 7, 30, 30));
    add('transfers', team, by(tier, 55, 150, 190), by(tier, 7, 60, 60));
    add('coach', team, by(tier, 58, 155, 195), by(tier, 30, 90, 90));
  }
  tierNow = 2;
  for (const p of input.topPlayers) { add('trophies', p, 400, 90); add('sidelined', p, 410, 90); }
  tierNow = 0;
  for (const c of input.countries ?? []) if (c !== 'USA') add('venues', c, 100, 180);
  return [...out.values()];
}

/** `.in()` over many ids, a few hundred at a time (the filter travels in the URL). */
async function selectIn<T>(db: Db, table: string, columns: string, column: string, ids: number[], apply?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const part = ids.slice(i, i + 300);
    out.push(...await selectAll<T>(db, table, columns, (q) => (apply ? apply(q.in(column, part)) : q.in(column, part))));
  }
  return out;
}

/** Players with minutes in these competitions' current or last season. */
async function playersIn(db: Db, leagues: LeagueInfo[]): Promise<number[]> {
  if (!leagues.length) return [];
  const rows = await selectAll<{ player_id: number }>(db, 'pro_player_season_stats', 'player_id',
    (q) => q.in('league_id', leagues.map((l) => l.id)).gte('season', Math.min(...leagues.map((l) => l.current_season! - 1))).gt('minutes', 0));
  return [...new Set(rows.map((r) => r.player_id).filter((id) => id > 0))];
}

export async function proPlan(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const leagues = await leagueIndex(db);
  const enabled = new Set([...leagues.values()].filter((l) => l.enabled).map((l) => l.id));
  const seasonRows = await selectAll<{ league_id: number; season: number; coverage: { standings?: boolean; players?: boolean; injuries?: boolean; fixtures?: { statistics_players?: boolean }; source?: string } | null }>(db, 'pro_seasons', 'league_id,season,coverage');
  const seasons = new Map<number, SeasonCoverage[]>();
  for (const r of seasonRows) {
    if (!enabled.has(r.league_id)) continue;
    const c = r.coverage ?? {};
    // A season filled from another source (history API-Football does not have): nothing to ask it for.
    if (c.source) continue;
    seasons.set(r.league_id, [...(seasons.get(r.league_id) ?? []), { season: r.season, standings: c.standings !== false, players: c.players !== false, injuries: c.injuries !== false, playerLines: c.fixtures?.statistics_players === true }]);
  }
  const leagueTeams = await selectAll<{ league_id: number; season: number; team_id: number }>(db, 'pro_league_teams', 'league_id,season,team_id');
  const live = [...leagues.values()].filter((l) => l.enabled && l.current_season != null);
  const usClubs = [...usClubsOf(leagues, leagueTeams)];
  const careers = await selectIn<{ coach_id: number }>(db, 'pro_coach_career', 'coach_id', 'team_id', usClubs);
  const current = await selectIn<{ id: number }>(db, 'pro_coaches', 'id', 'team_id', usClubs);
  const countries = await selectAll<{ name: string }>(db, 'pro_countries', 'name');
  const { data: fresh } = await db.from('pro_players').select('id').is('profile_synced_at', null).order('created_at', { ascending: false }).limit(500);
  // Finished seasons a scraped source has the table of: API-Football's is not needed (sources first).
  const sourceTables = new Set((await selectAll<{ league_id: number; season: number }>(db, 'pro_standings', 'league_id,season', (q) => q.in('source', SCRAPED_TABLE_SOURCES)))
    .filter((r) => r.season < (leagues.get(r.league_id)?.current_season ?? 9999)).map((r) => `${r.league_id}|${r.season}`));
  const seeds = planTasks({
    leagues, seasons, leagueTeams,
    topPlayers: await playersIn(db, live.filter((l) => tierOf(l) === 2)),
    usPlayers: await playersIn(db, live.filter((l) => tierOf(l) === 1)),
    usCoaches: [...new Set([...careers.map((r) => r.coach_id), ...current.map((r) => r.id)])],
    countries: countries.map((c) => c.name),
    newPlayers: ((fresh ?? []) as { id: number }[]).map((r) => r.id),
    sourceTables,
  });
  ctx.inc('planned', seeds.length);
  ctx.inc('planned_us', seeds.filter((t) => t.tier === 1).length);
  // New tasks are added; existing ones get their priority, interval and tier (their schedule and progress stay).
  ctx.inc('sent', await insertTasks(db, seeds));
  ctx.inc('rescheduled', await rescheduleTasks(db));
  // US season totals another source now covers: drop the ones never run (a done one stays as a record).
  const planned = new Set(seeds.filter((t) => t.kind === 'league_players').map((t) => t.key));
  const stale = (await selectAll<{ key: string }>(db, 'pro_crawl_tasks', 'key', (q) => q.eq('kind', 'league_players').eq('tier', 1).is('last_done_at', null))).map((r) => r.key).filter((k) => !planned.has(k));
  for (let i = 0; i < stale.length; i += 200) {
    const { error } = await db.from('pro_crawl_tasks').delete().eq('kind', 'league_players').in('key', stale.slice(i, i + 200));
    if (error) throw new Error(`prune totals: ${error.message}`);
  }
  ctx.inc('pruned', stale.length);
  // Table tasks never run for seasons a scraped table now covers.
  const tableKeys = (await selectAll<{ key: string }>(db, 'pro_crawl_tasks', 'key', (q) => q.eq('kind', 'standings').is('last_done_at', null))).map((r) => r.key).filter((key) => sourceTables.has(key));
  for (let i = 0; i < tableKeys.length; i += 200) {
    const { error } = await db.from('pro_crawl_tasks').delete().eq('kind', 'standings').in('key', tableKeys.slice(i, i + 200));
    if (error) throw new Error(`prune tables: ${error.message}`);
  }
  ctx.inc('pruned_tables', tableKeys.length);
}

/** params: { max_minutes?: number (default 9), max_calls?: number, kinds?: string[] } */
export async function proCrawl(ctx: JobContext): Promise<void> {
  const deadline = Date.now() + (Number(ctx.params.max_minutes) || 9) * 60_000;
  const maxCalls = Number(ctx.params.max_calls) || Number.POSITIVE_INFINITY;
  const kinds = Array.isArray(ctx.params.kinds) ? (ctx.params.kinds as unknown[]).map(String) : typeof ctx.params.kinds === 'string' ? String(ctx.params.kinds).split(',') : null;
  await withApi(ctx, async (api) => {
    const leagues = await leagueIndex(ctx.db);
    const pace = new Pace();
    const startCalls = api.quota.used;
    // Tasks another task's request already finished (people asked for 20 at a time).
    const handled = new Set<string>();
    const spent = () => api.quota.used - startCalls;
    while (Date.now() < deadline && spent() < maxCalls) {
      if (api.headroom('backfill') < 1) { ctx.note('stopped', 'backfill quota floor'); return; }
      if (await ctx.cancelled()) return;
      let q = ctx.db.from('pro_crawl_tasks').select('kind,key,priority,every_days,page,pages,attempts,calls').lte('due_at', new Date().toISOString())
        .order('priority').order('due_at').limit(25);
      if (kinds?.length) q = q.in('kind', kinds);
      const { data, error } = await q;
      if (error) throw new Error(`crawl queue: ${error.message}`);
      const batch = (data ?? []) as TaskRow[];
      if (!batch.length) { ctx.note('idle', 'nothing due'); return; }
      for (const task of batch) {
        if (Date.now() >= deadline || spent() >= maxCalls) break;
        if (handled.has(`${task.kind}|${task.key}`)) continue;
        if (api.headroom('backfill') < 1) { ctx.note('stopped', 'backfill quota floor'); return; }
        const handler = handlerFor(task.kind);
        const before = api.quota.used;
        try {
          if (!handler) throw new Error(`no handler for ${task.kind}`);
          const res = await handler({ ctx, api, task, leagues, pace, deadline, callsLeft: () => maxCalls - spent() });
          const calls = api.quota.used - before;
          const patch: Record<string, unknown> = { calls: task.calls + calls, pages: res.pages ?? task.pages };
          if (res.done) Object.assign(patch, { page: 0, attempts: 0, last_error: null, last_done_at: new Date().toISOString(), due_at: task.every_days ? new Date(Date.now() + Number(task.every_days) * 86400_000).toISOString() : 'infinity' });
          else patch.page = res.page ?? task.page;
          await ctx.db.from('pro_crawl_tasks').update(patch).eq('kind', task.kind).eq('key', task.key);
          ctx.inc(res.done ? 'tasks_done' : 'tasks_partial');
          for (const k of res.also ?? []) { handled.add(`${task.kind}|${k}`); ctx.inc('tasks_done'); ctx.inc(`kind_${task.kind}`); }
          ctx.inc(`kind_${task.kind}`);
        } catch (err) {
          if (err instanceof QuotaExhausted) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          const attempts = task.attempts + 1;
          // Back off: 1 h, 2 h, 4 h ... up to a week.
          await ctx.db.from('pro_crawl_tasks').update({ attempts, last_error: msg.slice(0, 500), calls: task.calls + (api.quota.used - before), due_at: new Date(Date.now() + Math.min(2 ** (attempts - 1), 168) * 3600_000).toISOString() })
            .eq('kind', task.kind).eq('key', task.key);
          ctx.inc('task_errors');
          log.warn({ kind: task.kind, key: task.key, err: msg }, 'pro crawl task failed');
        }
        await ctx.heartbeat();
        if (pace.pauseMs) {
          ctx.inc('db_pauses');
          ctx.note('batch_size', String(pace.chunk));
          await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pace.pauseMs, deadline - Date.now()))));
          pace.pauseMs = 0;
        } else pace.calm();
      }
    }
  });
}

export async function proRank(ctx: JobContext): Promise<void> {
  const { data, error } = await ctx.db.rpc('pro_refresh_player_rank');
  if (error) throw new Error(error.message);
  ctx.inc('players_updated', Number(data) || 0);
}

registerJob('pro-plan', proPlan);
registerJob('pro-crawl', proCrawl);
registerJob('pro-rank', proRank);
