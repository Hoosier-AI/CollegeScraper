// Data quality from stored snapshots: the latest counts with the change since the previous run, a trend per
// check, the sample rows, and a Fix button that queues the job that puts it right.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFilters, useHref } from '../../lib/filters';
import { fmt } from '../../lib/api';
import { agoShort, useNow } from '../../lib/hooks';
import { useConsole, useConsoleAction, type QualityData } from '../../lib/console';
import { RunProgress } from '../../components/RunProgress';
import { Badge, EmptyState, ErrorBox, Note, Skeleton } from '../../components/primitives';
import { Sparkline, StatTile } from './parts';

export default function QualityTab() {
  const f = useFilters(); const href = useHref(); const now = useNow(15_000);
  const q = useConsole<QualityData>(`/quality?season=${f.season}`, { every: 30_000 });
  const run = useConsoleAction<number>((season) => ({ path: '/quality/run', body: { season } }), ['/quality']);
  const fix = useConsoleAction<string>((check) => ({ path: '/quality/fix', body: { check, season: f.season } }), ['/quality']);
  const [open, setOpen] = useState<string | null>(null);
  const [fixing, setFixing] = useState<Record<string, string>>({});
  if (q.isPending) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const runButton = <button className="btn-primary btn-sm" onClick={() => run.mutate(f.season)} disabled={run.isPending}>{run.isPending ? 'Queuing…' : 'Run checks now'}</button>;
  if (!d.latest) return <EmptyState title="No quality snapshot yet" body={<span>The nightly stores one; the checks take a few minutes over a season.</span>} action={runButton} />;
  const flagged = d.latest.checks.filter((c) => c.count > 0);
  const worse = flagged.filter((c) => (c.delta ?? 0) > 0).length, better = d.latest.checks.filter((c) => (c.delta ?? 0) < 0).length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Checks flagged" value={`${flagged.length} of ${d.latest.checks.length}`} tone={flagged.length ? 'warn' : 'ok'} />
          <StatTile label="Worse since last" value={worse} tone={worse ? 'bad' : undefined} sub={d.previous_taken_at ? `vs ${agoShort(d.previous_taken_at, now)}` : 'no earlier snapshot'} />
          <StatTile label="Better since last" value={better} tone={better ? 'ok' : undefined} />
          <StatTile label="Snapshot" value={agoShort(d.latest.taken_at, now)} sub={`${fmt.num(d.latest.games)} games, ${fmt.num(d.latest.finals)} finals`} />
        </div>
        <div className="flex items-center gap-2">{run.data && <RunProgress runId={run.data.id} compact />}{runButton}</div>
      </div>
      {run.data?.existing && <Note>A quality run is already queued or running.</Note>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{d.latest.checks.map((c) => {
        const hist = (d.history[c.id] ?? []).map((h) => h.count);
        const fixRun = fixing[c.id];
        return (
          <div key={c.id} className={`card ${c.count ? 'border-note/40' : 'border-win/30'}`}>
            <button type="button" className="flex w-full items-start justify-between gap-2 p-3 text-left" aria-expanded={open === c.id} aria-controls={`q-${c.id}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
              <span className="min-w-0"><span className="block font-semibold text-chalk-100">{c.title}</span><span className="mt-1 block text-xs text-chalk-400">{c.description}</span></span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="flex items-center gap-1.5"><Badge tone={c.count ? 'amber' : 'green'}>{fmt.num(c.count)}</Badge>{c.delta != null && c.delta !== 0 && <span className={`text-xs tnum ${c.delta > 0 ? 'text-loss' : 'text-win'}`}>{c.delta > 0 ? '+' : ''}{c.delta}</span>}</span>
                <Sparkline points={hist} />
              </span>
            </button>
            {open === c.id && (
              <div id={`q-${c.id}`} className="border-t border-field-700 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {c.count > 0 && !fixRun && <button className="btn-ghost btn-sm" disabled={fix.isPending} onClick={() => fix.mutate(c.id, { onSuccess: (r: any) => setFixing((m) => ({ ...m, [c.id]: r.id })), onError: () => {} })}>Fix: queue the job for this</button>}
                  {fixRun && <RunProgress runId={fixRun} compact />}
                  {fix.error && <span className="text-xs text-loss">{fix.error instanceof Error ? fix.error.message : String(fix.error)}</span>}
                </div>
                {c.sample.length ? <ul className="max-h-72 space-y-1 overflow-auto text-xs text-chalk-300">{c.sample.map((s: any, i: number) => <li key={i}>{s.id ? <Link className="text-pitch-400 hover:text-pitch-300" to={href(`/matches/${s.id}`)}>{s.game}</Link> : null} {JSON.stringify({ ...s, game: undefined, id: undefined })}</li>)}</ul> : <p className="text-xs text-chalk-500">Nothing flagged.</p>}
              </div>
            )}
          </div>
        );
      })}</div>
      <p className="text-xs text-chalk-500">{d.snapshots} snapshots stored for {d.season}; trends show the last 30.</p>
    </div>
  );
}
