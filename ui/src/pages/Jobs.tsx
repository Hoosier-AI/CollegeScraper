import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmt } from '../lib/api';
import { useFilters } from '../lib/filters';
import { Badge, DataTable, ErrorBox, JsonViewer, Spinner, type Column } from '../components/ui';
import type { Run } from '../components/RunProgress';

export default function Jobs() {
  const f = useFilters(); const qc = useQueryClient();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ jobs: string[] }>('/api/meta') });
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api<Run[]>('/api/runs?limit=100'), refetchInterval: 4000 });
  const [job, setJob] = useState('sync-program');
  const [program, setProgram] = useState('duke');
  const [division, setDivision] = useState('');
  const [extra, setExtra] = useState('{}');
  const [err, setErr] = useState<string | null>(null);
  const enqueue = useMutation({
    mutationFn: () => { let p: Record<string, unknown> = {}; try { p = JSON.parse(extra || '{}'); } catch { throw new Error('extra params must be JSON'); } return api('/api/jobs/enqueue', { method: 'POST', body: JSON.stringify({ job, params: { season: f.season, gender: f.gender, ...(program ? { program } : {}), ...(division ? { division } : {}), ...p } }) }); },
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ['runs'] }); }, onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/api/runs/${id}/cancel`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }) });
  const cols: Column<Run>[] = [
    { key: 'job', label: 'Job', sticky: true, render: (r) => <span className="font-semibold">{r.job}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'done' ? 'green' : r.status === 'failed' ? 'red' : r.status === 'running' ? 'amber' : 'gray'}>{r.status}</Badge> },
    { key: 'params', label: 'Params', render: (r) => <span className="text-xs text-ink-400">{JSON.stringify(r.params)}</span> },
    { key: 'created_at', label: 'Created', render: (r) => fmt.ago(r.created_at) },
    { key: 'dur', label: 'Duration', value: (r) => r.started_at ? (Date.parse(r.finished_at ?? r.heartbeat_at ?? r.started_at) - Date.parse(r.started_at)) / 1000 : null, render: (r) => r.started_at ? `${Math.round((Date.parse(r.finished_at ?? r.heartbeat_at ?? r.started_at) - Date.parse(r.started_at)) / 1000)}s` : '' },
    { key: 'counters', label: 'Counters', render: (r) => <span className="text-xs text-ink-300">{Object.entries(r.counters ?? {}).filter(([, v]) => typeof v === 'number' && v).map(([k, v]) => `${k}=${v}`).join(' ')}</span>, className: 'max-w-[600px] !whitespace-normal' },
    { key: 'error', label: 'Error', render: (r) => <span className="text-xs text-red-300">{r.error ?? ''}</span>, className: 'max-w-[300px] !whitespace-normal' },
    { key: 'x', label: '', render: (r) => ['queued', 'running'].includes(r.status) ? <button className="btn-ghost !py-0.5" onClick={() => cancel.mutate(r.id)}>Cancel</button> : null },
  ];
  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h1 className="text-xl font-black">Jobs</h1>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-ink-400">Job<br /><select className="input" value={job} onChange={(e) => setJob(e.target.value)}>{(meta.data?.jobs ?? [job]).map((j) => <option key={j} value={j}>{j}</option>)}</select></label>
          <label className="text-sm text-ink-400">Program (seo slug, optional)<br /><input className="input" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="duke" /></label>
          <label className="text-sm text-ink-400">Division<br /><select className="input" value={division} onChange={(e) => setDivision(e.target.value)}><option value="">all</option><option value="d1">d1</option><option value="d2">d2</option><option value="d3">d3</option></select></label>
          <label className="text-sm text-ink-400">Extra params (JSON)<br /><input className="input w-64" value={extra} onChange={(e) => setExtra(e.target.value)} /></label>
          <button className="btn-primary" onClick={() => enqueue.mutate()} disabled={enqueue.isPending}>Enqueue</button>
          <span className="text-xs text-ink-500">season {f.season} · gender {f.gender} are added automatically</span>
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <p className="text-xs text-ink-500">Typical flow for a new season: <b>discover-teams</b> (all programs from the NCAA scoreboard + school pages) → <b>detect-sites</b> → per-team <b>sync-program</b> from the Teams page, or <b>backfill</b> for everything. <b>refresh-rankings</b> loads polls, standings and NCAA category ranks.</p>
      </div>
      {runs.isLoading && <Spinner />}{runs.error && <ErrorBox error={runs.error} />}
      {runs.data && <DataTable rows={runs.data} columns={cols} rowKey={(r) => r.id} dense />}
      {runs.data?.[0] && <JsonViewer title="latest run" value={runs.data[0]} />}
    </div>
  );
}
