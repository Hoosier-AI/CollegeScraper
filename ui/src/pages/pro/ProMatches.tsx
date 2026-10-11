// The pro scoreboard: every match of a day across enabled competitions, grouped by competition in priority order.
import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { isIso, longDay, todayEastern } from '../../lib/dates';
import { DateStrip } from '../../components/match/DateStrip';
import { LeagueHeading, ProMatchRow } from '../../components/pro/ProMatchRow';
import { Chip, EmptyState, ErrorBox, PageHeader, Skeleton } from '../../components/primitives';
import type { ProDay } from '../../lib/pro';
import { useProGender } from '../../lib/proGender';

export default function ProMatches() {
  const patch = useUrlPatch();
  const today = todayEastern();
  const [dateParam] = useUrlState('date', '');
  const date = isIso(dateParam) ? dateParam : today;
  const [show, setShow] = useUrlState('show', '', { allow: ['live', 'featured'] });
  const [gender] = useProGender();
  const q = useQuery({
    queryKey: ['pro-matches', date],
    queryFn: () => api<ProDay>(`/api/pro/matches${qs({ date })}`),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => ((query.state.data?.live ?? 0) > 0 ? 60_000 : false),
  });
  const groups = useMemo(() => (q.data?.groups ?? []).map((g) => ({ ...g, matches: g.matches.filter((m) => show !== 'live' || m.status === 'live') }))
    .filter((g) => g.matches.length && g.league.gender === gender && (show !== 'featured' || g.priority < 100)), [q.data, show, gender]);
  const liveCount = (q.data?.groups ?? []).filter((g) => g.league.gender === gender).reduce((n, g) => n + g.matches.filter((m) => m.status === 'live').length, 0);
  const setDate = (iso: string) => patch({ date: iso === today ? null : iso }, { replace: false });
  const count = groups.reduce((n, g) => n + g.matches.length, 0);
  // Hundreds of competitions play on a weekend: the top ones and any with a match in play show; the rest wait in one
  // "More competitions" section, a line each. A filter shows everything it keeps.
  const lead = (g: (typeof groups)[number]) => !!show || g.priority < 100 || g.matches.some((m) => m.status === 'live');
  const main = groups.filter(lead), rest = groups.filter((g) => !lead(g));
  const restCount = rest.reduce((n, g) => n + g.matches.length, 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Pro matches" meta={`${longDay(date)}, ${q.data ? `${count} ${gender === 'w' ? "women's" : "men's"} matches in ${groups.length} competitions` : 'loading'}`} />
      <DateStrip date={date} today={today} onChange={setDate} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-chalk-400" role="group" aria-label="Show only">
        <Chip on={show === 'live'} onClick={() => setShow(show === 'live' ? '' : 'live')}>Live{liveCount ? ` (${liveCount})` : ''}</Chip>
        <Chip on={show === 'featured'} onClick={() => setShow(show === 'featured' ? '' : 'featured')}>Top competitions</Chip>
      </div>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
      {q.data && !groups.length && <EmptyState title={`No matches on ${longDay(date)}`} body={show ? 'Clear the filter to see every competition.' : 'Try another day.'} action={show ? <button className="btn-ghost btn-sm" onClick={() => setShow('')}>Show all</button> : undefined} />}
      <div className={`space-y-3 ${q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}`}>
        <div className={`gap-3 ${main.length > 2 ? 'xl:columns-2' : ''}`}>
          {main.map((g) => (
            <section key={g.league.id} className="frame mb-3 break-inside-avoid divide-y divide-field-700 overflow-hidden" aria-label={g.league.name}>
              <LeagueHeading league={g.league} right={<GroupCount g={g} />} />
              {g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}
            </section>
          ))}
        </div>
        {rest.length > 0 && (
          <details className="group/more">
            <summary className="btn-ghost btn-sm w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <ChevronDown size={14} aria-hidden className="transition-transform duration-150 group-open/more:rotate-180 motion-reduce:transition-none" />
              More competitions: {rest.length}, {restCount} matches
            </summary>
            <div className="mt-3 gap-3 xl:columns-2">
              {rest.map((g) => (
                <details key={g.league.id} className="group frame mb-2 break-inside-avoid overflow-hidden" aria-label={g.league.name}>
                  <summary className="flex cursor-pointer list-none items-center hover:bg-field-800 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1"><LeagueHeading league={g.league} right={<GroupCount g={g} />} /></span>
                    <ChevronDown size={14} aria-hidden className="mr-3 shrink-0 text-chalk-500 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <div className="divide-y divide-field-700 border-t border-field-700">{g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}</div>
                </details>
              ))}
            </div>
          </details>
        )}
      </div>
      {q.data && <p className="text-xs text-chalk-500">Kickoffs are in your local time. Scores refresh every few minutes while matches are in play.</p>}
    </div>
  );
}

function GroupCount({ g }: { g: ProDay['groups'][number] }) {
  const live = g.matches.filter((m) => m.status === 'live').length;
  return <span className="tnum">{live > 0 && <span className="mr-2 font-semibold text-win">{live} live</span>}{g.matches.length}</span>;
}
