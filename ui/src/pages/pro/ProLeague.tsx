// One competition: its table (every group), results and fixtures, top scorers and assists, a stats tab (leaders on
// 20+ stats, the clubs' attack and defence) and past champions, for a season.
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, ApiError, qs } from '../../lib/api';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { proPath, genderWord, PRO_STATS, POSITIONS, type ProLeader, type ProLeagueRef, type ProMatch, type ProStandingRow, type ProTeamRef } from '../../lib/pro';
import { DataTable, type Column } from '../../components/DataTable';
import { LeadersTable, type LeaderRow } from '../../components/pro/People';
import { LeagueTable } from '../../components/pro/LeagueTable';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { EmptyState, ErrorBox, Field, PageHeader, PlayerAvatar, Section, SegmentedControl, Select, Skeleton, TabsNav, TeamLogo } from '../../components/primitives';
import { ProMoved } from './ProMoved';
import { AdvancedLeaders, Credit, ExpectedTable, type AdvLeaderLine, type ExpectedLine, type SourceCredit } from '../../components/pro/Advanced';

interface TeamLine { team: ProTeamRef; played: number; w: number; d: number; l: number; gf: number; ga: number; clean_sheets: number; shots: number | null; shots_on: number | null; corners: number | null; fouls: number | null; yellow: number | null; red: number | null; possession: number | null }
interface LeagueData { league: ProLeagueRef & { current_season: number | null }; season: number | null; seasons: number[]; standings: { name: string; rows: ProStandingRow[] }[]; results: ProMatch[]; fixtures: ProMatch[]; scorers: ProLeader[]; assists: ProLeader[]; teams: number;
  champions: { season: number; teams: { team: ProTeamRef; group: string; points: number | null }[] }[]; team_table: TeamLine[];
  advanced_leaders?: { credit: SourceCredit; table?: ExpectedLine[]; xg: AdvLeaderLine[]; xa: AdvLeaderLine[]; g_plus: AdvLeaderLine[] } | null;
  history_sources?: { what: string; name: string; url: string | null; license: string | null }[] | null }
type Tab = 'table' | 'results' | 'fixtures' | 'players' | 'stats' | 'history';

/** Leaders on any stat for this league season, by position, totals or per 90 (pro_leaders). */
function StatsTab({ league, season, current, teams }: { league: number; season: number | null; current: number | null; teams: TeamLine[] }) {
  const [stat, setStat] = useUrlState('stat', 'goals', { allow: PRO_STATS.map((x) => x.key) });
  const [position, setPosition] = useUrlState('position', '', { allow: [...POSITIONS] });
  const [rate, setRate] = useUrlState('per90', '', { allow: ['1'] });
  const q = useQuery({
    queryKey: ['pro-leaders', league, season, stat, position, rate],
    queryFn: () => api<{ rows: LeaderRow[]; per90: boolean }>(`/api/pro/leaders${qs({ league, season: season !== current ? season : undefined, stat, position, per90: rate, limit: 25 })}`),
    placeholderData: keepPreviousData,
  });
  const n = (v: number | null, d = 0) => (v == null ? null : Number(v.toFixed(d)));
  const teamCols: Column<TeamLine>[] = [
    { key: 'team', label: 'Club', primary: true, value: (r) => r.team.name, render: (r) => <span className="flex items-center gap-2"><TeamLogo src={r.team.logo} name={r.team.name} size={18} />{r.team.name}</span> },
    { key: 'played', label: 'P', num: true, value: (r) => r.played },
    { key: 'gf', label: 'GF', title: 'Goals for', num: true, value: (r) => r.gf },
    { key: 'ga', label: 'GA', title: 'Goals against', num: true, value: (r) => r.ga },
    { key: 'gfpg', label: 'GF/g', title: 'Goals for per game', num: true, decimals: 2, value: (r) => n(r.played ? r.gf / r.played : null, 2) },
    { key: 'gapg', label: 'GA/g', title: 'Goals against per game', num: true, decimals: 2, value: (r) => n(r.played ? r.ga / r.played : null, 2) },
    { key: 'cs', label: 'CS', title: 'Clean sheets', num: true, value: (r) => r.clean_sheets },
    { key: 'possession', label: 'Poss %', title: 'Average possession', num: true, priority: 2, value: (r) => (r.possession == null ? null : Math.round(r.possession)) },
    { key: 'shots', label: 'Sh/g', title: 'Shots per game', num: true, decimals: 1, priority: 2, value: (r) => n(r.shots != null && r.played ? r.shots / r.played : null, 1) },
    { key: 'cards', label: 'YC', title: 'Yellow cards', num: true, priority: 3, value: (r) => r.yellow },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Stat">{(id) => <Select id={id} value={stat} onChange={setStat} options={PRO_STATS.map((x) => ({ value: x.key, label: x.label }))} />}</Field>
        <Field label="Position">{() => <SegmentedControl label="Position" size="sm" value={position} onChange={setPosition} options={[{ value: '', label: 'All' }, { value: 'Goalkeeper', label: 'GK' }, { value: 'Defender', label: 'DF' }, { value: 'Midfielder', label: 'MF' }, { value: 'Attacker', label: 'FW' }]} />}</Field>
        <Field label="Numbers">{() => <SegmentedControl label="Numbers" size="sm" value={rate} onChange={setRate} options={[{ value: '', label: 'Totals' }, { value: '1', label: 'Per 90' }]} />}</Field>
      </div>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      <LeadersTable rows={q.data?.rows ?? []} stat={stat} per90={!!rate} caption="Player leaders" loading={q.isPending} showLeague={false}
        empty={<EmptyState title="No player stats yet" body="Season totals arrive as the crawl reaches this competition." />} />
      {teams.length > 0 && <Section title="Clubs: attack and defence"><DataTable rows={teams} columns={teamCols} rowKey={(r) => String(r.team.id)} caption="Club stats" rowHref={(r) => proPath.team(r.team.slug, season)} dense defaultSort={{ key: 'gfpg', dir: 'desc' }} /></Section>}
    </div>
  );
}

