// Plaibook's API from the operator's side (no public tier since 2026-10-16): the keys in COLLEGE_API_KEYS, who is
// calling and how much, the limits in force, and the Plaibook connection. Keys are set on the Render service only.
import { useState } from 'react';
import { api, fmt } from '../../lib/api';
import { agoShort, useNow } from '../../lib/hooks';
import { useConsole, type ApiData } from '../../lib/console';
import { ErrorBox, Note, Section, Skeleton } from '../../components/primitives';
import { CopyField, StatTile } from './parts';

export default function ApiTab() {
  const q = useConsole<ApiData>('/api', { every: 30_000 });
  const now = useNow(15_000);
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Keys" value={fmt.num(d.keys.length)} sub="COLLEGE_API_KEYS on the service" />
        <StatTile label="Per key" value={`${fmt.num(d.limits.key)}/min`} sub="Plaibook's syncs, Tekki and pages share it" />
        <StatTile label="Site reads" value={`${fmt.num(d.limits.site)}/min`} sub="this site's own /api calls, per visitor" />
      </div>

      <Section title="Plaibook connection">
        {d.plaibook ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="Key in use" value={d.plaibook.name} sub="from COLLEGE_API_KEYS on the service" />
            <StatTile label="Last request" value={d.plaibook.last_seen_at ? agoShort(d.plaibook.last_seen_at, now) : 'never'} tone={d.plaibook.last_seen_at && now - Date.parse(d.plaibook.last_seen_at) < 86400_000 ? 'ok' : 'warn'} />
            <StatTile label="Requests today" value={fmt.num(d.plaibook.today)} />
          </div>
        ) : <Note tone="warn">No key named <code>plaibook</code>: add <code>plaibook:&lt;key&gt;</code> to COLLEGE_API_KEYS on the service and give the same key to the app (COLLEGE_API_KEY).</Note>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-ghost btn-sm" onClick={testCall}>Test the API from here</button>
          {test && <span className={`text-sm ${test.ok ? 'text-win' : 'text-loss'}`} role="status">{test.text}</span>}
        </div>
        <div className="mt-3 space-y-1">
          <p className="text-xs text-chalk-500">Plaibook's server calls the 17 college routes under /v1 and every site read through /v1/site (client: <code>docs/plaibook-client.mjs</code>, contract: <code>docs/PLAIBOOK_API.md</code>):</p>
          <CopyField label="Example request" value={`curl -H "X-Api-Key: <plaibook key>" ${d.public_url ?? window.location.origin}/v1/site/pro/rankings`} />
        </div>
      </Section>

      <Section title="Keys">
        <div className="overflow-x-auto"><table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">API keys</caption>
          <thead><tr><th scope="col" className="th">Name</th><th scope="col" className="th">Last used</th></tr></thead>
          <tbody>{d.keys.map((k) => (
            <tr key={k.name}>
              <th scope="row" className="td text-left font-medium text-chalk-100">{k.name}</th>
              <td className="td text-chalk-300">{k.last_used_at ? agoShort(k.last_used_at, now) : 'never'}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <Note>Keys are set in COLLEGE_API_KEYS on the Render service (name:key, comma-separated): plaibook for the app, hub for the operator console.</Note>
      </Section>

      <Section title="Usage, last 7 days">
        {usageRows.length === 0 ? <p className="text-sm text-chalk-500">No requests recorded yet.</p> : (
          <div className="overflow-x-auto"><table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Usage by caller</caption>
            <thead><tr><th scope="col" className="th">Caller</th><th scope="col" className="th text-right">Today</th><th scope="col" className="th text-right">7 days</th><th scope="col" className="th text-right">Rate limited</th><th scope="col" className="th">Last seen</th></tr></thead>
            <tbody>{usageRows.map(([principal, c]) => (
              <tr key={principal}><th scope="row" className="td text-left font-medium text-chalk-100">{principal}</th><td className="td num">{fmt.num(c.today)}</td><td className="td num">{fmt.num(c.week)}</td><td className={`td num ${c.limited ? 'text-note' : ''}`}>{fmt.num(c.limited)}</td><td className="td text-chalk-400">{c.last ? agoShort(c.last, now) : '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        <Note>site = this site's own reads; admin = this console and scripts using the trigger secret; anon only appears in history from before the keyless tier was removed.</Note>
      </Section>
    </div>
  );
}
