import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge } from './ui';

export interface Run { id: string; job: string; status: string; started_at: string | null; heartbeat_at: string | null; finished_at: string | null; counters: Record<string, unknown>; error: string | null; params: Record<string, unknown>; created_at: string }

/** Polls one run until it finishes; calls onDone once. */
export function RunProgress({ runId, onDone, compact }: { runId: string; onDone?: () => void; compact?: boolean }) {
  const q = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api<Run>(`/api/runs/${runId}`),
    refetchInterval: (query) => (['done', 'failed', 'cancelled'].includes(query.state.data?.status ?? '') ? false : 3000),
  });
  const r = q.data;
  const finished = r && ['done', 'failed', 'cancelled'].includes(r.status);
  if (finished && onDone && !(q as any)._doneFired) { (q as any)._doneFired = true; setTimeout(onDone, 0); }
  if (!r) return <span className="text-xs text-ink-500">queued…</span>;
  const tone = r.status === 'done' ? 'green' : r.status === 'failed' ? 'red' : r.status === 'running' ? 'amber' : 'gray';
  const entries = Object.entries(r.counters ?? {}).filter(([, v]) => typeof v === 'number' && v !== 0);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge tone={tone}>{r.job} · {r.status}</Badge>
      {!compact && entries.slice(0, 12).map(([k, v]) => <span key={k} className="text-ink-400">{k.replace(/^[a-z-]+\./, '')} <b className="text-ink-200">{String(v)}</b></span>)}
      {r.error && <span className="text-red-300">{r.error}</span>}
    </div>
  );
}