function Leaders({ rows, stat, label }: { rows: ProLeader[]; stat: 'goals' | 'assists'; label: string }) {
  if (!rows.length) return <p className="text-sm text-chalk-400">No {label.toLowerCase()} recorded yet.</p>;
  return (
    <ol className="frame divide-y divide-field-700" aria-label={label}>
      {rows.map((r, i) => (
        <li key={r.player.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
          <span className="w-5 text-right text-xs tnum text-chalk-500">{i + 1}</span>
          <PlayerAvatar src={r.player.photo} name={r.player.name} size={24} />
          <span className="min-w-0 flex-1">
            <Link to={proPath.player(r.player.slug)} className="block truncate font-medium text-chalk-100 hover:text-pitch-300">{r.player.name}</Link>
            {r.team && <Link to={proPath.team(r.team.slug)} className="block truncate text-2xs text-chalk-500 hover:text-chalk-300">{r.team.name}</Link>}
          </span>
          <span className="text-xs tnum text-chalk-500" title="Appearances">{r.apps} apps</span>
          <span className="w-8 text-right font-semibold tnum text-chalk-100">{r[stat]}</span>
        </li>
      ))}
    </ol>
  );
}

export default function ProLeague() {
  const { slug = '' } = useParams();
  const patch = useUrlPatch();
  const [seasonParam] = useUrlState('season', '');
  const [tab] = useUrlState('tab', 'table', { allow: ['table', 'results', 'fixtures', 'players', 'stats', 'history'] });
  const q = useQuery({ queryKey: ['pro-league', slug, seasonParam], queryFn: () => api<LeagueData>(`/api/pro/leagues/${slug}${qs({ season: seasonParam })}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <ProMoved kind="league" slug={slug} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-96" /></div>;
  const d = q.data!;
  const l = d.league;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'table', label: 'Table' }, { id: 'results', label: 'Results', count: d.results.length }, { id: 'fixtures', label: 'Fixtures', count: d.fixtures.length }, { id: 'players', label: 'Top players' }, { id: 'stats', label: 'Stats' },
    ...(d.champions.length ? [{ id: 'history' as Tab, label: 'Past winners', count: d.champions.length }] : []),
  ];
  const where = l.country && l.country !== 'World' ? l.country : 'International';
  return (
    <div className="space-y-5">
      <PageHeader title={<span className="flex items-center gap-3"><TeamLogo src={l.logo} name={l.name} size={40} />{l.name}</span>}
        meta={`${where}, ${genderWord(l.gender).toLowerCase()} ${l.type === 'cup' ? 'cup competition' : 'league'}${d.teams ? `, ${d.teams} clubs` : ''}`}>
        {d.seasons.length > 1 && <Select aria-label="Season" className="h-9 text-sm" value={String(d.season ?? '')} onChange={(v) => patch({ season: Number(v) === l.current_season ? null : v })} options={d.seasons.map((s) => ({ value: String(s), label: String(s) }))} />}
      </PageHeader>
      <TabsNav label="League sections" tabs={tabs} value={tab as Tab} hrefFor={(t) => proPath.league(slug, d.season, l.current_season) + (t === 'table' ? '' : `${d.season && d.season !== l.current_season ? '&' : '?'}tab=${t}`)} />
      {tab === 'table' && (d.standings.length
        ? <div className="space-y-4">{d.standings.map((g) => <Section key={g.name || 'table'} title={g.name || `${d.season} table`}><LeagueTable rows={g.rows} caption={`${l.name} ${g.name} ${d.season}`} season={d.season} /></Section>)}
            {(d.advanced_leaders?.table?.length ?? 0) > 0 && <Section title="Expected table"><ExpectedTable rows={d.advanced_leaders!.table!} season={d.season} /><Credit credit={d.advanced_leaders!.credit} /></Section>}
            {d.history_sources && <p className="text-2xs text-chalk-500">{d.history_sources.map((h, i) => <span key={i}>{i ? ' · ' : ''}{h.what}: {h.url ? <a href={h.url} target="_blank" rel="noopener" className="underline hover:text-pitch-300">{h.name}</a> : h.name}{h.license ? ` (${h.license})` : ''}</span>)}.</p>}</div>
        : <EmptyState title="No table for this season" body={l.type === 'cup' ? 'Knockout competitions have no table; see Results and Fixtures.' : 'The table appears once the first matches have been played.'} />)}
      {tab === 'results' && (d.results.length ? <div className="frame divide-y divide-field-700">{d.results.map((m) => <ProMatchRow key={m.id} m={m} showDate />)}</div> : <EmptyState title="No results yet" />)}
      {tab === 'fixtures' && (d.fixtures.length ? <div className="frame divide-y divide-field-700">{d.fixtures.map((m) => <ProMatchRow key={m.id} m={m} showDate />)}</div> : <EmptyState title="No upcoming fixtures" body="The season may be over, or the next round is not scheduled yet." />)}
      {tab === 'players' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Top scorers"><Leaders rows={d.scorers} stat="goals" label="Goals" /></Section>
          <Section title="Most assists"><Leaders rows={d.assists} stat="assists" label="Assists" /></Section>
          {d.advanced_leaders && <div className="md:col-span-2"><Section title="Advanced leaders"><AdvancedLeaders data={d.advanced_leaders} season={d.season} /><Credit credit={d.advanced_leaders.credit} /></Section></div>}
        </div>
      )}
      {tab === 'stats' && <StatsTab league={l.id} season={d.season} current={l.current_season} teams={d.team_table} />}
      {tab === 'history' && (
        <>
        <p className="text-xs text-chalk-400">Top of the table at the end of each past season{d.champions.some((c) => c.teams.length > 1) ? ', per group or conference' : ''}. Where a title is decided in playoffs, the table winner and the champion can differ.</p>
        <ol className="frame divide-y divide-field-700" aria-label="Top of the table each past season">
          {d.champions.map((c) => (
            <li key={c.season} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
              <Link to={proPath.league(slug, c.season, l.current_season)} className="w-14 shrink-0 tnum text-chalk-400 hover:text-chalk-100">{c.season}</Link>
              {c.teams.map((x) => <Link key={x.team.id + x.group} to={proPath.team(x.team.slug, c.season)} className="flex items-center gap-2 font-medium text-chalk-100 hover:text-pitch-300"><TeamLogo src={x.team.logo} name={x.team.name} size={20} />{x.team.name}{c.teams.length > 1 && x.group ? <span className="text-2xs font-normal text-chalk-500">{x.group}</span> : null}{x.points != null && <span className="text-2xs font-normal text-chalk-500">{x.points} pts</span>}</Link>)}
            </li>
          ))}
        </ol>
        </>
      )}
    </div>
  );
}
