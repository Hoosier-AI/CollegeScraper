// The pro scoreboard: every match of a day across enabled competitions, grouped by competition in priority order.
// On International (/intl/matches) the same for national teams; a day without any shows the next match day's scoreboard
// and the last one's results instead (internationals come in windows a few days long, a month or two apart).
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
import { listApi, useSection } from '../../lib/section';
import { useProGender } from '../../lib/proGender';

export default function ProMatches() {
  const section = useSection();
  const intl = section === 'intl';
  const patch = useUrlPatch();
  const today = todayEastern();
  const [dateParam] = useUrlState('date', '');
  const date = isIso(dateParam) ? dateParam : today;
  const [show, setShow] = useUrlState('show', '', { allow: ['live', 'featured'] });
  const [gender] = useProGender();
  const q = useQuery({
    queryKey: ['pro-matches', section, date],
    queryFn: () => api<ProDay>(`${listApi(section, 'matches')}${qs({ date })}`),
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
  // International days are a few dozen qualifiers and friendlies: every one is shown.
  const lead = (g: (typeof groups)[number]) => intl || !!show || g.priority < 100 || g.matches.some((m) => m.status === 'live');
  const main = groups.filter(lead), rest = groups.filter((g) => !lead(g));
  const restCount = rest.reduce((n, g) => n + g.matches.length, 0);
  // Pro: the US scene, then the world. International: one list.
  const blocks = intl ? [{ title: '', list: main }] : [{ title: 'United States', list: main.filter((g) => g.league.us) }, { title: 'Around the world', list: main.filter((g) => !g.league.us) }];
  return (
    <div className="space-y-4">
      <PageHeader title={intl ? 'International matches' : 'Pro matches'} meta={`${longDay(date)}, ${q.data ? (count ? `${count} ${gender === 'w' ? "women's" : "men's"} matches in ${groups.length} competitions` : `no ${gender === 'w' ? "women's" : "men's"} matches`) : 'loading'}`} />
      <DateStrip date={date} today={today} onChange={setDate} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-chalk-400" role="group" aria-label="Show only">
        <Chip on={show === 'live'} onClick={() => setShow(show === 'live' ? '' : 'live')}>Live{liveCount ? ` (${liveCount})` : ''}</Chip>
        <Chip on={show === 'featured'} onClick={() => setShow(show === 'featured' ? '' : 'featured')}>Top competitions</Chip>
      </div>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
      {q.data && !groups.length && (intl && !show
        ? <IntlQuietDay date={date} gender={gender} onOpen={setDate} />
        : <EmptyState title={`No ${intl ? 'international ' : ''}matches on ${longDay(date)}`} body={show ? 'Clear the filter to see every competition.' : 'Try another day.'} action={show ? <button className="btn-ghost btn-sm" onClick={() => setShow('')}>Show all</button> : undefined} />)}
      <div className={`space-y-3 ${q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}`}>
        {/* US first (most visitors are American): the US scene under its own heading, then the rest of the world. */}
        {blocks.map(({ title, list }) => list.length > 0 && (
          <section key={title || 'all'} className="space-y-2" aria-label={title || 'Competitions'}>
            {title && <h2 className="text-sm font-semibold text-chalk-100">{title}</h2>}
            {(() => {
              // A competition with most of the block's matches (MLS on a full night) beside two short ones left half the
              // width empty: it gets the full width with its own matches in two columns, and the others follow.
              const total = list.reduce((n, g) => n + g.matches.length, 0);
              const wide = list.length > 1 ? list.filter((g) => g.matches.length >= 8 && g.matches.length * 3 >= total * 2) : [];
              const narrow = list.filter((g) => !wide.includes(g));
              return <>
                {wide.map((g) => (
                  <section key={g.league.id} className="frame mb-3 overflow-hidden" aria-label={g.league.name}>
                    <div className="border-b border-field-700"><LeagueHeading league={g.league} right={<GroupCount g={g} />} /></div>
                    <div className="xl:columns-2 xl:gap-0 [&>*]:break-inside-avoid [&>*]:border-b [&>*]:border-field-700 xl:[&>*]:border-r">{g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}</div>
                  </section>
                ))}
                <div className={`gap-3 ${narrow.length > 1 && (wide.length || narrow.length > 2) ? 'xl:columns-2' : ''}`}>
                  {narrow.map((g) => (
                    <section key={g.league.id} className="frame mb-3 break-inside-avoid divide-y divide-field-700 overflow-hidden" aria-label={g.league.name}>
                      <LeagueHeading league={g.league} right={<GroupCount g={g} />} />
                      {g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}
                    </section>
                  ))}
                </div>
              </>;
            })()}
          </section>
        ))}
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

type Around = { date: string; total: number; live: number; groups: ProDay['groups'] };

/** International, a day without matches: the next match day's scoreboard (any day ahead, however far), then the last
 *  match day's results. Each opens as its own day. */
function IntlQuietDay({ date, gender, onOpen }: { date: string; gender: 'm' | 'w'; onOpen: (iso: string) => void }) {
  const q = useQuery({ queryKey: ['intl-around', date, gender], queryFn: () => api<{ next: Around | null; prev: Around | null }>(`/api/intl/around${qs({ date, gender })}`), staleTime: 120_000 });
  const game = gender === 'w' ? "women's" : "men's";
  if (q.isPending) return <div className="space-y-2" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const { next, prev } = q.data!;
  if (!next && !prev) return <EmptyState title={`No ${game} international matches on ${longDay(date)}`} body="None scheduled yet." />;
  return (
    <div className="space-y-5">
      <p className="rounded-md border border-field-700 bg-field-900/60 px-3 py-2 text-sm text-chalk-300">
        No {game} international matches on {longDay(date)}. National teams play in windows a few days long{next ? <>; the next is <strong className="font-semibold text-chalk-100">{longDay(next.date)}</strong></> : ''}.
      </p>
      {next && <DayBoard title={`Next match day: ${longDay(next.date)}`} day={next} onOpen={onOpen} />}
      {prev && <DayBoard title={`Latest results: ${longDay(prev.date)}`} day={prev} onOpen={onOpen} />}
    </div>
  );
}

function DayBoard({ title, day, onOpen }: { title: string; day: Around; onOpen: (iso: string) => void }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-chalk-100">{title} <span className="font-normal text-chalk-400">· {day.total} {day.total === 1 ? 'match' : 'matches'}</span></h2>
        <button type="button" className="btn-ghost btn-sm" onClick={() => onOpen(day.date)}>Open this day</button>
      </div>
      <div className={`gap-3 ${day.groups.length > 2 ? 'xl:columns-2' : ''}`}>
        {day.groups.map((g) => (
          <section key={g.league.id} className="frame mb-3 break-inside-avoid divide-y divide-field-700 overflow-hidden" aria-label={g.league.name}>
            <LeagueHeading league={g.league} right={<GroupCount g={g} />} />
            {g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}
          </section>
        ))}
      </div>
    </section>
  );
}
