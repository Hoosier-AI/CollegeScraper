import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs, fmt } from '../../lib/api';
import { useFilters, useHref, genderLabel, divisionLabel } from '../../lib/filters';
import { useUrlNumber, useUrlPatch, useUrlState, useUrlText } from '../../lib/urlState';
import { statDef, statGroups } from '../../lib/statNames';
import { DataTable, type Column } from '../../components/DataTable';
import { Chip, EmptyState, ErrorBox, Field, PageHeader, Pager, SegmentedControl, Select, TeamLogo } from '../../components/primitives';

const PAGE = 100;
const DIV_OPTIONS = [{ value: '', label: 'All' }, { value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];
const MIN_CHIPS = [0, 180, 450, 900];

// Supporting columns shown next to the chosen stat, by the stat's group.
const PLAYER_SUPPORT: Record<string, string[]> = {
  Goalkeeping: ['gk_minutes', 'saves', 'ga', 'gaa', 'save_pct', 'shutouts'],
  Discipline: ['gp', 'minutes', 'fouls', 'yc', 'rc'],
  default: ['gp', 'minutes', 'goals', 'assists', 'points', 'shots', 'sog'],
};
const TEAM_SUPPORT: Record<string, string[]> = {
  Shooting: ['gp', 'shots', 'sog', 'sog_pct', 'shots_per_goal', 'gf'],
  'Set pieces & discipline': ['gp', 'corners', 'fouls', 'yc', 'rc'],
  default: ['gp', 'gf', 'ga', 'gd', 'ppg', 'shots_pg'],
};

export function LeadersView(props: { conference?: string; embedded?: boolean } = {}) {
  const f = useFilters();
  const href = useHref();
  const patch = useUrlPatch();
  const [kind] = useUrlState('kind', 'player', { allow: ['player', 'team'] });
  const isTeam = kind === 'team';
  const [stat, setStat] = useUrlState('stat', isTeam ? 'w' : 'goals');
  const [division, setDivision] = useUrlState('division', '', { allow: ['d1', 'd2', 'd3'] });
  const [conferenceParam, setConference] = useUrlState('conference');
  const conference = props.conference ?? conferenceParam;
  const [minMin, setMinMin] = useUrlNumber('min', 0, { min: 0, max: 5000 });
  const [page, setPage] = useUrlNumber('page', 0, { min: 0, replace: true, resetPage: false });
  const search = useUrlText('q');
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ conferences: { id: string; name: string; division: string | null }[] }>('/api/meta') });
  const q = useQuery({
    queryKey: ['leaders', f.season, f.gender, kind, stat, division, conference, minMin, search.value, page],
    queryFn: () => api<{ stats: string[]; stat: string; rows: any[]; total: number; limit: number; offset: number }>(`/api/leaders${qs({ season: f.season, gender: f.gender, kind, stat, division, conference, min_minutes: minMin, q: search.value, limit: PAGE, offset: page * PAGE })}`),
    // Keep the table on screen while paging within the same list; a new list gets fresh rows.
    placeholderData: (prev, prevQuery) => (prevQuery && prevQuery.queryKey.slice(0, 9).join('|') === [ 'leaders', f.season, f.gender, kind, stat, division, conference, minMin, search.value ].join('|') ? prev : undefined),
  });
  const def = statDef(isTeam ? 'team' : 'player', stat);
  const dec = (k: string) => statDef(isTeam ? 'team' : 'player', k).decimals ?? 0;
  const statOptions = useMemo(() => statGroups(isTeam ? 'team' : 'player', q.data?.stats ?? [stat]).flatMap((g) => g.stats.map((s) => ({ value: s.key, label: s.label, group: g.group }))), [q.data?.stats, isTeam, stat]);
  const confOptions = useMemo(() => [{ value: '', label: 'All conferences' }, ...(meta.data?.conferences ?? []).filter((c) => !division || c.division === division).map((c) => ({ value: c.id, label: c.name }))], [meta.data, division]);
  const offset = q.data?.offset ?? page * PAGE;
  const total = q.data?.total ?? 0;
  const busy = q.isPlaceholderData || (q.isFetching && !q.isPending);

  const statCell = (key: string): Column<any> => {
    const d = statDef(isTeam ? 'team' : 'player', key);
    return { key, label: d.short, title: d.label, num: true, priority: 2, render: (r) => d.pct ? fmt.pct(r[key]) : fmt.num(r[key], d.decimals ?? 0) };
  };
  const support = (isTeam ? TEAM_SUPPORT : PLAYER_SUPPORT)[def.group] ?? (isTeam ? TEAM_SUPPORT : PLAYER_SUPPORT).default!;
  const chosen: Column<any> = { key: stat, label: def.short, title: def.label, num: true, className: 'font-semibold text-pitch-300', render: (r) => def.pct ? fmt.pct(r[stat]) : fmt.num(r[stat], dec(stat)) };
  const rankCell = (i: number) => <span className="w-7 shrink-0 text-right text-chalk-500 tnum">{offset + i + 1}</span>;
  const playerCols: Column<any>[] = [
    { key: 'display_name', label: 'Player', primary: true, render: (r, i) => <span className="flex items-center gap-2">{rankCell(i)}<TeamLogo src={r.headshot_url} name={r.display_name} size={22} fallback="blank" /><span>{r.display_name}</span></span> },
    { key: 'program_name', label: 'Team', render: (r) => <Link className="flex items-center gap-2 hover:text-pitch-300" to={href(`/teams/${r.program_id}`)}><TeamLogo src={r.logo_svg_url} name={r.program_name} size={18} /><span className="max-w-[160px] truncate">{r.program_name}</span></Link> },
    { key: 'conference_name', label: 'Conference', priority: 2 }, { key: 'position', label: 'Pos', title: 'Position' }, { key: 'class_raw', label: 'Class', priority: 2 },
    chosen,
    ...support.filter((k) => k !== stat).map(statCell),
  ];
  const teamCols: Column<any>[] = [
    { key: 'program_name', label: 'Team', primary: true, render: (r, i) => <span className="flex items-center gap-2">{rankCell(i)}<TeamLogo src={r.logo_svg_url} name={r.program_name} size={20} /><span>{r.program_name}</span></span> },
    { key: 'conference_name', label: 'Conference', priority: 2 }, { key: 'division', label: 'Div', render: (r) => String(r.division ?? '').toUpperCase() },
    { key: 'rec', label: 'W-L-T', render: (r) => fmt.rec(r.w, r.l, r.t) },
    chosen,
    ...support.filter((k) => k !== stat && k !== 'w').map(statCell),
  ];
  const scope = [division ? divisionLabel(division) : 'all divisions', genderLabel(f.gender), String(f.season)].join(', ');
  const pager = <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} busy={busy} noun={isTeam ? 'teams' : 'players'} />;
  return (
    <div className="space-y-4">
      <PageHeader as="h2" title={props.embedded ? 'Leaders' : 'Leaders'} meta={`${def.label}, ${scope}`}>
        <Field label="Show">{() => <SegmentedControl label="Players or teams" size="sm" value={kind as 'player' | 'team'} onChange={(v) => patch({ kind: v === 'player' ? null : v, stat: null, min: null })} options={[{ value: 'player', label: 'Players' }, { value: 'team', label: 'Teams' }]} />}</Field>
        <Field label="Stat">{(id) => <Select id={id} value={stat} onChange={setStat} options={statOptions} className="max-w-[240px]" />}</Field>
        {!props.conference && <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={(v) => patch({ division: v || null, conference: null })} options={DIV_OPTIONS} />}</Field>}
        {!props.conference && <Field label="Conference">{(id) => <Select id={id} value={conference} onChange={setConference} options={confOptions} className="max-w-[200px]" />}</Field>}
        <Field label={isTeam ? 'Find team' : 'Find player or team'}>{(id) => <input id={id} type="search" className="input w-44" placeholder="Name" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      {!isTeam && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-chalk-400" role="group" aria-label="Minimum minutes">
          <span className="mr-1">Minimum minutes</span>
          {MIN_CHIPS.map((m) => <Chip key={m} on={minMin === m} onClick={() => setMinMin(m)}>{m === 0 ? 'Any' : `${m}+`}</Chip>)}
          {!MIN_CHIPS.includes(minMin) && <Chip on>{minMin}+</Chip>}
        </div>
      )}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {pager}
      <div className={busy ? 'opacity-60 transition-opacity duration-150' : 'transition-opacity duration-150'} aria-busy={busy}>
        <DataTable rows={q.data?.rows ?? []} columns={isTeam ? teamCols : playerCols} rowKey={(r) => (isTeam ? r.program_id : r.player_season_id)} caption={`${def.label} leaders, ${scope}`} mode="server" loading={q.isPending} dense
          rowHref={(r) => (isTeam ? href(`/teams/${r.program_id}`) : `/players/${r.player_id}`)}
          empty={<EmptyState title={search.value ? `Nobody matches “${search.value}”` : `No ${isTeam ? 'teams' : 'players'} with ${def.label.toLowerCase()} yet`} body={minMin ? 'Lower the minimum minutes or clear the search.' : 'Try another stat or a wider scope.'} action={search.value ? <button className="btn-ghost btn-sm" onClick={search.clear}>Clear search</button> : undefined} />} />
      </div>
      {total > PAGE && pager}
    </div>
  );
}
