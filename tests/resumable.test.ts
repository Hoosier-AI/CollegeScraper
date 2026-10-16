// A nightly cut off by a deploy picks up where it stopped (schedules.ts resumable): finished steps are skipped and the
// site pass is told to skip schools read since the run first started.
import { describe, expect, it } from 'vitest';
import { getJob, registerJob, type JobContext } from '../src/jobs/runner.js';
import '../src/jobs/schedules.js';

/** college_kv in memory: just what kvGet, kvSet and the resume clean-up use. */
function fakeDb() {
  const kv = new Map<string, unknown>();
  const db = {
    from: () => ({
      select: () => ({ eq: (_c: string, key: string) => ({ maybeSingle: async () => ({ data: kv.has(key) ? { value: kv.get(key) } : null, error: null }) }) }),
      upsert: async (row: { key: string; value: unknown }) => { kv.set(row.key, JSON.parse(JSON.stringify(row.value))); return { error: null }; },
      delete: () => ({ eq: async (_c: string, key: string) => { kv.delete(key); return { error: null }; } }),
    }),
  };
  return { db: db as unknown as JobContext['db'], kv };
}

const STEPS = ['sweep-scoreboard', 'fetch-games-ncaa', 'sync-site', 'resolve-orphans', 'reconcile-games', 'compute-aggregates', 'compute-standings', 'refresh-rankings', 'quality', 'ops-retention'];

describe('nightly resumes after a deploy', () => {
  it('skips the steps it finished and passes the site pass its start time', async () => {
    const { db, kv } = fakeDb();
    const ran: string[] = [];
    let siteParams: Record<string, unknown> = {};
    let cutAtSite = true;
    for (const s of STEPS) registerJob(s, async (ctx) => {
      ran.push(s);
      if (s === 'sync-site') { siteParams = ctx.params; if (cutAtSite) throw new Error('SIGTERM: deploy'); }
    });
    const ctx = (): JobContext => ({ db, runId: 'run-1', params: { season: 2026 }, counters: {}, inc: () => {}, note: () => {}, cancelled: async () => false, heartbeat: async () => {} });

    await expect(getJob('nightly')!(ctx())).rejects.toThrow('deploy');
    expect(ran).toEqual(['sweep-scoreboard', 'fetch-games-ncaa', 'sync-site']);
    const since = siteParams.skip_synced_since as string;
    expect(Date.parse(since)).not.toBeNaN();

    ran.length = 0; cutAtSite = false;
    await getJob('nightly')!(ctx());
    expect(ran).toEqual(STEPS.slice(2)); // the scoreboard and NCAA steps are not repeated
    expect(siteParams.skip_synced_since).toBe(since); // schools read since the first start are skipped
    expect([...kv.keys()]).toEqual([]); // finished: the resume point is gone

    ran.length = 0; // a new run starts from the top
    await getJob('nightly')!({ ...ctx(), runId: 'run-2' });
    expect(ran).toEqual(STEPS);
  });
});
