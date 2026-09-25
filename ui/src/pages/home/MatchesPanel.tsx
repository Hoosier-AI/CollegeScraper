// Matches for the chosen scope: what is live, what is coming (today first, then the next days) and the latest
// results (today and yesterday). Ranked sides lead each list; days are headed so a thin night never looks empty.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useHref } from '../../lib/filters';
import { longDay, shiftIso, todayEastern } from '../../lib/dates';
import { EmptyState, SegmentedControl, Skeleton } from '../../components/primitives';
import { MatchRow } from '../../components/match/MatchRow';
import { Panel, type Scope } from './Panel';

type Tab = 'live' | 'upcoming' | 'results';
const MAX = 12;
const plural = (n: number, one: string, many = `${one}es`) => `${n} ${n === 1 ? one : many}`;

export function MatchesPanel({ scope, className }: { scope: Scope; className?: string }) {
  const href = useHref();
  const today = todayEastern();
  const yesterday = shiftIso(today, -1);
  const q = useQuery({
    queryKey: ['home-window', yesterday, scope.gender, scope.division],
    queryFn: () => api<any>(`/api/matches${qs({ date: yesterday, days: 7, gender: scope.gender, division: scope.division })}`),
    refetchInterval: (x) => ((x.state.data?.live ?? 0) > 0 ? 30_000 : 120_000),
  });
  const all: any[] = q.data?.games ?? [];
  const bestRank = (g: any) => Math.min(g.home.rank ?? 99, g.away.rank ?? 99);
  const kick = (g: any) => (g.kickoff_tbd || g.start_epoch == null ? Number.MAX_SAFE_INTEGER : g.start_epoch);
  const groups: Record<Tab, any[]> = useMemo(() => ({
    live: all.filter((g) => g.status === 'live').sort((a, b) => bestRank(a) - bestRank(b)),
    upcoming: all.filter((g) => g.status === 'scheduled' && !g.result_pending && g.game_date >= today)
      .sort((a, b) => a.game_date.localeCompare(b.game_date) || Number(bestRank(a) >= 99) - Number(bestRank(b) >= 99) || kick(a) - kick(b)),
    results: all.filter((g) => g.game_date <= today && (g.status === 'final' || g.result_pending))
      .sort((a, b) => b.game_date.localeCompare(a.game_date) || Number(bestRank(a) >= 99) - Number(bestRank(b) >= 99) || kick(b) - kick(a)),
  }), [all, today]);
  const fallback: Tab = groups.live.length ? 'live' : groups.upcoming.some((g) => g.game_date === today) || !groups.results.length ? 'upcoming' : 'results';
  const [tab, setTab] = useState<Tab | null>(null);
  useEffect(() => { setTab(null); }, [scope.gender, scope.division]);
  const active = tab ?? fallback;
  const list = groups[active].slice(0, MAX);
  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const g of list) m.set(g.game_date, [...(m.get(g.game_date) ?? []), g]);
    return [...m];
  }, [list]);
  const dayTitle = (d: string) => (d === today ? 'Today' : d === yesterday ? 'Yesterday' : d === shiftIso(today, 1) ? 'Tomorrow' : longDay(d));
  const todayCount = all.filter((g) => g.game_date === today).length;
  const options = (['live', 'upcoming', 'results'] as Tab[]).map((t) => ({ value: t, label: `${t === 'live' ? 'Live' : t === 'upcoming' ? 'Upcoming' : 'Results'} ${groups[t].length}` }));
  return (
    <Panel className={className} title="Matches"
      meta={q.data ? `${todayCount ? `${plural(todayCount, 'match')} today` : 'No matches today'}; home team listed first, ranked teams first` : undefined}
      action={all.length ? <SegmentedControl label="Which matches" size="sm" value={active} onChange={setTab} options={options} /> : undefined}
      footer={all.length ? { to: href('/matches', { gender: scope.gender, division: scope.division }), label: 'Full schedule and results' } : null}>
      {q.isPending && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
      {q.data && !all.length && <EmptyState title="No matches this week" body="Try another division, or the full schedule." />}
      {q.data && all.length > 0 && !list.length && <p className="py-8 text-center text-sm text-chalk-500">{active === 'live' ? 'Nothing in play right now.' : active === 'upcoming' ? 'No more matches scheduled this week.' : 'No results in the last two days.'}</p>}
      <div className="space-y-4">
        {byDay.map(([d, games]) => (
          <div key={d}>
            <h3 className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-chalk-400"><span>{dayTitle(d)}{d !== today && d !== yesterday && d !== shiftIso(today, 1) ? '' : `, ${longDay(d)}`}</span><span className="text-chalk-500">{plural(groups[active].filter((g) => g.game_date === d).length, 'match')}</span></h3>
            <div className="frame divide-y divide-field-700">{games.map((g) => <MatchRow key={g.id} g={g} dense />)}</div>
          </div>
        ))}
      </div>
      {groups[active].length > MAX && <p className="mt-2 text-xs text-chalk-500">Showing {MAX} of {groups[active].length}.</p>}
    </Panel>
  );
}
