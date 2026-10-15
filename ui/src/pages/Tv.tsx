// College games on TV and streaming in the next seven days: the network each school lists on its schedule (else
// NCAA.com's), by day, live first. Only games with a listing appear; most smaller games have none.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tv as TvIcon } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useFilters } from '../lib/filters';
import { useUrlState } from '../lib/urlState';
import { longDay, todayEastern } from '../lib/dates';
import { EmptyState, ErrorBox, Field, PageHeader, Select, SegmentedControl, Skeleton } from '../components/primitives';
import { MatchRow, type MatchLike } from '../components/match/MatchRow';

const DIV_OPTIONS = [{ value: '', label: 'All' }, { value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];

export default function Tv() {
  const f = useFilters();
  const [division, setDivision] = useUrlState('division', '', { allow: ['d1', 'd2', 'd3'] });
  const [network, setNetwork] = useUrlState('network');
  const today = todayEastern();
  const q = useQuery({
    queryKey: ['tv', today, f.gender, division],
    queryFn: () => api<{ games: (MatchLike & { broadcast: { network: string | null; url: string | null } | null })[] }>(`/api/matches${qs({ date: today, days: 7, gender: f.gender, division, on_tv: 1 })}`),
    refetchInterval: 60_000,
  });
  const games = useMemo(() => (q.data?.games ?? []).filter((g) => g.status !== 'final' && g.status !== 'cancelled' && g.status !== 'postponed'), [q.data]);
  // Networks with how many games each, most first, for the filter.
  const networks = useMemo(() => {
    const n = new Map<string, number>();
    for (const g of games) if (g.broadcast?.network) n.set(g.broadcast.network, (n.get(g.broadcast.network) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]);
  }, [games]);
  const shown = network ? games.filter((g) => g.broadcast?.network === network) : games;
  const byDay = new Map<string, typeof shown>();
  for (const g of shown) byDay.set(g.game_date, [...(byDay.get(g.game_date) ?? []), g]);
  return (
    <div className="space-y-5">
      <PageHeader title="On TV" meta={`College soccer on TV and streaming in the next seven days, ${f.gender === 'w' ? "women's" : "men's"}: the network each school lists on its schedule.`}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={setDivision} options={DIV_OPTIONS} />}</Field>
        <Field label="Network">{(id) => <Select id={id} value={network} onChange={setNetwork} className="max-w-[240px]" options={[{ value: '', label: `Every network (${games.length})` }, ...networks.map(([n, c]) => ({ value: n, label: `${n} (${c})` }))]} />}</Field>
      </PageHeader>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {q.data && !shown.length && <EmptyState icon={<TvIcon size={24} />} title="No games with a TV listing" body="Schools list the network on their schedules a few days ahead; most smaller games are not televised or streamed." />}
      {[...byDay].map(([day, list]) => (
        <section key={day} aria-labelledby={`tv-${day}`} className="space-y-2">
          <h2 id={`tv-${day}`} className="flex items-baseline gap-2 text-base font-semibold text-chalk-100">{day === today ? 'Today' : longDay(day)}<span className="text-xs font-normal text-chalk-500">{list.length} {list.length === 1 ? 'game' : 'games'}</span></h2>
          <div className="frame divide-y divide-field-700">{list.map((g) => <MatchRow key={g.id} g={g} />)}</div>
        </section>
      ))}
      {q.data && shown.length > 0 && <p className="text-xs text-chalk-500">From the schools' own schedules. Pro and international TV listings are not available yet.</p>}
    </div>
  );
}
