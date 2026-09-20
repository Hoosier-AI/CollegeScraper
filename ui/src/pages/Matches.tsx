// Matchday: every game of a day, live first, with the date strip as the one loud element.
import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useFilters, genderLabel, divisionLabel } from '../lib/filters';
import { useUrlPatch, useUrlState } from '../lib/urlState';
import { isIso, longDay, shiftIso, todayEastern } from '../lib/dates';
import { DateStrip } from '../components/match/DateStrip';
import { MatchRow, type MatchLike } from '../components/match/MatchRow';
import { Chip, EmptyState, ErrorBox, Field, PageHeader, SegmentedControl, Select, Skeleton } from '../components/primitives';

const DIV_OPTIONS = [{ value: '', label: 'All' }, { value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];
const GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'live', label: 'Live', statuses: ['live'] },
  { key: 'upcoming', label: 'Upcoming', statuses: ['scheduled'] },
  { key: 'final', label: 'Final', statuses: ['final'] },
  { key: 'other', label: 'Postponed or cancelled', statuses: ['postponed', 'cancelled'] },
];

interface MatchesResponse { from: string; to: string; season: number; live: number; games: (MatchLike & { division: string | null })[]; generated_at: string }

/** Re-renders every 15 s so "updated N s ago" stays honest. */
function useNow(ms = 15_000) { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]); return now; }

export default function Matches() {
  const f = useFilters();
  const patch = useUrlPatch();
  const today = todayEastern();
  const [dateParam] = useUrlState('date', '');
  const date = isIso(dateParam) ? dateParam : today;
  const [division, setDivision] = useUrlState('division', '', { allow: ['d1', 'd2', 'd3'] });
  const [conference, setConference] = useUrlState('conference');
  const [only, setOnly] = useUrlState('only', '', { allow: ['conf', 'ranked'] });
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ conferences: { id: string; name: string; division: string | null }[] }>('/api/meta') });
  const q = useQuery({
    queryKey: ['matches', date, f.gender, division, conference, only],
    queryFn: () => api<MatchesResponse>(`/api/matches${qs({ date, gender: f.gender, division, conference, only })}`),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => ((query.state.data?.live ?? 0) > 0 ? 60_000 : false),
  });
  // A week's look-ahead so an empty day can say when the next matches are and the strip can show counts.
  const week = useQuery({ queryKey: ['matches-week', date, f.gender, division, conference], queryFn: () => api<MatchesResponse>(`/api/matches${qs({ date: shiftIso(date, -3), days: 7, gender: f.gender, division, conference })}`), staleTime: 120_000 });
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const g of week.data?.games ?? []) c[g.game_date] = (c[g.game_date] ?? 0) + 1; return c; }, [week.data]);
  const now = useNow();
  const games = q.data?.games ?? [];
  const confOptions = useMemo(() => [{ value: '', label: 'All conferences' }, ...(meta.data?.conferences ?? []).filter((c) => !division || c.division === division).map((c) => ({ value: c.id, label: c.name }))], [meta.data, division]);
  const setDate = (iso: string) => patch({ date: iso === today ? null : iso }, { replace: false });
  const nextWithGames = (week.data?.games ?? []).map((g) => g.game_date).filter((d) => d > date).sort()[0];
  const scope = [division ? divisionLabel(division) : 'all divisions', genderLabel(f.gender)].join(', ');
  const updated = q.data?.generated_at ? Math.max(0, Math.round((now - Date.parse(q.data.generated_at)) / 1000)) : null;
  return (
    <div className="space-y-4">
      <PageHeader title="Matches" meta={`${longDay(date)}, ${scope}`}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={(v) => { setDivision(v); if (conference) setConference(''); }} options={DIV_OPTIONS} />}</Field>
        <Field label="Conference">{(id) => <Select id={id} value={conference} onChange={setConference} options={confOptions} className="max-w-[220px]" />}</Field>
      </PageHeader>
      <DateStrip date={date} today={today} onChange={setDate} counts={counts} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-chalk-400" role="group" aria-label="Show only">
        <Chip on={only === 'conf'} onClick={() => setOnly(only === 'conf' ? '' : 'conf')}>Conference games</Chip>
        <Chip on={only === 'ranked'} onClick={() => setOnly(only === 'ranked' ? '' : 'ranked')}>Ranked teams</Chip>
        {q.data && <span className="ml-auto text-chalk-500">{q.data.games.length} matches{q.data.live ? `, ${q.data.live} live` : ''}{updated != null && q.data.live ? ` · updated ${updated} s ago` : ''}</span>}
      </div>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
      {q.data && !games.length && (
        <EmptyState title={`No matches on ${longDay(date)}`} body={nextWithGames ? `The next matchday is ${longDay(nextWithGames)}.` : 'Try another day or widen the filters.'}
          action={nextWithGames ? <button className="btn-ghost btn-sm" onClick={() => setDate(nextWithGames)}>Go to {longDay(nextWithGames)}</button> : undefined} />
      )}
      <div className={`space-y-6 ${q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}`}>
        {GROUPS.map((grp) => {
          const rows = games.filter((g) => grp.statuses.includes(g.status));
          if (!rows.length) return null;
          const byDiv = new Map<string, typeof rows>();
          for (const g of rows) { const k = g.division ?? 'other'; byDiv.set(k, [...(byDiv.get(k) ?? []), g]); }
          return (
            <section key={grp.key} aria-labelledby={`grp-${grp.key}`} className="space-y-3">
              <h2 id={`grp-${grp.key}`} className="flex items-center gap-2 text-base font-semibold text-chalk-100">
                {grp.key === 'live' && <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-win motion-reduce:animate-none" />}{grp.label}<span className="text-sm font-normal text-chalk-500 tnum">{rows.length}</span>
              </h2>
              {[...byDiv.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([div, list]) => (
                <div key={div} className="frame divide-y divide-field-700">
                  {!division && <div className="px-3 py-1.5 text-2xs font-medium text-chalk-500">{divisionLabel(div)}</div>}
                  {list.map((g) => <MatchRow key={g.id} g={g} />)}
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {q.data && <p className="text-xs text-chalk-500">Scores update every 3 minutes while matches are in play. Kickoffs are shown in your local time.</p>}
    </div>
  );
}
