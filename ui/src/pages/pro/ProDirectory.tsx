// The player directory (/pro/players) and the leaders (/pro/leaders): the same filters over every competition's
// current season (nationality, position, age, competition, men's/women's, minimum minutes); the directory lists by
// minutes played, the leaders page by any stat, totals or per 90.
import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { useUrlNumber, useUrlState } from '../../lib/urlState';
import { PRO_STATS, statLabel, useCountries, type ProLeagueRef } from '../../lib/pro';
import { LeadersTable, type LeaderRow } from '../../components/pro/People';
import { ErrorBox, Field, PageHeader, Pager, SegmentedControl, Select } from '../../components/primitives';

interface Page { stat: string; per90: boolean; min_minutes: number; total: number; limit: number; offset: number; rows: LeaderRow[] }
const PAGE = 50;

export default function ProDirectory({ mode }: { mode: 'players' | 'leaders' }) {
  const leaders = mode === 'leaders';
  const [stat, setStat] = useUrlState('stat', leaders ? 'goals' : 'minutes', { allow: PRO_STATS.map((s) => s.key) });
  const [position, setPosition] = useUrlState('position', '', { allow: ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'] });
  const [nationality, setNationality] = useUrlState('nationality');
  const [league, setLeague] = useUrlState('league');
  const [gender, setGender] = useUrlState('gender', '', { allow: ['m', 'w'] });
  const [age, setAge] = useUrlState('age', '', { allow: ['u21', 'u23', '23-29', '30+'] });
  const [rate, setRate] = useUrlState('per90', '', { allow: ['1'] });
  const [page, setPage] = useUrlNumber('page', 1, { min: 1 });
  const countries = useCountries();
  const leagues = useQuery({ queryKey: ['pro-leagues'], queryFn: () => api<(ProLeagueRef & { priority: number })[]>('/api/pro/leagues'), staleTime: 300_000 });
  const ages: Record<string, [number | undefined, number | undefined]> = { u21: [undefined, 20], u23: [undefined, 22], '23-29': [23, 29], '30+': [30, undefined] };
  const [minAge, maxAge] = ages[age] ?? [undefined, undefined];
  const q = useQuery({
    queryKey: ['pro-directory', stat, position, nationality, league, gender, age, rate, page],
    queryFn: () => api<Page>(`/api/pro/leaders${qs({ stat, position, nationality, league, gender, min_age: minAge, max_age: maxAge, per90: leaders ? rate : '', limit: PAGE, offset: (page - 1) * PAGE })}`),
    placeholderData: keepPreviousData,
  });
  const leagueOptions = useMemo(() => [{ value: '', label: 'Every competition' }, ...(leagues.data ?? []).slice(0, 400).map((l) => ({ value: String(l.id), label: `${l.name}${l.country && l.country !== 'World' ? ` (${l.country})` : ''}` }))], [leagues.data]);
  const natOptions = useMemo(() => [{ value: '', label: 'Any nationality' }, ...countries.list.map((c) => ({ value: c.name, label: c.name }))], [countries.list]);
  const title = leaders ? `${statLabel(stat)} leaders` : 'Players';
  return (
    <div className="space-y-4">
      <PageHeader title={title} meta={q.data ? `${fmt.num(q.data.total)} player seasons, current season of each competition${q.data.min_minutes ? `, ${q.data.min_minutes}+ minutes` : ''}` : 'Every competition we follow'}>
        {leaders && <Field label="Stat">{(id) => <Select id={id} value={stat} onChange={(v) => { setStat(v); setPage(1); }} options={PRO_STATS.map((s) => ({ value: s.key, label: s.label }))} />}</Field>}
        {leaders && <Field label="Numbers">{() => <SegmentedControl label="Numbers" size="sm" value={rate} onChange={(v) => { setRate(v); setPage(1); }} options={[{ value: '', label: 'Totals' }, { value: '1', label: 'Per 90' }]} />}</Field>}
      </PageHeader>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Competition">{(id) => <Select id={id} value={league} onChange={(v) => { setLeague(v); setPage(1); }} options={leagueOptions} className="max-w-[260px]" />}</Field>
        <Field label="Nationality">{(id) => <Select id={id} value={nationality} onChange={(v) => { setNationality(v); setPage(1); }} options={natOptions} className="max-w-[200px]" />}</Field>
        <Field label="Position">{() => <SegmentedControl label="Position" size="sm" value={position} onChange={(v) => { setPosition(v); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'Goalkeeper', label: 'GK' }, { value: 'Defender', label: 'DF' }, { value: 'Midfielder', label: 'MF' }, { value: 'Attacker', label: 'FW' }]} />}</Field>
        <Field label="Age">{() => <SegmentedControl label="Age" size="sm" value={age} onChange={(v) => { setAge(v); setPage(1); }} options={[{ value: '', label: 'Any' }, { value: 'u21', label: 'U21' }, { value: 'u23', label: 'U23' }, { value: '23-29', label: '23-29' }, { value: '30+', label: '30+' }]} />}</Field>
        <Field label="Game">{() => <SegmentedControl label="Men's or women's" size="sm" value={gender} onChange={(v) => { setGender(v); setPage(1); }} options={[{ value: '', label: 'Both' }, { value: 'm', label: "Men's" }, { value: 'w', label: "Women's" }]} />}</Field>
      </div>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      <div className={q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}>
        <LeadersTable rows={q.data?.rows ?? []} stat={stat} per90={!!(leaders && rate)} caption={title} loading={q.isPending} />
      </div>
      {q.data && q.data.total > PAGE && <Pager page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} busy={q.isFetching} noun="players" />}
    </div>
  );
}
