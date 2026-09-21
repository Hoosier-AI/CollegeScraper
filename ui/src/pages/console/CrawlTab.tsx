// Crawl health: per-host fetches and errors from the fetch log, this process's counters, and the pause switches.
import { fmt } from '../../lib/api';
import { agoShort, useNow } from '../../lib/hooks';
import { useConsole, useConsoleAction, type CrawlData, type HostRow } from '../../lib/console';
import { DataTable, type Column } from '../../components/DataTable';
import { ErrorBox, Note, Section, SegmentedControl, Skeleton } from '../../components/primitives';
import { useUrlState } from '../../lib/urlState';
import { StatTile, Toggle } from './parts';

export default function CrawlTab() {
  const q = useConsole<CrawlData>('/crawl', { every: 30_000 });
  const now = useNow(15_000);
  const [win, setWin] = useUrlState('window', '24h', { replace: true, resetPage: false, allow: ['24h', '7d'] });
  const flags = useConsoleAction<{ crawl_paused?: boolean; scheduler_paused?: boolean }>((v) => ({ path: '/settings', method: 'PUT', body: v }), ['/crawl', '/overview', '/settings']);
  if (q.isPending) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const rows = win === '7d' ? d.hosts_7d : d.hosts_24h;
  const totals = rows.reduce((a, r) => ({ fetches: a.fetches + Number(r.fetches), errors: a.errors + Number(r.errors), s429: a.s429 + Number(r.status_429) }), { fetches: 0, errors: 0, s429: 0 });
  const pct = (r: HostRow) => (Number(r.fetches) ? (Number(r.errors) / Number(r.fetches)) * 100 : 0);
  const cols: Column<HostRow>[] = [
    { key: 'host', label: 'Host', primary: true, render: (r) => <span className="font-medium text-chalk-100">{r.host}</span> },
    { key: 'fetches', label: 'Fetches', num: true, value: (r) => Number(r.fetches) },
    { key: 'errors', label: 'Errors', num: true, value: (r) => Number(r.errors), render: (r) => <span className={Number(r.errors) ? 'text-note' : ''}>{fmt.num(r.errors)}</span> },
    { key: 'pct', label: 'Error %', num: true, value: pct, render: (r) => <span className={pct(r) > 2 ? 'text-loss' : ''}>{pct(r).toFixed(1)}</span> },
    { key: 'status_429', label: '429s', num: true, value: (r) => Number(r.status_429), render: (r) => <span className={Number(r.status_429) ? 'text-loss' : ''}>{fmt.num(r.status_429)}</span> },
    { key: 'retry_backlog', label: 'Retry backlog', num: true, value: (r) => Number(r.retry_backlog), priority: 2 },
    { key: 'last_error', label: 'Last error', render: (r) => <span className="text-xs text-chalk-400">{r.last_error ?? ''}{r.last_error_at ? ` · ${agoShort(r.last_error_at, now)}` : ''}</span>, className: 'max-w-[320px]', wrap: true, priority: 2 },
  ];
  const p = d.process;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={`Fetches, ${win}`} value={fmt.num(totals.fetches)} sub={`${rows.length} hosts`} />
        <StatTile label="Errors" value={fmt.num(totals.errors)} sub={totals.fetches ? `${((totals.errors / totals.fetches) * 100).toFixed(2)}% — expect under 2%` : ''} tone={totals.fetches && totals.errors / totals.fetches > 0.02 ? 'warn' : undefined} />
        <StatTile label="429 Too Many Requests" value={fmt.num(totals.s429)} tone={totals.s429 ? 'bad' : 'ok'} sub={totals.s429 ? 'a host is asking us to slow down' : 'nobody is asking us to slow down'} />
        <StatTile label="Stored pages" value={fmt.num(d.cache_rows)} sub="fetch cache rows" />
      </div>
      <Section title="Pauses">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="frame flex items-center justify-between gap-3 p-3"><div><div className="text-sm font-medium text-chalk-100">Crawling</div><div className="text-xs text-chalk-400">Paused: the crawl worker claims no runs; queued runs wait. Live scores keep going.</div></div><Toggle on={!d.flags.crawl_paused} label="Crawling on" busy={flags.isPending} onChange={(v) => flags.mutate({ crawl_paused: !v })} /></div>
          <div className="frame flex items-center justify-between gap-3 p-3"><div><div className="text-sm font-medium text-chalk-100">Scheduler</div><div className="text-xs text-chalk-400">Paused: nothing is queued on a timer, including live.</div></div><Toggle on={!d.flags.scheduler_paused} label="Scheduler on" busy={flags.isPending} onChange={(v) => flags.mutate({ scheduler_paused: !v })} /></div>
        </div>
      </Section>
      <Section title="By host" right={<SegmentedControl label="Window" size="sm" value={win as '24h' | '7d'} onChange={setWin} options={[{ value: '24h', label: '24 h' }, { value: '7d', label: '7 days' }]} />}>
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.host} caption="Fetches by host" defaultSort={{ key: 'fetches', dir: 'desc' }} dense maxHeight="60vh" empty={<span>No fetches in this window.</span>} />
        <Note>Errors count 5xx, 429 and network failures; 404 probes are not errors. Every host is limited to one request per second.</Note>
      </Section>
      {p && (
        <Section title="This process since start">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Requests" value={fmt.num(p.totals.requests)} />
            <StatTile label="Served from cache" value={fmt.num(p.totals.cacheHits)} />
            <StatTile label="Not modified" value={fmt.num(p.totals.notModified)} />
            <StatTile label="Errors" value={fmt.num(p.totals.errors)} />
            <StatTile label="429s" value={fmt.num(p.totals.status429)} tone={p.totals.status429 ? 'bad' : undefined} />
            <StatTile label="Blocked by robots" value={fmt.num(p.totals.robotsBlocked)} />
          </div>
        </Section>
      )}
      <p className="text-xs text-chalk-500">Updated {agoShort(d.generated_at, now)}.</p>
    </div>
  );
}
