// pro-plan: decides what the crawl should hold, as rows in pro_crawl_tasks (no API requests). Existing tasks keep their
// schedule and progress; only missing ones are added. Priorities give the initial fill its order: every club, every
// player, every league's current season, then the top competitions' squads, totals and detail, then everyone else's,
// then history. Tiers come from pro_leagues.priority: T1 under 100 (hand-picked), T2 leagues, T3 cups.
// pro-crawl: drains the queue on the pro-bulk lane, within the backfill quota floor and a time budget.
// pro-rank: nightly recent minutes, indexable, current club and number (pro_refresh_player_rank).
import { registerJob, type JobContext } from '../runner.js';
import { selectAll } from '../../db/client.js';
import { insertTasks, leagueIndex, type LeagueInfo, type TaskSeed } from '../../db/proRepo.js';
import { QuotaExhausted } from '../../sources/apiFootball/client.js';
import { handlerFor, Pace, type TaskRow } from './tasks.js';
import { withApi } from './shared.js';
import { log } from '../../log.js';

export type Tier = 1 | 2 | 3;
export const tierOf = (l: Pick<LeagueInfo, 'priority' | 'type'>): Tier => (l.priority < 100 ? 1 : l.type === 'league' && l.priority < 600 ? 2 : 3);
const by = <T>(tier: Tier, t1: T, t2: T, t3: T): T => (tier === 1 ? t1 : tier === 2 ? t2 : t3);

export interface PlanInput {
  leagues: Map<number, LeagueInfo>;
  /** League id -> seasons the provider has, with whether it covers standings. */
  seasons: Map<number, { season: number; standings: boolean }[]>;
  /** Clubs in enabled leagues' current seasons. */
  leagueTeams: { league_id: number; season: number; team_id: number }[];
  /** Players with minutes in a T1 competition's current or last season (trophies). */
  topPlayers: number[];
  /** Players first seen since the last full profile pass, with no profile yet. */
  newPlayers: number[];
}

/** Every task the crawl should have. Pure. */
export function planTasks(input: PlanInput): TaskSeed[] {
  const out = new Map<string, TaskSeed>();
  const add = (kind: string, key: string | number, priority: number, every_days: number | null) => {
    const k = `${kind}|${key}`;
    const prev = out.get(k);
    if (!prev || priority < prev.priority) out.set(k, { kind, key: String(key), priority, every_days });
  };
  add('countries', 'all', 1, 30);
  add('profiles_page', 1, 10, 30);
  for (const id of input.newPlayers) add('profile', id, 15, null);

  for (const l of input.leagues.values()) {
    if (!l.enabled || l.current_season == null) continue;
    const tier = tierOf(l); const c = l.current_season;
    const k = (s: number) => `${l.id}|${s}`;
    add('season_fixtures', k(c), by(tier, 20, 40, 60), by(tier, 7, 7, 14));
    add('league_players', k(c), by(tier, 30, 70, 110), by(tier, 7, 14, 30));
    add('detail', k(c), by(tier, 32, 75, 115), 7);
    if (tier === 1) add('injuries', k(c), 25, 1);
    const detailDepth = tier === 1 ? 4 : 2;
    for (const s of input.seasons.get(l.id) ?? []) {
      const back = c - s.season;
      if (back <= 0) continue;
      if (back <= detailDepth) {
        add('season_fixtures', k(s.season), by(tier, 45, 130, 150), null);
        if (s.standings) add('standings', k(s.season), by(tier, 46, 131, 151), null);
        add('detail', k(s.season), back === 1 ? by(tier, 50, 140, 160) : tier === 1 ? 170 : 180, null);
      }
      if (back <= 2) add('league_players', k(s.season), tier === 1 ? 200 : 220, null);
      else if (tier === 1 && s.season >= 2015) add('league_players', k(s.season), 300, null);
    }
  }

  // Clubs: their best tier decides how often their squad, transfers and coach are read.
  const teamTier = new Map<number, Tier>();
  for (const lt of input.leagueTeams) {
    const l = input.leagues.get(lt.league_id);
    if (!l?.enabled || lt.season !== l.current_season) continue;
    const t = tierOf(l);
    teamTier.set(lt.team_id, Math.min(teamTier.get(lt.team_id) ?? 3, t) as Tier);
  }
  for (const [team, tier] of teamTier) {
    add('squad', team, by(tier, 35, 80, 120), by(tier, 7, 30, 30));
    add('transfers', team, by(tier, 55, 150, 190), by(tier, 7, 60, 60));
    add('coach', team, by(tier, 58, 155, 195), by(tier, 30, 90, 90));
  }
  for (const p of input.topPlayers) add('trophies', p, 400, 90);
  return [...out.values()];
}

export async function proPlan(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const leagues = await leagueIndex(db);
  const enabled = new Set([...leagues.values()].filter((l) => l.enabled).map((l) => l.id));
  const seasonRows = await selectAll<{ league_id: number; season: number; coverage: { standings?: boolean } | null }>(db, 'pro_seasons', 'league_id,season,coverage');
  const seasons = new Map<number, { season: number; standings: boolean }[]>();
  for (const r of seasonRows) if (enabled.has(r.league_id)) seasons.set(r.league_id, [...(seasons.get(r.league_id) ?? []), { season: r.season, standings: r.coverage?.standings !== false }]);
  const leagueTeams = await selectAll<{ league_id: number; season: number; team_id: number }>(db, 'pro_league_teams', 'league_id,season,team_id');
  const t1 = [...leagues.values()].filter((l) => l.enabled && tierOf(l) === 1 && l.current_season != null);
  const top = t1.length ? await selectAll<{ player_id: number; league_id: number; season: number }>(db, 'pro_player_season_stats', 'player_id,league_id,season',
    (q) => q.in('league_id', t1.map((l) => l.id)).gte('season', Math.min(...t1.map((l) => l.current_season! - 1))).gt('minutes', 0)) : [];
  const { data: fresh } = await db.from('pro_players').select('id').is('profile_synced_at', null).order('created_at', { ascending: false }).limit(500);
  const seeds = planTasks({
    leagues, seasons, leagueTeams,
    topPlayers: [...new Set(top.map((r) => r.player_id).filter((id) => id > 0))],
    newPlayers: ((fresh ?? []) as { id: number }[]).map((r) => r.id),
  });
  ctx.inc('planned', seeds.length);
  // New ones are added; existing tasks are left as they are (insert ... on conflict do nothing).
  ctx.inc('sent', await insertTasks(db, seeds));
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
