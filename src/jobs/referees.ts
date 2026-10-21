// referees: the referee tables (migration 187) are rebuilt once a day inside the database by pg_cron (migration 204:
// pro at 10:40 UTC, college at 10:55) from the matches we already hold. The pro rebuild takes about 5 minutes, longer
// than the REST gateway waits, so this job no longer runs them: it checks how the last runs went and fails when one
// failed or is overdue, so the console still shows a broken refresh. No requests out.
import { registerJob, type JobContext } from './runner.js';

interface CronRun { status: string | null; start_time: string | null; end_time: string | null; message: string | null }

/** What is wrong with the latest cron runs, or null when both refreshed in the last 26 hours. */
export function refereeProblem(runs: Record<string, CronRun | null>, now = Date.now()): string | null {
  const problems: string[] = [];
  for (const name of ['pro-referees', 'college-referees']) {
    const r = runs[name];
    if (!r || !r.start_time) problems.push(`${name}: no run on record`);
    else if (r.status === 'failed') problems.push(`${name}: ${r.message ?? 'failed'}`);
    else if (now - Date.parse(r.start_time) > 26 * 3600_000) problems.push(`${name}: last run ${r.start_time}`);
  }
  return problems.length ? problems.join('; ') : null;
}

registerJob('referees', async (ctx: JobContext) => {
  const { data, error } = await ctx.db.rpc('referees_refresh_status');
  if (error) throw new Error(`referees_refresh_status: ${error.message}`);
  const runs = (data ?? {}) as Record<string, CronRun | null>;
  for (const [name, r] of Object.entries(runs)) if (r?.status === 'succeeded') ctx.inc(name.replace('-', '_'), 1);
  const problem = refereeProblem(runs);
  if (problem) throw new Error(problem);
});
