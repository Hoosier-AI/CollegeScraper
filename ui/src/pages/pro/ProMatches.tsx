// The pro scoreboard: every match of a day across enabled competitions, grouped by competition in priority order.
import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { isIso, longDay, todayEastern } from '../../lib/dates';
import { DateStrip } from '../../components/match/DateStrip';
import { LeagueHeading, ProMatchRow } from '../../components/pro/ProMatchRow';
import { Chip, EmptyState, ErrorBox, PageHeader, Skeleton } from '../../components/primitives';
import type { ProDay } from '../../lib/pro';

export default function ProMatches() {
  const patch = useUrlPatch();
  const today = todayEastern();
  const [dateParam] = useUrlState('date', '');
  const date = isIso(dateParam) ? dateParam : today;
  const [show, setShow] = useUrlState('show', '', { allow: ['live', 'featured', 'women'] });
  const q = useQuery({
    queryKey: ['pro-matches', date],
    queryFn: () => api<ProDay>(`/api/pro/matches${qs({ date })}`),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => ((query.state.data?.live ?? 0) > 0 ? 60_000 : false),
  });
  const groups = useMemo(() => (q.data?.groups ?? []).map((g) => ({ ...g, matches: g.matches.filter((m) => show !== 'live' || m.status === 'live') }))
    .filter((g) => g.matches.length && (show !== 'featured' || g.priority < 100) && (show !== 'women' || g.league.gender === 'w')), [q.data, show]);
  const setDate = (iso: string) => patch({ date: iso === today ? null : iso }, { replace: false });
  const count = groups.reduce((n, g) => n + g.matches.length, 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Pro matches" meta={`${longDay(date)}, ${q.data ? `${count} matches in ${groups.length} competitions` : 'loading'}`} />
      <DateStrip date={date} today={today} onChange={setDate} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-chalk-400" role="group" aria-label="Show only">
        <Chip on={show === 'live'} onClick={() => setShow(show === 'live' ? '' : 'live')}>Live{q.data?.live ? ` (${q.data.live})` : ''}</Chip>
        <Chip on={show === 'featured'} onClick={() => setShow(show === 'featured' ? '' : 'featured')}>Top competitions</Chip>
        <Chip on={show === 'women'} onClick={() => setShow(show === 'women' ? '' : 'women')}>Women's</Chip>
      </div>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
      {q.data && !groups.length && <EmptyState title={`No matches on ${longDay(date)}`} body={show ? 'Clear the filter to see every competition.' : 'Try another day.'} action={show ? <button className="btn-ghost btn-sm" onClick={() => setShow('')}>Show all</button> : undefined} />}
      <div className={`space-y-3 ${q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}`}>
        {groups.map((g) => (
          <section key={g.league.id} className="frame divide-y divide-field-700" aria-label={g.league.name}>
            <LeagueHeading league={g.league} right={<span className="tnum">{g.matches.length}</span>} />
            {g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}
          </section>
        ))}
      </div>
      {q.data && <p className="text-xs text-chalk-500">Kickoffs are in your local time. Scores refresh every few minutes while matches are in play.</p>}
    </div>
  );
}
