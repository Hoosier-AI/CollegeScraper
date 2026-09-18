import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmt } from '../lib/api';
import { useFilters } from '../lib/filters';
import { DataTable, type Column } from '../components/DataTable';
import { Badge, ErrorBox, Field, JsonViewer, PageHeader, Select, Spinner } from '../components/primitives';
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
    { key: 'job', label: 'Job', primary: true, render: (r) => <span className="font-semibold">{r.job}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'done' ? 'green' : r.status === 'failed' ? 'red' : r.status === 'running' ? 'amber' : 'gray'}>{r.status}</Badge> },
    { key: 'params', label: 'Params', render: (r) => <span className="text-xs text-chalk-400">{JSON.stringify(r.params)}</span> },
    { key: 'created_at', label: 'Created', render: (r) => fmt.ago(r.created_at) },
    { key: 'dur', label: 'Duration', value: (r) => r.started_at ? (Date.parse(r.finished_at ?? r.heartbeat_at ?? r.started_at) - Date.parse(r.started_at)) / 1000 : null, render: (r) => r.started_at ? `${Math.round((Date.parse(r.finished_at ?? r.heartbeat_at ?? r.started_at) - Date.parse(r.started_at)) / 1000)}s` : '' },
    { key: 'counters', label: 'Counters', render: (r) => <span className="text-xs text-chalk-300">{Object.entries(r.counters ?? {}).filter(([, v]) => typeof v === 'number' && v).map(([k, v]) => `${k}=${v}`).join(' ')}</span>, className: 'max-w-[600px]', wrap: true },
    { key: 'error', label: 'Error', render: (r) => <span className="text-xs text-loss">{r.error ?? ''}</span>, className: 'max-w-[300px]', wrap: true },
    { key: 'x', label: '', render: (r) => ['queued', 'running'].includes(r.status) ? <button className="btn-ghost btn-sm" onClick={() => cancel.mutate(r.id)}>Cancel</button> : null },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Jobs" meta={`season ${f.season}, ${f.gender === 'w' ? "women's" : "men's"} are added to every job automatically`} />
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Job">{(id) => <Select id={id} value={job} onChange={setJob} options={(meta.data?.jobs ?? [job]).map((j) => ({ value: j, label: j }))} />}</Field>
          <Field label="Program (seo slug, optional)">{(id) => <input id={id} className="input" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="duke" />}</Field>
          <Field label="Division">{(id) => <Select id={id} value={division} onChange={setDivision} options={[{ value: '', label: 'all' }, { value: 'd1', label: 'd1' }, { value: 'd2', label: 'd2' }, { value: 'd3', label: 'd3' }]} />}</Field>
          <Field label="Extra params (JSON)">{(id) => <input id={id} className="input w-64" value={extra} onChange={(e) => setExtra(e.target.value)} />}</Field>
          <button className="btn-primary" onClick={() => enqueue.mutate()} disabled={enqueue.isPending}>Enqueue</button>
        </div>
        {err && <p role="alert" className="text-sm text-loss">{err}</p>}
        <p className="text-xs text-chalk-500">Typical flow for a new season: <b>discover-teams</b> (all programs from the NCAA scoreboard + school pages) → <b>detect-sites</b> → per-team <b>sync-program</b> from the Teams page, or <b>backfill</b> for everything. <b>refresh-rankings</b> loads polls, standings and NCAA category ranks.</p>
      </div>
      {runs.isPending && <Spinner />}{runs.error && <ErrorBox error={runs.error} />}
      {runs.data && <DataTable rows={runs.data} columns={cols} rowKey={(r) => r.id} caption="Crawl runs" dense />}
      {runs.data?.[0] && <JsonViewer title="latest run" value={runs.data[0]} />}
    </div>
  );
}
