// The Render service: status and recent deploys, deploy or restart, and the environment with secrets masked.
import { useState } from 'react';
import { fmt } from '../../lib/api';
import { agoShort, useNow } from '../../lib/hooks';
import { useConsole, useConsoleAction, type DeployData } from '../../lib/console';
import { Badge, EmptyState, ErrorBox, Field, Note, Section, Skeleton } from '../../components/primitives';
import { ConfirmDialog, StatTile } from './parts';

const deployTone = (s: string) => (s === 'live' ? 'green' : /fail|cancel|deactivat/.test(s) ? 'red' : /progress|build|created|pre/.test(s) ? 'amber' : 'gray');

export default function DeployTab() {
  const q = useConsole<DeployData>('/deploy', { every: 30_000 });
  const now = useNow(15_000);
  const act = useConsoleAction<'deploy' | 'restart'>((what) => ({ path: `/deploy/${what}` }), ['/deploy']);
  const env = useConsoleAction<{ set?: Record<string, string>; remove?: string[] }>((body) => ({ path: '/deploy/env', method: 'PUT', body }), ['/deploy']);
  const [confirm, setConfirm] = useState<'deploy' | 'restart' | 'env' | null>(null);
  const [editKey, setEditKey] = useState(''); const [editVal, setEditVal] = useState('');
  const [remove, setRemove] = useState<string | null>(null);
  if (q.isPending) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  if (!d.configured) return <EmptyState title="Render is not connected" body={<span>Set <code>RENDER_API_KEY</code> and <code>RENDER_SERVICE_ID</code> on the service (Render dashboard → Environment) and this tab shows the service, deploys and environment.</span>} />;
  const s = d.service!; const latest = d.deploys?.[0];
  const pendingEdit = confirm === 'env' ? (remove ? { remove: [remove] } : { set: { [editKey.trim()]: editVal } }) : null;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Service" value={s.name} sub={`${s.serviceDetails?.plan ?? ''} · ${s.serviceDetails?.region ?? ''}`} tone={s.suspended === 'suspended' ? 'bad' : 'ok'} />
        <StatTile label="Latest deploy" value={latest ? <Badge tone={deployTone(latest.status)}>{latest.status}</Badge> : '—'} sub={latest ? `${agoShort(latest.createdAt, now)}${latest.commit?.id ? ` · ${latest.commit.id.slice(0, 7)}` : ''}` : ''} />
        <StatTile label="Branch" value={s.branch ?? '—'} sub={s.autoDeploy === 'yes' ? 'auto-deploys on push' : 'manual deploys'} />
        <StatTile label="URL" value={<a className="text-base text-pitch-400 hover:text-pitch-300" href={s.serviceDetails?.url} target="_blank" rel="noreferrer">{s.serviceDetails?.url?.replace(/^https?:\/\//, '') ?? '—'}</a>} sub={`health ${s.serviceDetails?.healthCheckPath ?? '/health'}`} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => setConfirm('deploy')} disabled={act.isPending}>Deploy latest commit</button>
        <button className="btn-ghost" onClick={() => setConfirm('restart')} disabled={act.isPending}>Restart service</button>
        {act.isSuccess && <span className="text-sm text-win" role="status">Requested; Render is working on it.</span>}
        {act.error ? <span className="text-sm text-loss" role="alert">{act.error instanceof Error ? act.error.message : String(act.error)}</span> : null}
      </div>

      <Section title="Recent deploys">
        <table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Deploys</caption>
          <thead><tr><th scope="col" className="th">Status</th><th scope="col" className="th">Started</th><th scope="col" className="th">Finished</th><th scope="col" className="th">Trigger</th><th scope="col" className="th">Commit</th></tr></thead>
          <tbody>{(d.deploys ?? []).map((x) => (
            <tr key={x.id}><td className="td"><Badge tone={deployTone(x.status)}>{x.status}</Badge></td><td className="td text-chalk-300">{fmt.dt(x.createdAt)}</td><td className="td text-chalk-300">{x.finishedAt ? fmt.dt(x.finishedAt) : '—'}</td><td className="td text-chalk-400">{x.trigger ?? ''}</td><td className="td text-chalk-400" style={{ whiteSpace: 'normal' }}>{x.commit?.id ? <span className="font-mono text-xs">{x.commit.id.slice(0, 7)}</span> : null} {x.commit?.message?.split('\n')[0]?.slice(0, 100)}</td></tr>
          ))}</tbody>
        </table>
      </Section>

      <Section title="Environment">
        <Note tone="warn">Saving a variable makes Render redeploy the service (about two minutes). Database and console credentials can only be changed in the Render dashboard.</Note>
        <table className="frame mt-3 w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Environment variables</caption>
          <thead><tr><th scope="col" className="th">Variable</th><th scope="col" className="th">Value</th><th scope="col" className="th"></th></tr></thead>
          <tbody>{(d.env ?? []).map((v) => (
            <tr key={v.key}>
              <th scope="row" className="td text-left font-mono text-xs text-chalk-100">{v.key}{v.protected && <Badge className="ml-2">dashboard only</Badge>}</th>
              <td className="td font-mono text-xs text-chalk-300" style={{ whiteSpace: 'normal' }}>{v.value}</td>
              <td className="td text-right">{!v.protected && <><button className="btn-quiet btn-sm" onClick={() => { setEditKey(v.key); setEditVal(''); setRemove(null); }}>Edit</button><button className="btn-quiet btn-sm text-loss" onClick={() => { setRemove(v.key); setConfirm('env'); }}>Remove</button></>}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Variable">{(id) => <input id={id} className="input font-mono text-xs" value={editKey} onChange={(e) => setEditKey(e.target.value.toUpperCase())} placeholder="API_RATE_LIMIT_PER_MIN" />}</Field>
          <Field label="Value" hint="secrets are never shown back; type the full new value">{(id) => <input id={id} className="input w-72 font-mono text-xs" value={editVal} onChange={(e) => setEditVal(e.target.value)} />}</Field>
          <button className="btn-primary" disabled={!editKey.trim() || env.isPending} onClick={() => { setRemove(null); setConfirm('env'); }}>Save and redeploy</button>
          {env.error ? <span className="text-sm text-loss" role="alert">{env.error instanceof Error ? env.error.message : String(env.error)}</span> : null}
          {env.isSuccess && <span className="text-sm text-win" role="status">Saved; Render is redeploying.</span>}
        </div>
      </Section>

      <ConfirmDialog open={confirm === 'deploy'} title="Deploy the latest commit?" body="Render builds the main branch and swaps it in when the health check passes; the site stays up meanwhile." confirmLabel="Deploy" busy={act.isPending} onConfirm={() => act.mutate('deploy', { onSuccess: () => setConfirm(null) })} onClose={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === 'restart'} title="Restart the service?" body="Running jobs stop and are re-claimed after ten minutes; live scores pause for about a minute." confirmLabel="Restart" danger busy={act.isPending} onConfirm={() => act.mutate('restart', { onSuccess: () => setConfirm(null) })} onClose={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === 'env'} title={remove ? `Remove ${remove}?` : `Set ${editKey.trim()}?`} body="The whole environment is written back and Render redeploys the service." confirmLabel={remove ? 'Remove and redeploy' : 'Save and redeploy'} danger={!!remove} busy={env.isPending} onConfirm={() => pendingEdit && env.mutate(pendingEdit, { onSuccess: () => { setConfirm(null); setRemove(null); setEditKey(''); setEditVal(''); } })} onClose={() => { setConfirm(null); setRemove(null); }} />
    </div>
  );
}
