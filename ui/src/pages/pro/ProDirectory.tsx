// The player directory (/pro/players) and the leaders (/pro/leaders): the same filters over every competition's
// current season (nationality, position, age, competition, men's/women's, minimum minutes); the directory lists by
// minutes played, the leaders page by any stat, totals or per 90. On International (/intl/players, /intl/leaders) the
// same over national-team competitions, senior or youth.
import { useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { useUrlNumber, useUrlState } from '../../lib/urlState';
import { PRO_STATS, SCOPE_OPTIONS, proPath, statLabel, useCountries, type ProLeagueRef, type ProScope, type ProTeamRef } from '../../lib/pro';
import { LeadersTable, type LeaderRow } from '../../components/pro/People';
import { DataTable, type Column } from '../../components/DataTable';
import { TeamLogo } from '../../components/primitives';
import { ErrorBox, Field, PageHeader, Pager, SegmentedControl, Select } from '../../components/primitives';
import { useProGender } from '../../lib/proGender';
import { listApi, useSection } from '../../lib/section';

// Team leaders (Show: Teams): each team's current season in each competition.
const TEAM_STATS = [
  { key: 'points', label: 'Points' }, { key: 'ppg', label: 'Points a match', d: 2 }, { key: 'w', label: 'Wins' }, { key: 'gf', label: 'Goals scored' }, { key: 'gf_pg', label: 'Goals a match', d: 2 },
  { key: 'ga', label: 'Goals conceded (fewest)' }, { key: 'ga_pg', label: 'Conceded a match (fewest)', d: 2 }, { key: 'gd', label: 'Goal difference' }, { key: 'clean_sheets', label: 'Clean sheets' },
  { key: 'shots', label: 'Shots' }, { key: 'shots_on', label: 'Shots on target' }, { key: 'possession', label: 'Possession %', d: 1 }, { key: 'corners', label: 'Corners' }, { key: 'yellow', label: 'Yellow cards (fewest)' }, { key: 'red', label: 'Red cards (fewest)' },
] as const;
interface TeamRow { rank: number; team: ProTeamRef | null; league: ProLeagueRef | null; season: number; played: number; w: number; d: number; l: number; gf: number; ga: number; points: number; value: number }
interface TeamPage { stat: string; total: number; limit: number; offset: number; rows: TeamRow[] }

interface Page { stat: string; per90: boolean; min_minutes: number; total: number; limit: number; offset: number; rows: LeaderRow[] }
const PAGE = 50;

export default function ProDirectory({ mode }: { mode: 'players' | 'leaders' }) {
  const section = useSection();
  const intl = section === 'intl';
  const leaders = mode === 'leaders';
  const [kindParam, setKind] = useUrlState('kind', 'player', { allow: ['player', 'team'] });
  const teamsOn = leaders && kindParam === 'team';
  const [teamStat, setTeamStat] = useUrlState('tstat', 'points', { allow: TEAM_STATS.map((s) => s.key) });
  const { search } = useLocation();
  const [level, setLevel] = useUrlState('level', 'senior', { allow: ['senior', 'youth'] });
  const [stat, setStat] = useUrlState('stat', leaders ? 'goals' : 'minutes', { allow: PRO_STATS.map((s) => s.key) });
  const [position, setPosition] = useUrlState('position', '', { allow: ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'] });
  const [nationality, setNationality] = useUrlState('nationality');
  const [league, setLeague] = useUrlState('league');
  // US first: US competitions unless Worldwide is chosen (a competition picked from the list wins over either).
  const [scope, setScope] = useUrlState('scope', 'us', { allow: ['us', 'world'] }) as [ProScope, (v: string) => void];
  const [gender] = useProGender();
  const [age, setAge] = useUrlState('age', '', { allow: ['u21', 'u23', '23-29', '30+'] });
  const [rate, setRate] = useUrlState('per90', '', { allow: ['1'] });
  const [page, setPage] = useUrlNumber('page', 1, { min: 1 });
  const countries = useCountries();
  const leagues = useQuery({ queryKey: ['pro-leagues', section], queryFn: () => api<(ProLeagueRef & { priority: number })[]>(intl ? '/api/intl/tournaments' : '/api/pro/leagues'), staleTime: 300_000 });
  const ages: Record<string, [number | undefined, number | undefined]> = { u21: [undefined, 20], u23: [undefined, 22], '23-29': [23, 29], '30+': [30, undefined] };
  const [minAge, maxAge] = ages[age] ?? [undefined, undefined];
  // A competition picked under the other game is set aside (NWSL chosen, then Men): the toggle wins.
  const leagueGender = leagues.data?.find((l) => String(l.id) === league)?.gender;
  const leagueOn = league && (!leagueGender || leagueGender === gender) ? league : '';
  const q = useQuery({
    queryKey: ['pro-directory', section, stat, position, nationality, leagueOn, gender, age, rate, page, scope, level],
    queryFn: () => api<Page>(`${listApi(section, 'leaders')}${qs({ stat, position, nationality, league: leagueOn, gender, country: !intl && !leagueOn && scope === 'us' ? 'USA' : '', level: intl ? level : '', min_age: minAge, max_age: maxAge, per90: leaders ? rate : '', limit: PAGE, offset: (page - 1) * PAGE })}`),
    placeholderData: keepPreviousData,
    enabled: !teamsOn,
  });
  const tq = useQuery({
    queryKey: ['pro-team-leaders', section, teamStat, leagueOn, gender, page, scope, level],
    queryFn: () => api<TeamPage>(`${listApi(section, 'team-leaders')}${qs({ stat: teamStat, league: leagueOn, gender, scope: intl ? '' : scope, level: intl ? level : '', limit: PAGE, offset: (page - 1) * PAGE })}`),
    placeholderData: keepPreviousData,
    enabled: teamsOn,
  });
  const leagueOptions = useMemo(() => intl
    ? [{ value: '', label: 'Every tournament' }, ...(leagues.data ?? []).filter((l) => l.gender === gender && (l.level ?? 'senior') === level).map((l) => ({ value: String(l.id), label: l.name }))]
    : [{ value: '', label: scope === 'us' ? 'Every US competition' : 'Every competition' }, ...(leagues.data ?? []).filter((l) => l.gender === gender && (scope === 'world' || l.country === 'USA')).slice(0, 400).map((l) => ({ value: String(l.id), label: `${l.name}${l.country && l.country !== 'World' ? ` (${l.country})` : ''}` }))], [leagues.data, gender, scope, intl, level]);
  const natOptions = useMemo(() => [{ value: '', label: 'Any nationality' }, ...countries.list.map((c) => ({ value: c.name, label: c.name }))], [countries.list]);
  const [showFilters, setShowFilters] = useState(false);
  const active = [leagueOn, nationality, position, age].filter(Boolean).length;
  const tdef = TEAM_STATS.find((s) => s.key === teamStat) ?? TEAM_STATS[0];
  const title = teamsOn ? `Team leaders: ${tdef.label.replace(/ \(fewest\)$/, '').toLowerCase()}` : !leaders ? 'Players' : intl ? `International ${statLabel(stat).toLowerCase()} leaders` : `${statLabel(stat)} leaders`;
  // /intl/players was the leaders list until 2026-10-14: a link choosing a stat goes to /intl/leaders.
  if (intl && !leaders && new URLSearchParams(search).has('stat')) return <Navigate to={`/intl/leaders${search}`} replace />;
  const where = intl ? 'the current edition of each national-team competition' : !leagueOn && scope === 'us' ? (gender === 'w' ? 'NWSL, USL Super League and other US competitions' : 'MLS, USL, MLS NEXT Pro and other US competitions') : 'current season of each competition';
  const teamCols: Column<TeamRow>[] = [
    { key: 'rank', label: '#', num: true, sortable: false, value: (r) => r.rank },
    { key: 'team', label: 'Team', primary: true, sortable: false, render: (r) => r.team ? <span className="flex items-center gap-2"><TeamLogo src={r.team.logo} name={r.team.name} size={20} /><span className="truncate">{r.team.name}</span></span> : '–' },
    { key: 'league', label: 'Competition', sortable: false, priority: 2, render: (r) => r.league?.name ?? '–' },
    { key: 'played', label: 'P', title: 'Played', num: true, sortable: false, value: (r) => r.played },
    { key: 'rec', label: 'W-D-L', sortable: false, priority: 2, render: (r) => `${r.w}-${r.d}-${r.l}` },
    { key: 'goals', label: 'Goals', sortable: false, priority: 2, render: (r) => `${r.gf}:${r.ga}` },
    { key: 'value', label: tdef.label.replace(/ \(fewest\)$/, ''), num: true, sortable: false, decimals: 'd' in tdef ? tdef.d : 0, value: (r) => r.value, className: 'font-semibold text-chalk-100' },
  ];
  const busy = teamsOn ? tq.isPlaceholderData : q.isPlaceholderData;
  return (
    <div className="space-y-4">
      <PageHeader title={title} meta={teamsOn ? (tq.data ? `${fmt.num(tq.data.total)} team seasons, ${where}` : where) : q.data ? `${fmt.num(q.data.total)} player seasons, ${where}${q.data.min_minutes ? `, ${q.data.min_minutes}+ minutes` : ''}` : intl ? 'National teams' : 'US competitions first'}>
        {intl
          ? <Field label="Teams">{() => <SegmentedControl label="Senior or youth" size="sm" value={level} onChange={(v) => { setLevel(v === 'senior' ? '' : v); setLeague(''); setPage(1); }} options={[{ value: 'senior', label: 'Senior' }, { value: 'youth', label: 'Youth' }]} />}</Field>
          : <Field label="Where">{() => <SegmentedControl label="US or worldwide" size="sm" value={scope} onChange={(v) => { setScope(v); setLeague(''); setPage(1); }} options={[...SCOPE_OPTIONS]} />}</Field>}
        {leaders && <Field label="Show">{() => <SegmentedControl label="Players or teams" size="sm" value={teamsOn ? 'team' : 'player'} onChange={(v) => { setKind(v); setPage(1); }} options={[{ value: 'player', label: 'Players' }, { value: 'team', label: 'Teams' }]} />}</Field>}
        {leaders && !teamsOn && <Field label="Stat">{(id) => <Select id={id} value={stat} onChange={(v) => { setStat(v); setPage(1); }} options={PRO_STATS.map((s) => ({ value: s.key, label: s.label }))} />}</Field>}
        {teamsOn && <Field label="Stat">{(id) => <Select id={id} value={teamStat} onChange={(v) => { setTeamStat(v); setPage(1); }} options={TEAM_STATS.map((s) => ({ value: s.key, label: s.label }))} />}</Field>}
        {leaders && !teamsOn && <Field label="Numbers">{() => <SegmentedControl label="Numbers" size="sm" value={rate} onChange={(v) => { setRate(v); setPage(1); }} options={[{ value: '', label: 'Totals' }, { value: '1', label: 'Per 90' }]} />}</Field>}
      </PageHeader>
      {/* Phones: the filters behind one button, so the table starts on the first screen. */}
      <button type="button" className="btn-ghost btn-sm sm:hidden" aria-expanded={showFilters} aria-controls="pro-filters" onClick={() => setShowFilters((v) => !v)}>
        <SlidersHorizontal size={14} aria-hidden />{showFilters ? 'Hide filters' : `Filters${active ? ` (${active} on)` : ''}`}
      </button>
      <div id="pro-filters" className={`${showFilters ? 'flex' : 'hidden'} flex-wrap items-end gap-2 sm:flex`}>
        <Field label="Competition">{(id) => <Select id={id} value={leagueOn} onChange={(v) => { setLeague(v); setPage(1); }} options={leagueOptions} className="max-w-[260px]" />}</Field>
        {!teamsOn && <>
          <Field label="Nationality">{(id) => <Select id={id} value={nationality} onChange={(v) => { setNationality(v); setPage(1); }} options={natOptions} className="max-w-[200px]" />}</Field>
          <Field label="Position">{() => <SegmentedControl label="Position" size="sm" value={position} onChange={(v) => { setPosition(v); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'Goalkeeper', label: 'GK' }, { value: 'Defender', label: 'DF' }, { value: 'Midfielder', label: 'MF' }, { value: 'Attacker', label: 'FW' }]} />}</Field>
          <Field label="Age">{() => <SegmentedControl label="Age" size="sm" value={age} onChange={(v) => { setAge(v); setPage(1); }} options={[{ value: '', label: 'Any' }, { value: 'u21', label: 'U21' }, { value: 'u23', label: 'U23' }, { value: '23-29', label: '23-29' }, { value: '30+', label: '30+' }]} />}</Field>
        </>}
      </div>
      {(teamsOn ? tq.error : q.error) && <ErrorBox error={(teamsOn ? tq.error : q.error)!} retry={() => (teamsOn ? tq.refetch() : q.refetch())} />}
      <div className={busy ? 'opacity-60 transition-opacity duration-150' : ''}>
        {teamsOn
          ? <DataTable rows={tq.data?.rows ?? []} columns={teamCols} rowKey={(r) => `${r.team?.id}-${r.league?.id}`} caption={title} rowHref={(r) => (r.team ? proPath.team(r.team.slug, null, intl) : null)} loading={tq.isPending} dense mode="server" />
          : <LeadersTable rows={q.data?.rows ?? []} stat={stat} per90={!!(leaders && rate)} caption={title} loading={q.isPending} />}
      </div>
      {!teamsOn && q.data && q.data.total > PAGE && <Pager page={page - 1} pageSize={PAGE} total={q.data.total} onPage={(p) => setPage(p + 1)} busy={q.isFetching} noun="players" />}
      {teamsOn && tq.data && tq.data.total > PAGE && <Pager page={page - 1} pageSize={PAGE} total={tq.data.total} onPage={(p) => setPage(p + 1)} busy={tq.isFetching} noun="teams" />}
    </div>
  );
}
