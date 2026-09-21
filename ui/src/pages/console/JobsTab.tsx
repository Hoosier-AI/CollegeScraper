// Run history with filters, a run drawer (re-run, cancel), the enqueue form driven by the job catalogue, and
// the schedule with per-entry toggles. Live runs are hidden by default: one per minute would bury the rest.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt } from '../../lib/api';
import { useFilters } from '../../lib/filters';
import { useUrlNumber, useUrlState } from '../../lib/urlState';
import { agoShort, useNow } from '../../lib/hooks';
import { useConsole, useConsoleAction, type CatalogueJob, type JobRollup, type Run, type RunsPage, type Schedule } from '../../lib/console';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge, ErrorBox, Field, JsonViewer, Note, Pager, Section, Select, Skeleton } from '../../components/primitives';
import { ConfirmDialog, Drawer, ParamForm, Toggle, counterLine, shortId } from './parts';

const STATUSES = ['', 'queued', 'running', 'done', 'failed', 'cancelled'];
const tone = (s: string) => (s === 'done' ? 'green' : s === 'failed' ? 'red' : s === 'running' ? 'amber' : s === 'cancelled' ? 'gray' : 'blue');
const duration = (r: Run) => (r.started_at ? Math.round((Date.parse(r.finished_at ?? r.heartbeat_at ?? r.started_at) - Date.parse(r.started_at)) / 1000) : null);
const fmtDur = (s: number | null) => (s == null ? '' : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

export default function JobsTab() {
  const f = useFilters(); const qc = useQueryClient(); const now = useNow(5_000);
  const [job, setJob] = useUrlState('job', '', { resetPage: true });
  const [status, setStatus] = useUrlState('status', '', { allow: STATUSES, resetPage: true });
  const [showLive, setShowLive] = useUrlState('live', '0', { allow: ['0', '1'], resetPage: true });
  const [page, setPage] = useUrlNumber('page', 0, { min: 0 });
  const [openId, setOpenId] = useUrlState('run', '', { replace: true, resetPage: false });
  const PAGE = 50;
  const cat = useConsole<{ jobs: CatalogueJob[]; rollup: Record<string, JobRollup> }>('/jobs/catalogue', { every: 30_000 });
  const runs = useConsole<RunsPage>(`/runs?job=${encodeURIComponent(job)}&status=${status}&hide_live=${showLive === '1' ? '0' : '1'}&limit=${PAGE}&offset=${page * PAGE}`, { every: 5_000 });
  const sched = useConsole<Schedule>('/schedule', { every: 30_000 });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/api/runs/${id}/cancel`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['console'] }) });
  const enqueue = useMutation({ mutationFn: (v: { job: string; params: Record<string, unknown> }) => api<{ id: string; existing: boolean }>('/api/jobs/enqueue', { method: 'POST', body: JSON.stringify(v) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['console'] }) });
  const toggle = useConsoleAction<{ job: string; enabled: boolean }>((v) => ({ path: `/schedule/${v.job}`, method: 'PUT', body: { enabled: v.enabled } }), ['/schedule', '/overview']);
  const runNow = useConsoleAction<string>((j) => ({ path: `/schedule/${j}/run` }), ['/schedule', '/overview']);

  const jobs = cat.data?.jobs ?? [];
  const open = runs.data?.rows.find((r) => r.id === openId) ?? null;
  const cols: Column<Run>[] = [
    { key: 'job', label: 'Job', primary: true, render: (r) => <button type="button" className="font-semibold text-chalk-100 hover:text-pitch-300" onClick={() => setOpenId(r.id)}>{r.job}</button> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={tone(r.status)}>{r.status}</Badge> },
    { key: 'created_at', label: 'Queued', render: (r) => agoShort(r.created_at, now), priority: 2 },
    { key: 'dur', label: 'Took', render: (r) => fmtDur(duration(r)), priority: 2 },
    { key: 'params', label: 'Params', render: (r) => <span className="text-xs text-chalk-400">{Object.entries(r.params ?? {}).filter(([k]) => k !== 'scheduled').map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`).join(' ') || (r.params?.scheduled ? 'scheduled' : '')}</span>, className: 'max-w-[280px]', wrap: true, priority: 2 },
    { key: 'counters', label: 'Counters', render: (r) => <span className="text-xs text-chalk-300">{counterLine(r.counters, 8)}</span>, className: 'max-w-[420px]', wrap: true, priority: 2 },
    { key: 'error', label: 'Error', render: (r) => <span className="text-xs text-loss">{r.error ? r.error.slice(0, 120) : ''}</span>, className: 'max-w-[280px]', wrap: true, priority: 2 },
    { key: 'x', label: '', render: (r) => ['queued', 'running'].includes(r.status) ? <button className="btn-ghost btn-sm" onClick={() => cancel.mutate(r.id)}>Cancel</button> : null },
  ];
  return (
    <div className="space-y-6">
      <EnqueueForm jobs={jobs} season={f.season} gender={f.gender} onEnqueue={(v) => enqueue.mutate(v)} busy={enqueue.isPending} result={enqueue.data ?? null} error={enqueue.error} />

      <Section title="Runs" right={<label className="inline-flex items-center gap-2 text-xs text-chalk-400"><input type="checkbox" className="h-4 w-4" checked={showLive === '1'} onChange={(e) => setShowLive(e.target.checked ? '1' : '0')} /> show live runs</label>}>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Job">{(id) => <Select id={id} value={job} onChange={setJob} options={[{ value: '', label: 'all jobs' }, ...jobs.map((j) => ({ value: j.name, label: j.name }))]} />}</Field>
          <Field label="Status">{(id) => <Select id={id} value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: s || 'any' }))} />}</Field>
          {runs.data && <span className="pb-2 text-xs text-chalk-500">{fmt.num(runs.data.total)} runs</span>}
        </div>
        {runs.error && <ErrorBox error={runs.error} retry={() => runs.refetch()} />}
        <DataTable rows={runs.data?.rows ?? []} columns={cols} rowKey={(r) => r.id} caption="Crawl runs" mode="server" loading={runs.isPending} dense empty={<span>No runs match.</span>} />
        {runs.data && runs.data.total > PAGE && <div className="mt-3"><Pager page={page} pageSize={PAGE} total={runs.data.total} onPage={setPage} busy={runs.isFetching} noun="Runs" /></div>}
      </Section>

      <Section title="Schedule">
        {sched.isPending ? <Skeleton className="h-24" /> : sched.error ? <ErrorBox error={sched.error} /> : (
          <>
            {sched.data!.paused && <Note tone="warn">The scheduler is paused (Settings). Entries below fire again when it is resumed.</Note>}
            <div className="overflow-x-auto"><table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Schedule</caption>
              <thead><tr><th scope="col" className="th">On</th><th scope="col" className="th">Job</th><th scope="col" className="th">Cadence</th><th scope="col" className="th">Last fired</th><th scope="col" className="th">Next</th><th scope="col" className="th"></th></tr></thead>
              <tbody>{sched.data!.entries.map((e) => (
                <tr key={e.job}>
                  <td className="td"><Toggle on={e.enabled} label={`${e.label} scheduled`} busy={toggle.isPending} onChange={(v) => toggle.mutate({ job: e.job, enabled: v })} /></td>
                  <th scope="row" className="td text-left font-medium text-chalk-100">{e.label} <span className="text-xs font-normal text-chalk-500">{e.job}</span></th>
                  <td className="td text-chalk-400" style={{ whiteSpace: 'normal' }}>{e.cadence}</td>
                  <td className="td text-chalk-300">{e.last_fired ? agoShort(e.last_fired, now) : '—'}</td>
                  <td className="td text-chalk-300">{e.next ? fmt.dt(e.next) : '—'}</td>
                  <td className="td text-right"><button className="btn-ghost btn-sm" onClick={() => runNow.mutate(e.job)} disabled={runNow.isPending}>Run now</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        )}
      </Section>

      <Drawer open={!!open} onClose={() => setOpenId('')} title={open ? `${open.job} · ${shortId(open.id)}` : ''}>
        {open && <RunDetail run={open} onRerun={() => { enqueue.mutate({ job: open.job, params: { ...open.params, scheduled: undefined, manual: true } as Record<string, unknown> }); setOpenId(''); }} onCancel={() => cancel.mutate(open.id)} now={now} />}
      </Drawer>
    </div>
  );
}

function RunDetail({ run, onRerun, onCancel, now }: { run: Run; onRerun: () => void; onCancel: () => void; now: number }) {
  const counters = Object.entries(run.counters ?? {}).filter(([, v]) => typeof v === 'number' || typeof v === 'string');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={tone(run.status)}>{run.status}</Badge><span className="text-xs text-chalk-400">queued {agoShort(run.created_at, now)}{run.started_at ? `, started ${agoShort(run.started_at, now)}` : ''}{run.finished_at ? `, took ${fmtDur(duration(run))}` : ''}</span></div>
      {run.error && <p className="rounded-md border border-loss/40 bg-loss/10 p-2 text-sm text-chalk-100">{run.error}</p>}
      <div className="flex gap-2">
        {['queued', 'running'].includes(run.status) ? <button className="btn-ghost btn-sm" onClick={onCancel}>Cancel run</button> : <button className="btn-primary btn-sm" onClick={onRerun}>Run again with these params</button>}
      </div>
      <div><h3 className="mb-1 text-xs font-medium text-chalk-500">Parameters</h3><pre className="frame overflow-auto p-2 text-xs text-chalk-300">{JSON.stringify(run.params ?? {}, null, 1)}</pre></div>
      <div>
        <h3 className="mb-1 text-xs font-medium text-chalk-500">Counters</h3>
        {counters.length ? <div className="overflow-x-auto"><table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Counters</caption><tbody>{counters.map(([k, v]) => <tr key={k}><th scope="row" className="td text-left font-normal text-chalk-300">{k}</th><td className="td num text-chalk-100">{typeof v === 'number' ? fmt.num(v) : String(v)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-chalk-500">None yet.</p>}
      </div>
      <JsonViewer title="Raw run row" value={run} />
    </div>
  );
}

function EnqueueForm({ jobs, season, gender, onEnqueue, busy, result, error }: { jobs: CatalogueJob[]; season: number; gender: string; onEnqueue: (v: { job: string; params: Record<string, unknown> }) => void; busy: boolean; result: { id: string; existing: boolean } | null; error: unknown }) {
  const [job, setJob] = useState('sync-program');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState('{}');
  const [confirm, setConfirm] = useState(false);
  const meta = jobs.find((j) => j.name === job) ?? null;
  const build = (): Record<string, unknown> => {
    let extra: Record<string, unknown> = {};
    if (advanced) { try { extra = JSON.parse(json || '{}'); } catch { throw new Error('Advanced JSON is not valid'); } }
    const p: Record<string, unknown> = { ...params, ...extra, manual: true };
    if (p.season == null) p.season = season;
    if (p.gender == null && meta?.params.some((x) => x.name === 'gender')) p.gender = gender;
    return p;
  };
  const [localErr, setLocalErr] = useState<string | null>(null);
  const submit = () => { setLocalErr(null); try { const p = build(); if (meta?.dangerous && !confirm) { setConfirm(true); return; } onEnqueue({ job, params: p }); setConfirm(false); } catch (e) { setLocalErr(e instanceof Error ? e.message : String(e)); } };
  return (
    <Section title="Queue a job">
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-2">
          <Field label="Job">{(id) => <Select id={id} value={job} onChange={(v) => { setJob(v); setParams({}); }} options={jobs.map((j) => ({ value: j.name, label: j.name, group: j.composite ? 'Composites' : j.lane === 'live' ? 'Live' : 'Jobs' }))} />}</Field>
          {meta && <p className="text-xs text-chalk-400">{meta.description}</p>}
          {meta?.dangerous && <Badge tone="amber">long or wide-reaching</Badge>}
        </div>
        <div className="space-y-3">
          {meta && <ParamForm specs={meta.params} value={params} onChange={setParams} />}
          <label className="inline-flex items-center gap-2 text-xs text-chalk-400"><input type="checkbox" className="h-4 w-4" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} /> Advanced JSON (merged over the form)</label>
          {advanced && <input className="input w-full font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} aria-label="Extra params as JSON" />}
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={submit} disabled={busy || !meta}>Queue {job}</button>
            <span className="text-xs text-chalk-500">Season {season}{meta?.params.some((x) => x.name === 'gender') ? ` and ${gender === 'w' ? "women's" : "men's"}` : ''} from the page filters unless set above.</span>
          </div>
          {localErr && <p role="alert" className="text-sm text-loss">{localErr}</p>}
          {error ? <p role="alert" className="text-sm text-loss">{error instanceof Error ? error.message : String(error)}</p> : null}
          {result && <p className="text-sm text-win" role="status">{result.existing ? 'An identical run is already queued or running.' : `Queued (${shortId(result.id)}).`}</p>}
        </div>
      </div>
      <ConfirmDialog open={confirm} title={`Queue ${job}?`} body={<span>{meta?.description} This can take a long time and touches many programs.</span>} confirmLabel="Queue it" onConfirm={submit} onClose={() => setConfirm(false)} />
    </Section>
  );
}
