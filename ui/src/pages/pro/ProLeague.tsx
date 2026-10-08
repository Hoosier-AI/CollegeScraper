// One competition: its table (every group), results and fixtures, top scorers and assists, for a season.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, qs } from '../../lib/api';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { proPath, genderWord, type ProLeader, type ProLeagueRef, type ProMatch, type ProStandingRow } from '../../lib/pro';
import { LeagueTable } from '../../components/pro/LeagueTable';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { EmptyState, ErrorBox, PageHeader, PlayerAvatar, Section, Select, Skeleton, TabsNav, TeamLogo } from '../../components/primitives';
import { ProMoved } from './ProMoved';

interface LeagueData { league: ProLeagueRef & { current_season: number | null }; season: number | null; seasons: number[]; standings: { name: string; rows: ProStandingRow[] }[]; results: ProMatch[]; fixtures: ProMatch[]; scorers: ProLeader[]; assists: ProLeader[]; teams: number }
type Tab = 'table' | 'results' | 'fixtures' | 'players';

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
  const [tab] = useUrlState('tab', 'table', { allow: ['table', 'results', 'fixtures', 'players'] });
  const q = useQuery({ queryKey: ['pro-league', slug, seasonParam], queryFn: () => api<LeagueData>(`/api/pro/leagues/${slug}${qs({ season: seasonParam })}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <ProMoved kind="league" slug={slug} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-96" /></div>;
  const d = q.data!;
  const l = d.league;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'table', label: 'Table' }, { id: 'results', label: 'Results', count: d.results.length }, { id: 'fixtures', label: 'Fixtures', count: d.fixtures.length }, { id: 'players', label: 'Top players' },
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
        ? <div className="space-y-4">{d.standings.map((g) => <Section key={g.name || 'table'} title={g.name || `${d.season} table`}><LeagueTable rows={g.rows} caption={`${l.name} ${g.name} ${d.season}`} season={d.season} /></Section>)}</div>
        : <EmptyState title="No table for this season" body={l.type === 'cup' ? 'Knockout competitions have no table; see Results and Fixtures.' : 'The table appears once the first matches have been played.'} />)}
      {tab === 'results' && (d.results.length ? <div className="frame divide-y divide-field-700">{d.results.map((m) => <ProMatchRow key={m.id} m={m} showDate />)}</div> : <EmptyState title="No results yet" />)}
      {tab === 'fixtures' && (d.fixtures.length ? <div className="frame divide-y divide-field-700">{d.fixtures.map((m) => <ProMatchRow key={m.id} m={m} showDate />)}</div> : <EmptyState title="No upcoming fixtures" body="The season may be over, or the next round is not scheduled yet." />)}
      {tab === 'players' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Top scorers"><Leaders rows={d.scorers} stat="goals" label="Goals" /></Section>
          <Section title="Most assists"><Leaders rows={d.assists} stat="assists" label="Assists" /></Section>
        </div>
      )}
    </div>
  );
}
