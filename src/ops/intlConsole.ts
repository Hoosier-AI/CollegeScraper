// The hub's Stats -> International document (/api/console/intl): what the International section holds and how far
// each tournament's current edition is crawled, the competitions whose sides disagree with their scope
// (pro_intl_audit, migration 163), and the international sources' syncs.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import * as intl from '../pro/intl.js';
import { intlSourcesBlock } from './intlSources.js';

/** Jobs the International section runs (the hub's Runs and Schedule tabs filter on these names). */
export const INTL_JOBS = ['intl-refresh', 'intl-results-sync', 'intl-wc-sync', 'intl-wcdb-sync', 'intl-caps-sync', 'intl-match', 'intl-elo'] as const;

export async function intlConsole(db: Db) {
  const [ts, ns, audit, runs] = await Promise.all([
    intl.tournaments(db),
    intl.nations(db),
    db.rpc('pro_intl_audit').then((r) => (r.error ? [] : (r.data ?? [])) as { league_id: number; name: string; scope: string; enabled: boolean; teams: number; national_teams: number; share: number }[]),
    db.from('college_crawl_runs').select('id,job,status,created_at,started_at,finished_at,counters,error').in('job', [...INTL_JOBS]).order('created_at', { ascending: false }).limit(40).then((r) => (r.data ?? []) as any[]),
  ]);
  // Each tournament's current edition: matches, finished, with detail (lineups, events, player lines).
  const current = ts.filter((t) => t.current_season != null);
  const fx = current.length ? await selectAll<{ league_id: number; season: number; status: string; detail_fetched_at: string | null }>(db, 'pro_fixtures', 'league_id,season,status,detail_fetched_at',
    (q) => q.in('league_id', current.map((t) => t.id)).gte('season', Math.min(...current.map((t) => t.current_season!)))) : [];
  const cov = new Map<number, { fixtures: number; finals: number; detailed: number }>();
  for (const f of fx) {
    const t = current.find((x) => x.id === f.league_id);
    if (!t || f.season !== t.current_season) continue;
    const c = cov.get(f.league_id) ?? { fixtures: 0, finals: 0, detailed: 0 };
    c.fixtures += 1; if (f.status === 'final') c.finals += 1; if (f.detail_fetched_at) c.detailed += 1;
    cov.set(f.league_id, c);
  }
  const tally = <K extends string>(xs: K[]) => xs.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {} as Record<K, number>);
  const lastRuns: Record<string, unknown> = {};
  for (const r of runs) if (!lastRuns[r.job] && r.status !== 'queued') lastRuns[r.job] = r;
  return {
    generated_at: new Date().toISOString(),
    counts: {
      tournaments: ts.length, live: ts.filter((t) => t.state === 'live').length,
      by_confederation: tally(ts.map((t) => t.confederation)), by_level: tally(ts.map((t) => t.level)), by_gender: tally(ts.map((t) => t.gender)),
      nations: ns.filter((n) => n.level === 'senior').length, youth_sides: ns.filter((n) => n.level === 'youth').length,
    },
    tournaments: ts.map((t) => ({ ...t, ...(cov.get(t.id) ?? { fixtures: 0, finals: 0, detailed: 0 }) })),
    audit,
    sources: await intlSourcesBlock(db),
    last_runs: lastRuns,
  };
}
