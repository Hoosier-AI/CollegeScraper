// The daily stat audit (src/jobs/statAudit.ts): how often our numbers agree with an independent reference, check by
// check, against its target, with the trend and the rows that differ most. Above the crawl checks on Quality.
import { useState } from 'react';
import { useConsole, useConsoleAction } from '../../lib/console';
import { RunProgress } from '../../components/RunProgress';
import { Badge, Skeleton } from '../../components/primitives';
import { Sparkline } from './parts';

interface AuditCheck { run_at: string; area: 'college' | 'pro' | 'intl'; check_key: string; label: string; compared: number; agree: number; rate: number; target: number | null; worst: { who: string; ours: number | null; theirs: number }[]; history: number[] }
const AREA = { college: 'College', pro: 'Pro', intl: 'International' } as const;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function StatAudit() {
  const q = useConsole<{ checks: AuditCheck[]; missing?: boolean }>('/stat-audit', { every: 60_000 });
  const run = useConsoleAction(() => ({ path: '/stat-audit/run' }), ['/stat-audit']);
  const [open, setOpen] = useState<string | null>(null);
  if (q.isPending) return <Skeleton className="h-40" />;
  const checks = q.data?.checks ?? [];
  const below = checks.filter((c) => c.target != null && c.rate < c.target);
  return (
    <section aria-labelledby="audit-h" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="audit-h" className="text-base font-semibold text-chalk-100">Stats against references</h2>
          <p className="text-xs text-chalk-400">Each day: college players and teams against NCAA.com's leaderboards (teams that played in the two days before the list left out), pro US seasons against the provider's own match lines and American Soccer Analysis.{checks.length ? ` ${below.length} of ${checks.length} below target.` : ''}</p>
        </div>
        <div className="flex items-center gap-2">{run.data && <RunProgress runId={run.data.id} compact />}<button className="btn-ghost btn-sm" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? 'Queuing…' : 'Run the audit now'}</button></div>
      </div>
      {!checks.length ? <p className="text-sm text-chalk-500">{q.data?.missing ? 'The audit table is not in the database yet.' : 'No audit has run yet.'}</p> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{checks.map((c) => {
          const bad = c.target != null && c.rate < c.target;
          return (
            <div key={c.check_key} className={`card ${bad ? 'border-note/40' : 'border-win/30'}`}>
              <button type="button" className="flex w-full items-start justify-between gap-2 p-3 text-left" aria-expanded={open === c.check_key} aria-controls={`a-${c.check_key}`} onClick={() => setOpen(open === c.check_key ? null : c.check_key)}>
                <span className="min-w-0"><span className="block text-2xs text-chalk-500">{AREA[c.area]}</span><span className="block font-semibold text-chalk-100">{c.label}</span>
                  <span className="mt-1 block text-xs text-chalk-400 tnum">{c.agree.toLocaleString()} of {c.compared.toLocaleString()} agree{c.target != null ? `, target ${Math.round(c.target * 100)}%` : ''}</span></span>
                <span className="flex shrink-0 flex-col items-end gap-1"><Badge tone={bad ? 'amber' : 'green'}>{pct(c.rate)}</Badge><Sparkline points={c.history.map((h) => h * 100)} /></span>
              </button>
              {open === c.check_key && (
                <div id={`a-${c.check_key}`} className="border-t border-field-700 p-3">
                  {c.worst.length ? (
                    <table className="w-full text-xs"><caption className="sr-only">Largest differences</caption>
                      <thead><tr className="text-chalk-500"><th scope="col" className="pb-1 text-left font-normal">Largest differences</th><th scope="col" className="pb-1 text-right font-normal">Ours</th><th scope="col" className="pb-1 text-right font-normal">Theirs</th></tr></thead>
                      <tbody>{c.worst.map((w, i) => <tr key={i} className="text-chalk-300"><td className="truncate py-0.5 pr-2">{w.who}</td><td className="text-right tnum">{w.ours ?? '–'}</td><td className="text-right tnum">{w.theirs}</td></tr>)}</tbody>
                    </table>
                  ) : <p className="text-xs text-chalk-500">Everything compared agrees.</p>}
                </div>
              )}
            </div>
          );
        })}</div>
      )}
    </section>
  );
}
