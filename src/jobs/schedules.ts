// Composite jobs used by the Render cron entries. Each runs a sequence of the atomic jobs.
import { getJob, registerJob, type JobContext } from './runner.js';
import { currentSeason } from './seasons.js';

async function step(ctx: JobContext, job: string, params: Record<string, unknown>): Promise<void> {
  const fn = getJob(job);
  if (!fn) throw new Error(`missing job ${job}`);
  const sub: JobContext = { ...ctx, params: { ...ctx.params, ...params }, inc: (k, by = 1) => ctx.inc(`${job}.${k}`, by), note: (k, v) => ctx.note(`${job}.${k}`, v) };
  if (await ctx.cancelled()) return;
  await fn(sub);
}

/**
 * In-season, every 30 minutes: yesterday/today/tomorrow scoreboard → NCAA box scores for new finals → school box
 * scores only for programs whose new finals still lack one → reconcile → aggregates. Schedules for every program and
 * the conference standings pages are refreshed by the nightly job; doing them here made each "hourly" run a
 * 1,300-program crawl that took two to four hours.
 */
registerJob('hourly', async (ctx) => {
  const season = Number(ctx.params.season ?? currentSeason());
  await step(ctx, 'sweep-scoreboard', { season, days: 'recent' });
  await step(ctx, 'fetch-games-ncaa', { season, recent_days: 3 });
  await step(ctx, 'sync-site', { season, only_pending_boxscores: 3, stages: ['boxscores'] });
  await step(ctx, 'reconcile-games', { season });
  await step(ctx, 'compute-aggregates', { season, transfers: false });
});

/** Nightly: corrections + rosters/bios/season stats for programs that played in the last week, full aggregates, transfers. */
registerJob('nightly', async (ctx) => {
  const season = Number(ctx.params.season ?? currentSeason());
  await step(ctx, 'sweep-scoreboard', { season, days: 'recent' });
  await step(ctx, 'fetch-games-ncaa', { season, recent_days: 2, refetch: true });
  await step(ctx, 'sync-site', { season, only_recent_days: 7, stages: ['roster', 'schedule', 'stats', 'boxscores', 'bios'] });
  await step(ctx, 'resolve-orphans', { season });
  await step(ctx, 'reconcile-games', { season });
  await step(ctx, 'compute-aggregates', { season, transfers: true });
  await step(ctx, 'compute-standings', { season });
});

/** Weekly: rankings/standings/leaderboards, re-discovery, persisted-query health. */
registerJob('weekly', async (ctx) => {
  const season = Number(ctx.params.season ?? currentSeason());
  await step(ctx, 'discover-teams', { season });
  await step(ctx, 'verify-membership', { season });
  await step(ctx, 'detect-sites', { season, only_unknown: true });
  await step(ctx, 'refresh-rankings', { season });
  await step(ctx, 'compute-standings', { season });
  await step(ctx, 'pq-health', {});
});

/** Full backfill of one season, in dependency order. params: { season } */
registerJob('backfill', async (ctx) => {
  const season = Number(ctx.params.season ?? currentSeason());
  await step(ctx, 'discover-teams', { season });
  await step(ctx, 'verify-membership', { season });
  await step(ctx, 'detect-sites', { season });
  await step(ctx, 'sync-site', { season, stages: ['roster', 'schedule', 'stats', 'boxscores', 'bios'] });
  await step(ctx, 'sweep-scoreboard', { season, days: 'all' });
  await step(ctx, 'fetch-games-ncaa', { season });
  await step(ctx, 'resolve-orphans', { season });
  await step(ctx, 'reconcile-games', { season, all: true });
  await step(ctx, 'compute-aggregates', { season, transfers: true });
  await step(ctx, 'refresh-rankings', { season });
  await step(ctx, 'compute-standings', { season });
});

/** On-demand crawl of one program: params { season, program (seo), gender } */
registerJob('sync-program', async (ctx) => {
  const season = Number(ctx.params.season ?? currentSeason());
  const program = String(ctx.params.program ?? '');
  const gender = ctx.params.gender ?? 'm';
  if (!program) throw new Error('sync-program needs params.program (school seo slug)');
  await step(ctx, 'detect-sites', { season, program });
  await step(ctx, 'sync-site', { season, program, gender, stages: ['roster', 'schedule', 'stats', 'boxscores', 'bios'], force: !!ctx.params.force });
  await step(ctx, 'fetch-games-ncaa', { season, program, gender, refetch: !!ctx.params.force });
  await step(ctx, 'reconcile-games', { season, program, all: true });
  await step(ctx, 'compute-aggregates', { season, program, gender, transfers: false });
  await step(ctx, 'compute-standings', { season, gender, conference: ctx.params.conference });
});
