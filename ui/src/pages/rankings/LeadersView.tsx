import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs, fmt } from '../../lib/api';
import { useFilters, useHref, genderLabel, divisionLabel } from '../../lib/filters';
import { useUrlNumber, useUrlPatch, useUrlState, useUrlText } from '../../lib/urlState';
import { statDef, statGroups } from '../../lib/statNames';
import { DataTable, type Column } from '../../components/DataTable';
import { PlayerAvatar, Chip, EmptyState, ErrorBox, Field, PageHeader, Pager, SegmentedControl, Select, TeamLogo } from '../../components/primitives';

const PAGE = 100;
const DIV_OPTIONS = [{ value: '', label: 'All' }, { value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];
const MIN_CHIPS = [0, 180, 450, 900];
const POS_OPTIONS = [{ value: '', label: 'All' }, { value: 'GK', label: 'GK' }, { value: 'D', label: 'D' }, { value: 'M', label: 'M' }, { value: 'F', label: 'F' }];
const CLASS_OPTIONS = [{ value: '', label: 'Any' }, { value: '1', label: 'Fr' }, { value: '2', label: 'So' }, { value: '3', label: 'Jr' }, { value: '4', label: 'Sr' }, { value: '5', label: 'Gr' }];
// Stats with a per-90 version: the Per 90 switch reads that one instead (450+ minutes unless a minimum is set).
const PER90: Record<string, string> = { goals: 'goals_p90', assists: 'assists_p90', points: 'points_p90', shots: 'shots_p90', sog: 'sog_p90', saves: 'saves_p90' };

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

/** The college leaders (/leaders), or with `directory` the player list (/players): every player who has played, most
 *  minutes first, with the same scope filters and search. */
export function LeadersView(props: { conference?: string; embedded?: boolean; directory?: boolean } = {}) {
  const f = useFilters();
  const href = useHref();
  const patch = useUrlPatch();
  const dir = !!props.directory;
  const [kindParam] = useUrlState('kind', 'player', { allow: ['player', 'team'] });
  const kind = dir ? 'player' : kindParam;
  const isTeam = kind === 'team';
  const [statParam, setStat] = useUrlState('stat', isTeam ? 'w' : 'goals');
  const [rate, setRate] = useUrlState('per90', '', { allow: ['1'] });
  const [position, setPosition] = useUrlState('position', '', { allow: ['GK', 'D', 'M', 'F'] });
  const [classYear, setClassYear] = useUrlState('class', '', { allow: ['1', '2', '3', '4', '5'] });
  const per90 = !dir && !isTeam && rate === '1' && !!PER90[statParam];
  const stat = dir ? 'minutes' : per90 ? PER90[statParam]! : statParam;
  const [division, setDivision] = useUrlState('division', '', { allow: ['d1', 'd2', 'd3'] });
  const [conferenceParam, setConference] = useUrlState('conference');
  const conference = props.conference ?? conferenceParam;
  const [minParam, setMinMin] = useUrlNumber('min', 0, { min: 0, max: 5000 });
  const minMin = dir ? 0 : per90 && !minParam ? 450 : minParam;
  const pos = isTeam ? '' : position, cls = isTeam ? '' : classYear;
  const [page, setPage] = useUrlNumber('page', 0, { min: 0, replace: true, resetPage: false });
  const search = useUrlText('q');
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ conferences: { id: string; name: string; division: string | null }[] }>('/api/meta') });
  const q = useQuery({
    queryKey: ['leaders', f.season, f.gender, kind, stat, division, conference, minMin, search.value, pos, cls, page],
    queryFn: () => api<{ stats: string[]; stat: string; rows: any[]; total: number; limit: number; offset: number }>(`/api/leaders${qs({ season: f.season, gender: f.gender, kind, stat, division, conference, min_minutes: minMin, q: search.value, position: pos, class_year: cls, limit: PAGE, offset: page * PAGE })}`),
    // Keep the table on screen while paging within the same list; a new list gets fresh rows.
    placeholderData: (prev, prevQuery) => (prevQuery && prevQuery.queryKey.slice(0, 11).join('|') === [ 'leaders', f.season, f.gender, kind, stat, division, conference, minMin, search.value, pos, cls ].join('|') ? prev : undefined),
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
    { key: 'display_name', label: 'Player', primary: true, render: (r, i) => <span className="flex items-center gap-2">{rankCell(i)}<PlayerAvatar src={r.headshot_url} name={r.display_name} size={22} /><span>{r.display_name}</span></span> },
    { key: 'program_name', label: 'Team', render: (r) => <Link className="flex items-center gap-2 hover:text-pitch-300" to={href(`/teams/${r.program_id}`)}><TeamLogo src={r.logo_svg_url} seo={r.school_seo} name={r.program_name} size={18} /><span className="max-w-[160px] truncate">{r.program_name}</span></Link> },
    { key: 'conference_name', label: 'Conference', priority: 2 }, { key: 'position', label: 'Pos', title: 'Position' }, { key: 'class_raw', label: 'Class', priority: 2 },
    chosen,
    ...support.filter((k) => k !== stat).map(statCell),
  ];
  const teamCols: Column<any>[] = [
    { key: 'program_name', label: 'Team', primary: true, render: (r, i) => <span className="flex items-center gap-2">{rankCell(i)}<TeamLogo src={r.logo_svg_url} seo={r.school_seo} name={r.program_name} size={20} /><span>{r.program_name}</span></span> },
    { key: 'conference_name', label: 'Conference', priority: 2 }, { key: 'division', label: 'Div', render: (r) => String(r.division ?? '').toUpperCase() },
    { key: 'rec', label: 'W-L-T', render: (r) => fmt.rec(r.w, r.l, r.t) },
    chosen,
    ...support.filter((k) => k !== stat && k !== 'w').map(statCell),
  ];
  const scope = [division ? divisionLabel(division) : 'all divisions', genderLabel(f.gender), String(f.season)].join(', ');
  const pager = <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} busy={busy} noun={isTeam ? 'teams' : 'players'} />;
  return (
    <div className="space-y-4">
      <PageHeader as={props.embedded ? 'h2' : 'h1'} title={dir ? 'Players' : 'Leaders'} meta={dir ? `Everyone who has played, most minutes first, ${scope}` : `${def.label}, ${scope}`}>
        {!dir && <Field label="Show">{() => <SegmentedControl label="Players or teams" size="sm" value={kind as 'player' | 'team'} onChange={(v) => patch({ kind: v === 'player' ? null : v, stat: null, min: null })} options={[{ value: 'player', label: 'Players' }, { value: 'team', label: 'Teams' }]} />}</Field>}
        {!dir && <Field label="Stat">{(id) => <Select id={id} value={statParam} onChange={setStat} options={statOptions} className="max-w-[240px]" />}</Field>}
        {!dir && !isTeam && PER90[statParam] && <Field label="Numbers">{() => <SegmentedControl label="Totals or per 90" size="sm" value={rate} onChange={setRate} options={[{ value: '', label: 'Totals' }, { value: '1', label: 'Per 90' }]} />}</Field>}
        {!props.conference && <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={(v) => patch({ division: v || null, conference: null })} options={DIV_OPTIONS} />}</Field>}
        {!props.conference && <Field label="Conference">{(id) => <Select id={id} value={conference} onChange={setConference} options={confOptions} className="max-w-[200px]" />}</Field>}
        <Field label={isTeam ? 'Find team' : 'Find player or team'}>{(id) => <input id={id} type="search" className="input w-44" placeholder="Name" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      {!isTeam && (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <Field label="Position">{() => <SegmentedControl label="Position" size="sm" value={position} onChange={setPosition} options={POS_OPTIONS} />}</Field>
          <Field label="Class">{() => <SegmentedControl label="Class" size="sm" value={classYear} onChange={setClassYear} options={CLASS_OPTIONS} />}</Field>
          {!dir && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-chalk-400" role="group" aria-label="Minimum minutes">
              <span className="mr-1">Minimum minutes</span>
              {MIN_CHIPS.filter((m) => !per90 || m > 0).map((m) => <Chip key={m} on={minMin === m} onClick={() => setMinMin(m)}>{m === 0 ? 'Any' : `${m}+`}</Chip>)}
              {!MIN_CHIPS.includes(minMin) && <Chip on>{minMin}+</Chip>}
            </div>
          )}
        </div>
      )}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {pager}
      <div className={busy ? 'opacity-60 transition-opacity duration-150' : 'transition-opacity duration-150'} aria-busy={busy}>
        <DataTable rows={q.data?.rows ?? []} columns={isTeam ? teamCols : playerCols} rowKey={(r) => (isTeam ? r.program_id : r.player_season_id)} caption={dir ? `Players, ${scope}` : `${def.label} leaders, ${scope}`} mode="server" loading={q.isPending} dense
          rowHref={(r) => (isTeam ? href(`/teams/${r.program_id}`) : `/players/${r.player_id}`)}
          empty={<EmptyState title={search.value ? `Nobody matches “${search.value}”` : `No ${isTeam ? 'teams' : 'players'} with ${def.label.toLowerCase()} yet`} body={minMin ? 'Lower the minimum minutes or clear the search.' : 'Try another stat or a wider scope.'} action={search.value ? <button className="btn-ghost btn-sm" onClick={search.clear}>Clear search</button> : undefined} />} />
      </div>
      {total > PAGE && pager}
    </div>
  );
}
