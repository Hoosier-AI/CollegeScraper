// Runtime settings kept in the database, so they take effect without a redeploy: live cadence, pauses, contact.
import { useEffect, useState } from 'react';
import { useConsole, useConsoleAction, type LiveSettings, type SettingsData } from '../../lib/console';
import { ErrorBox, Field, Note, Section, Skeleton } from '../../components/primitives';
import { Toggle } from './parts';

export default function SettingsTab() {
  const q = useConsole<SettingsData>('/settings');
  const save = useConsoleAction<Partial<{ live: Partial<LiveSettings>; scheduler_paused: boolean; crawl_paused: boolean; contact_email: string }>>((body) => ({ path: '/settings', method: 'PUT', body }), ['/settings', '/overview', '/crawl', '/schedule']);
  const [live, setLive] = useState<LiveSettings | null>(null);
  const [contact, setContact] = useState('');
  useEffect(() => { if (q.data) { setLive(q.data.live); setContact(q.data.contact_email); } }, [q.data]);
  if (q.isPending || !live) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const num = (k: keyof LiveSettings, v: string) => setLive({ ...live, [k]: Number(v) });
  const dirty = JSON.stringify(live) !== JSON.stringify(d.live);
  return (
    <div className="space-y-6">
      <Section title="Live scores and stats">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Scoreboard every (min)" hint="1 = every minute during game hours">{(id) => <input id={id} type="number" min={1} max={10} className="input w-full" value={live.scoreboard_every_min} onChange={(e) => num('scoreboard_every_min', e.target.value)} />}</Field>
          <Field label="Stats snapshot every (min)" hint="per live match, box score + play-by-play">{(id) => <input id={id} type="number" min={1} max={15} className="input w-full" value={live.detail_every_min} onChange={(e) => num('detail_every_min', e.target.value)} />}</Field>
          <Field label="Matches per tick" hint="two requests each on ncaa.com">{(id) => <input id={id} type="number" min={0} max={60} className="input w-full" value={live.detail_budget} onChange={(e) => num('detail_budget', e.target.value)} />}</Field>
          <Field label="Tick budget (s)" hint="time a live run may spend on snapshots">{(id) => <input id={id} type="number" min={10} max={55} className="input w-full" value={Math.round(live.tick_budget_ms / 1000)} onChange={(e) => setLive({ ...live, tick_budget_ms: Number(e.target.value) * 1000 })} />}</Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-chalk-200"><Toggle on={live.detail_enabled} label="Live stats snapshots" onChange={(v) => setLive({ ...live, detail_enabled: v })} /> Live stats snapshots</label>
          <button className="btn-primary btn-sm" disabled={!dirty || save.isPending} onClick={() => save.mutate({ live })}>Save live settings</button>
          {save.isSuccess && !dirty && <span className="text-sm text-win" role="status">Saved. The scheduler and live job pick it up within 15 s.</span>}
        </div>
        <Note>The scoreboard is six requests per tick; snapshots are two per match. Everything stays under one request per second per host, with live requests ahead of the crawl.</Note>
      </Section>

      <Section title="Pauses">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="frame flex items-center justify-between gap-3 p-3"><div><div className="text-sm font-medium text-chalk-100">Scheduler</div><div className="text-xs text-chalk-400">Off: nothing is queued on a timer, including live scores. Manual runs still work.</div></div><Toggle on={!d.scheduler_paused} label="Scheduler on" busy={save.isPending} onChange={(v) => save.mutate({ scheduler_paused: !v })} /></div>
          <div className="frame flex items-center justify-between gap-3 p-3"><div><div className="text-sm font-medium text-chalk-100">Crawling</div><div className="text-xs text-chalk-400">Off: the crawl worker claims nothing; queued runs wait. Live scores keep going.</div></div><Toggle on={!d.crawl_paused} label="Crawling on" busy={save.isPending} onChange={(v) => save.mutate({ crawl_paused: !v })} /></div>
        </div>
      </Section>

      <Section title="Contact">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Contact email" hint="shown in /v1/meta for people who need a higher limit (the crawler's From: header comes from the service env)">{(id) => <input id={id} type="email" className="input w-80" value={contact} onChange={(e) => setContact(e.target.value)} />}</Field>
          <button className="btn-ghost btn-sm" disabled={save.isPending || contact === d.contact_email} onClick={() => save.mutate({ contact_email: contact })}>Save</button>
        </div>
      </Section>
      {save.error ? <p role="alert" className="text-sm text-loss">{save.error instanceof Error ? save.error.message : String(save.error)}</p> : null}
    </div>
  );
}
