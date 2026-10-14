// Composite jobs used by the Render cron entries. Each runs a sequence of the atomic jobs.
import { kvGet, kvSet } from '../db/client.js';
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

/**
 * Nightly: corrections, then rosters / schedules / season stats / box scores for programs that played in the last
 * two days, orphan resolution, aggregates, standings verification and the polls. Player bios are weekly: in season
 * almost every program plays within a week, so a 7-day window with bios re-fetched ~39,000 pages and took 19 hours.
 */
registerJob('nightly', async (ctx) => {
  const season = Number(ctx.params.season ?? currentSeason());
  await step(ctx, 'sweep-scoreboard', { season, days: 'recent' });
  await step(ctx, 'fetch-games-ncaa', { season, recent_days: 2, refetch: true });
  await step(ctx, 'sync-site', { season, only_recent_days: 2, stages: ['roster', 'schedule', 'stats', 'boxscores'], concurrency: 4 });
  await step(ctx, 'resolve-orphans', { season });
  await step(ctx, 'reconcile-games', { season });
  await step(ctx, 'compute-aggregates', { season, transfers: true });
  await step(ctx, 'compute-standings', { season });
  await step(ctx, 'refresh-rankings', { season, categories: false });
  await step(ctx, 'quality', { season });
  await step(ctx, 'ops-retention', {});
});

/** Every three hours in season: re-read the conference standings pages so the verification never trails the games by more than that. */
registerJob('standings', async (ctx) => {
  const season = Number(ctx.params.season ?? currentSeason());
  // NCAA.com's W-L-T leaderboard is the "official record" shown next to every team; refreshing it only weekly left
  // almost every team looking like it differed by the weekend.
  await step(ctx, 'verify-membership', { season });
  await step(ctx, 'compute-standings', { season });
  // The United Soccer Coaches polls come out on Tuesday afternoons (ET); six poll pages are cheap, so every run
  // re-reads them and a new poll is live within three hours instead of waiting for the nightly.
  await step(ctx, 'refresh-rankings', { season, categories: false });
});

/** Weekly: rankings/standings/leaderboards, re-discovery, persisted-query health. */
registerJob('weekly', async (ctx) => {
  const season = Number(ctx.params.season ?? currentSeason());
  await step(ctx, 'discover-teams', { season });
  await step(ctx, 'verify-membership', { season });
  await step(ctx, 'detect-sites', { season, only_unknown: true });
  await step(ctx, 'refresh-rankings', { season });
  // Every program's schedule and box scores once a week, whatever NCAA.com listed: games NCAA.com never carried
  // (UT Tyler's conference games in September) only reach us through the school's own schedule, and the nightly
  // sync is limited to programs NCAA.com saw play in the last two days.
  await step(ctx, 'sync-site', { season, stages: ['schedule', 'boxscores'], concurrency: 4 });
  await step(ctx, 'sweep-scoreboard', { season, days: 'all' });
  await step(ctx, 'resolve-orphans', { season });
  await step(ctx, 'reconcile-games', { season, all: true });
  await step(ctx, 'compute-aggregates', { season });
  await step(ctx, 'compute-standings', { season });
  await step(ctx, 'sync-site', { season, stages: ['bios'] });
  await step(ctx, 'pq-health', {});
});

/** Full backfill of one season, in dependency order. params: { season } */
registerJob('backfill', async (ctx) => {
  const season = Number(ctx.params.season ?? currentSeason());
  // A backfill takes a day or more and a deploy cuts it off; the next worker picks it up from the top. Steps already
  // done (in the last 3 days, this season and division) are skipped, and the site pass skips schools it has read, so
  // the run carries on where it stopped.
  const key = `backfill:${season}:${String(ctx.params.division ?? 'all')}`;
  const doneAt = (await kvGet<Record<string, string>>(ctx.db, key)) ?? {};
  const fresh = (job: string) => !!doneAt[job] && Date.now() - Date.parse(doneAt[job]!) < 3 * 86400_000 && !ctx.params.force;
  const once = async (job: string, params: Record<string, unknown>) => {
    if (fresh(job)) { ctx.inc(`${job}.skipped_done`); return; }
    await step(ctx, job, params);
    if (await ctx.cancelled()) return;
    doneAt[job] = new Date().toISOString();
    await kvSet(ctx.db, key, doneAt);
  };
  await once('discover-teams', { season });
  await once('verify-membership', { season });
  await once('detect-sites', { season });
  // Six schools at a time (each its own site), skipping schools read in the last 10 days.
  await once('sync-site', { season, stages: ['roster', 'schedule', 'stats', 'boxscores', 'bios'], concurrency: Number(ctx.params.concurrency) || 6, skip_synced_days: 10 });
  await step(ctx, 'sweep-scoreboard', { season, days: 'all' });
  await step(ctx, 'fetch-games-ncaa', { season });
  await step(ctx, 'resolve-orphans', { season });
  // Every division, whatever this pass covers: a team's division from its own games (see fixDivisions).
  await step(ctx, 'fix-divisions', { season, division: undefined });
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
