// The public API from the operator's side: keys (env and console-made), who is calling and how much, the
// limits and origins in force, and the Plaibook connection.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmt } from '../../lib/api';
import { agoShort, useNow } from '../../lib/hooks';
import { useConsole, useConsoleAction, type ApiData } from '../../lib/console';
import { Badge, ErrorBox, Field, Note, Section, Skeleton } from '../../components/primitives';
import { ConfirmDialog, CopyField, StatTile } from './parts';

export default function ApiTab() {
  const q = useConsole<ApiData>('/api', { every: 30_000 });
  const now = useNow(15_000);
  const create = useConsoleAction<{ name: string; note: string }>((v) => ({ path: '/api/keys', body: v }), ['/api', '/overview']);
  const revoke = useConsoleAction<string>((id) => ({ path: `/api/keys/${id}/revoke` }), ['/api']);
  const [name, setName] = useState(''); const [note, setNote] = useState('');
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  if (q.isPending) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const today = new Date().toISOString().slice(0, 10);
  const byPrincipal = new Map<string, { today: number; week: number; limited: number; last: string | null }>();
  for (const u of d.usage) { const c = byPrincipal.get(u.principal) ?? { today: 0, week: 0, limited: 0, last: null }; c.week += u.requests; c.limited += u.limited; if (u.day === today) c.today += u.requests; if (u.last_seen_at && (!c.last || u.last_seen_at > c.last)) c.last = u.last_seen_at; byPrincipal.set(u.principal, c); }
  for (const u of d.pending) { const c = byPrincipal.get(u.principal) ?? { today: 0, week: 0, limited: 0, last: null }; c.today += u.requests; c.week += u.requests; c.limited += u.limited; byPrincipal.set(u.principal, c); }
  const usageRows = [...byPrincipal].sort((a, b) => b[1].week - a[1].week);
  const testCall = async () => {
    setTest(null);
    try { const r = await api<any>('/v1/status'); setTest({ ok: true, text: `OK: season ${r.season}, ${fmt.num(r.games)} games, ${fmt.num(r.finals)} finals, ${r.runs?.length ?? 0} recent runs.` }); }
    catch (e) { setTest({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  };
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Named key limit" value={`${fmt.num(d.limits.key)}/min`} sub="per key" />
        <StatTile label="Free tier" value={`${fmt.num(d.limits.anon)}/min`} sub="per IP, no key" />
        <StatTile label="Site reads" value={`${fmt.num(d.limits.site)}/min`} sub="the viewer's own /api calls, per IP" />
      </div>

      <Section title="Plaibook connection">
        {d.plaibook ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Key in use" value={d.plaibook.name} sub={d.keys.find((k) => k.name === d.plaibook!.name)?.source === 'env' ? 'from COLLEGE_API_KEYS on the service' : 'created in this console'} />
            <StatTile label="Last request" value={d.plaibook.last_seen_at ? agoShort(d.plaibook.last_seen_at, now) : 'never'} tone={d.plaibook.last_seen_at && now - Date.parse(d.plaibook.last_seen_at) < 86400_000 ? 'ok' : 'warn'} />
            <StatTile label="Requests today" value={fmt.num(d.plaibook.today)} />
          </div>
        ) : <Note tone="warn">No key named <code>plaibook</code>: create one below or set it in COLLEGE_API_KEYS on the service.</Note>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-ghost btn-sm" onClick={testCall}>Test the API from here</button>
          {test && <span className={`text-sm ${test.ok ? 'text-win' : 'text-loss'}`} role="status">{test.text}</span>}
          <Link className="text-sm text-pitch-400 hover:text-pitch-300" to="/docs">API docs</Link>
          <a className="text-sm text-pitch-400 hover:text-pitch-300" href="/v1/openapi.json" target="_blank" rel="noreferrer">OpenAPI</a>
        </div>
        <div className="mt-3 space-y-1">
          <p className="text-xs text-chalk-500">Plaibook's server calls this service with the key as a bearer token (client: <code>docs/plaibook-client.mjs</code> in this repo):</p>
          <CopyField label="Example request" value={`curl -H "Authorization: Bearer <plaibook key>" ${d.public_url ?? window.location.origin}/v1/matches?gender=m`} />
        </div>
        {d.cors_origins.length > 0 && <p className="mt-2 text-xs text-chalk-500">Browser origins allowed to send a key: {d.cors_origins.join(', ')}.</p>}
      </Section>

      <Section title="Keys">
        <table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">API keys</caption>
          <thead><tr><th scope="col" className="th">Name</th><th scope="col" className="th">Source</th><th scope="col" className="th">Prefix</th><th scope="col" className="th">Created</th><th scope="col" className="th">Last used</th><th scope="col" className="th"></th></tr></thead>
          <tbody>{d.keys.map((k) => (
            <tr key={k.id ?? `env-${k.name}`} className={k.revoked_at ? 'opacity-50' : ''}>
              <th scope="row" className="td text-left font-medium text-chalk-100">{k.name}{k.revoked_at && <Badge className="ml-2">revoked</Badge>}{k.note && <span className="ml-2 text-xs font-normal text-chalk-500">{k.note}</span>}</th>
              <td className="td text-chalk-400">{k.source === 'env' ? 'service env' : 'console'}</td>
              <td className="td font-mono text-xs text-chalk-400">{k.prefix ?? '—'}</td>
              <td className="td text-chalk-400">{k.created_at ? fmt.date(k.created_at) : '—'}</td>
              <td className="td text-chalk-300">{k.last_used_at ? agoShort(k.last_used_at, now) : 'never'}</td>
              <td className="td text-right">{k.source === 'db' && !k.revoked_at && <button className="btn-ghost btn-sm" onClick={() => setRevoking({ id: k.id!, name: k.name })}>Revoke</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-chalk-100">Create a key</h3>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Name" hint="letters, digits, - or _">{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="partner" />}</Field>
            <Field label="Note (optional)">{(id) => <input id={id} className="input w-64" value={note} onChange={(e) => setNote(e.target.value)} placeholder="who has it" />}</Field>
            <button className="btn-primary" disabled={create.isPending || !name.trim()} onClick={() => create.mutate({ name: name.trim(), note }, { onSuccess: () => { setName(''); setNote(''); } })}>Create key</button>
          </div>
          {create.error ? <p role="alert" className="text-sm text-loss">{create.error instanceof Error ? create.error.message : String(create.error)}</p> : null}
          {create.data?.key && (
            <div className="rounded-md border border-note/40 bg-note/10 p-3">
              <p className="mb-2 text-sm text-chalk-100">Copy this key now; it is not shown again.</p>
              <CopyField label="New API key" value={create.data.key} />
            </div>
          )}
        </div>
      </Section>

      <Section title="Usage, last 7 days">
        {usageRows.length === 0 ? <p className="text-sm text-chalk-500">No requests recorded yet.</p> : (
          <table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Usage by caller</caption>
            <thead><tr><th scope="col" className="th">Caller</th><th scope="col" className="th text-right">Today</th><th scope="col" className="th text-right">7 days</th><th scope="col" className="th text-right">Rate limited</th><th scope="col" className="th">Last seen</th></tr></thead>
            <tbody>{usageRows.map(([principal, c]) => (
              <tr key={principal}><th scope="row" className="td text-left font-medium text-chalk-100">{principal}</th><td className="td num">{fmt.num(c.today)}</td><td className="td num">{fmt.num(c.week)}</td><td className={`td num ${c.limited ? 'text-note' : ''}`}>{fmt.num(c.limited)}</td><td className="td text-chalk-400">{c.last ? agoShort(c.last, now) : '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
        <Note>anon = keyless /v1 calls; site = the stats site's own reads; admin = this console and scripts using the trigger secret.</Note>
      </Section>

      <ConfirmDialog open={!!revoking} title={`Revoke ${revoking?.name}?`} body="Requests with this key start failing immediately with 401." confirmLabel="Revoke" danger busy={revoke.isPending} onConfirm={() => revoking && revoke.mutate(revoking.id, { onSuccess: () => setRevoking(null) })} onClose={() => setRevoking(null)} />
    </div>
  );
}
