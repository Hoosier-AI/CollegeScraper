// Is the service healthy and busy with the right things? Refreshes every 15 s.
import { Link } from 'react-router-dom';
import { ErrorBox, Note, Section, Skeleton, Badge } from '../../components/primitives';
import { fmt } from '../../lib/api';
import { useHref } from '../../lib/filters';
import { agoShort, useNow } from '../../lib/hooks';
import { useConsole, useConsoleAction, type Overview as OverviewData } from '../../lib/console';
import { HealthDot, StatTile, counterLine, shortId } from './parts';

export default function Overview() {
  const q = useConsole<OverviewData>('/overview', { every: 15_000 });
  const now = useNow(5_000);
  const href = useHref();
  const runNow = useConsoleAction<string>((job) => ({ path: `/schedule/${job}/run` }), ['/overview', '/schedule']);
  if (q.isPending) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-48" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const lanes = Object.entries(d.health.lanes);
  const jobsSorted = Object.entries(d.jobs).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="space-y-6">
      {!d.health.ok && <Note tone="warn">{d.health.problems.join('; ')}. Render restarts the service when /health keeps failing.</Note>}
      {d.flags.crawl_paused && <Note tone="warn">Crawling is paused: the crawl lane claims nothing until it is resumed in Settings.</Note>}
      {d.flags.scheduler_paused && <Note tone="warn">The scheduler is paused: nothing is queued automatically until it is resumed in Settings.</Note>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Service" value={<HealthDot ok={d.health.ok} label={d.health.ok ? 'Healthy' : 'Problem'} />} sub={`database ${d.health.db.ok ? 'reachable' : 'unreachable'}`} tone={d.health.ok ? 'ok' : 'bad'} />
        {lanes.map(([lane, l]) => <StatTile key={lane} label={`${lane} worker`} value={<HealthDot ok={l.alive} label={l.alive ? 'Alive' : 'Silent'} />} sub={l.job ? `running ${l.job}` : l.age_s != null ? `idle, beat ${l.age_s} s ago` : 'no heartbeat yet'} tone={l.alive ? 'ok' : 'bad'} />)}
        <StatTile label="Queue" value={`${d.queue.running.length} running`} sub={`${d.queue.queued} queued`} />
      </div>
      {d.other_hosts.some((o) => o.alive) && <Note>Another copy of the service is also working this database: {d.other_hosts.filter((o) => o.alive).map((o) => `${o.lane} lane on ${o.host}${o.job ? ` (running ${o.job})` : ''}`).join(', ')}. It shares the job queue.</Note>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Live right now">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Matches live" value={d.live.games_live} />
            <StatTile label="With fresh stats" value={d.live.with_fresh_stats} sub="snapshot < 5 min old" tone={d.live.games_live && d.live.with_fresh_stats < d.live.games_live / 2 ? 'warn' : undefined} />
            <StatTile label="Last live run" value={d.live.last_run ? (d.live.last_run.status === 'done' ? 'ok' : d.live.last_run.status) : '—'} sub={d.live.last_run?.finished_at ? agoShort(d.live.last_run.finished_at, now) : 'not yet'} tone={d.live.last_run?.status === 'failed' ? 'bad' : undefined} />
          </div>
          {d.live.last_run && <p className="mt-2 truncate text-xs text-chalk-500">{counterLine(d.live.last_run.counters)}</p>}
          <p className="mt-2 text-xs text-chalk-500">Scoreboard every {d.live.settings.scoreboard_every_min} min; stats snapshots {d.live.settings.detail_enabled ? `every ${d.live.settings.detail_every_min} min, up to ${d.live.settings.detail_budget} matches per tick` : 'off'}. <Link className="text-pitch-400 hover:text-pitch-300" to={href('/console', { tab: 'settings' })}>Change</Link></p>
        </Section>
        <Section title={`Season ${d.season}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Programs" value={fmt.num(d.counts.programs)} />
            <StatTile label="Games" value={fmt.num(d.counts.games)} />
            <StatTile label="Finals" value={fmt.num(d.counts.finals)} />
            <StatTile label="With a box score" value={d.counts.box_coverage == null ? '—' : `${d.counts.box_coverage}%`} sub={`${fmt.num(d.counts.finals_with_box)} finals`} tone={d.counts.box_coverage != null && d.counts.box_coverage < 90 ? 'warn' : undefined} />
          </div>
        </Section>
      </div>

      <Section title="Schedule" right={<Link className="text-xs text-pitch-400 hover:text-pitch-300" to={href('/console', { tab: 'jobs' })}>All jobs</Link>}>
        {!d.scheduler.enabled && <Note tone="warn">SCHEDULER_ENABLED is not 1 on this process: nothing runs on a timer here.</Note>}
        <table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Scheduled jobs</caption>
          <thead><tr><th scope="col" className="th">Job</th><th scope="col" className="th">Cadence</th><th scope="col" className="th">Last fired</th><th scope="col" className="th">Next</th><th scope="col" className="th"></th></tr></thead>
          <tbody>{d.scheduler.entries.map((e) => (
            <tr key={e.job}>
              <th scope="row" className="td text-left font-medium text-chalk-100">{e.label} <span className="text-xs font-normal text-chalk-500">{e.job}</span>{!e.enabled && <Badge tone="amber" className="ml-2">off</Badge>}</th>
              <td className="td text-chalk-400">{e.cadence}</td>
              <td className="td tnum text-chalk-300">{e.last_fired ? agoShort(e.last_fired, now) : '—'}</td>
              <td className="td tnum text-chalk-300">{e.next ? fmt.dt(e.next) : d.scheduler.paused ? 'paused' : '—'}{e.gated && e.next ? <span className="text-chalk-500"> (if games)</span> : null}</td>
              <td className="td text-right"><button className="btn-ghost btn-sm" onClick={() => runNow.mutate(e.job)} disabled={runNow.isPending}>Run now</button></td>
            </tr>
          ))}</tbody>
        </table>
        {d.scheduler.tick_at && <p className="mt-2 text-xs text-chalk-500">Scheduler ticked {agoShort(d.scheduler.tick_at, now)}.</p>}
      </Section>

      {d.queue.running.length > 0 && (
        <Section title="Running">
          <ul className="frame divide-y divide-field-700">{d.queue.running.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="font-medium text-chalk-100">{r.job}</span><span className="text-xs text-chalk-500">{shortId(r.id)}</span>
              <span className="text-xs text-chalk-400">started {agoShort(r.started_at, now)}{r.heartbeat_at ? `, beat ${agoShort(r.heartbeat_at, now)}` : ''}</span>
              <span className="w-full truncate text-xs text-chalk-500 sm:w-auto sm:flex-1">{counterLine(r.counters)}</span>
            </li>
          ))}</ul>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Jobs, last outcome">
          <table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Last outcome per job</caption>
            <thead><tr><th scope="col" className="th">Job</th><th scope="col" className="th">Last success</th><th scope="col" className="th">Last failure</th></tr></thead>
            <tbody>{jobsSorted.map(([job, j]) => (
              <tr key={job}>
                <th scope="row" className="td text-left font-medium text-chalk-100"><Link className="hover:text-pitch-300" to={href('/console', { tab: 'jobs', job })}>{job}</Link>{j.running ? <Badge tone="amber" className="ml-2">running</Badge> : j.queued ? <Badge className="ml-2">queued</Badge> : null}</th>
                <td className="td tnum text-chalk-300">{j.last_done?.finished_at ? agoShort(j.last_done.finished_at, now) : '—'}</td>
                <td className="td text-chalk-300">{j.last_failed?.finished_at ? <span className="text-loss" title={j.last_failed.error ?? ''}>{agoShort(j.last_failed.finished_at, now)}</span> : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
        <Section title="API traffic today" right={<Link className="text-xs text-pitch-400 hover:text-pitch-300" to={href('/console', { tab: 'api' })}>Keys and usage</Link>}>
          {d.api_today.length === 0 ? <p className="text-sm text-chalk-500">No requests yet today.</p> : (
            <table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Requests today by caller</caption>
              <thead><tr><th scope="col" className="th">Caller</th><th scope="col" className="th text-right">Requests</th><th scope="col" className="th text-right">Rate limited</th></tr></thead>
              <tbody>{d.api_today.map((u) => <tr key={u.principal}><th scope="row" className="td text-left font-medium text-chalk-100">{u.principal}</th><td className="td num">{fmt.num(u.requests)}</td><td className={`td num ${u.limited ? 'text-note' : ''}`}>{fmt.num(u.limited)}</td></tr>)}</tbody>
            </table>
          )}
        </Section>
      </div>
      <p className="text-xs text-chalk-500">Updated {agoShort(d.generated_at, now)}; refreshes every 15 s.</p>
    </div>
  );
}
