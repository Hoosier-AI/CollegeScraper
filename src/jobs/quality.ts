// Data-quality snapshots and housekeeping. The checks in src/ui/queries.ts take minutes over a full season, so
// the nightly (and the console's "Run checks now") store the result and the console shows trends and deltas
// instead of recomputing on every view. `ops-retention` keeps the operational tables from growing forever.
import { registerJob, type JobContext } from './runner.js';
import { quality } from '../ui/queries.js';
import { currentSeason } from './seasons.js';
import { KV } from '../ops/settings.js';

registerJob('quality', async (ctx: JobContext) => {
  const season = Number(ctx.params.season ?? currentSeason());
  const q = await quality(ctx.db, season);
  const { error } = await ctx.db.from('college_quality_snapshots').insert({ season, run_id: ctx.runId, games: q.games, finals: q.finals, checks: q.checks });
  if (error) throw new Error(`quality snapshot: ${error.message}`);
  ctx.inc('checks', q.checks.length);
  ctx.inc('flagged', q.checks.filter((c: any) => c.count > 0).length);
  for (const c of q.checks) ctx.inc(`check.${c.id}`, c.count);
});

export const RETENTION = { runs_days: 30, live_runs_days: 1, usage_days: 90, snapshots_days: 180, analytics_days: 400 };

registerJob('ops-retention', async (ctx: JobContext) => {
  const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
  const del = async (table: string, q: (x: any) => any, counter: string) => {
    const { count, error } = await q(ctx.db.from(table).delete({ count: 'exact' }));
    if (error) throw new Error(`${table}: ${error.message}`);
    ctx.inc(counter, count ?? 0);
  };
  await del('college_crawl_runs', (q) => q.in('status', ['done', 'failed', 'cancelled']).eq('job', 'live').lt('created_at', ago(RETENTION.live_runs_days)), 'live_runs_deleted');
  await del('college_crawl_runs', (q) => q.in('status', ['done', 'failed', 'cancelled']).neq('job', 'live').lt('created_at', ago(RETENTION.runs_days)), 'runs_deleted');
  await del('college_api_usage', (q) => q.lt('day', ago(RETENTION.usage_days).slice(0, 10)), 'usage_deleted');
  await del('college_quality_snapshots', (q) => q.lt('taken_at', ago(RETENTION.snapshots_days)), 'snapshots_deleted');
  // Site analytics (migration 163): a little over a year, so the hub can compare with the same week last year.
  // News stories (and their links, by cascade) after the same 400 days.
  await del('news_articles', (q) => q.lt('published_at', ago(RETENTION.analytics_days)), 'news_deleted');
  // Corrections and removal requests: kept 12 months after they are closed (the privacy policy says so).
  await del('stats_requests', (q) => q.neq('status', 'open').lt('closed_at', ago(365)), 'requests_deleted');
  for (const t of ['stats_views_daily', 'stats_referrers_daily', 'stats_devices_daily', 'stats_visitors_daily', 'stats_searches_daily']) await del(t, (q) => q.lt('day', ago(RETENTION.analytics_days).slice(0, 10)), 'analytics_deleted');
  // Render gives every deploy a new host name, so old pods leave heartbeat rows behind.
  await del('college_kv', (q) => q.like('key', `${KV.heartbeatPrefix}%`).lt('updated_at', ago(1)), 'stale_heartbeats_deleted');
});
