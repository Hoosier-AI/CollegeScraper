// One club: its competitions this season, table positions, squad with season stats, results and fixtures.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, fmt, qs } from '../../lib/api';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { ageFrom, proPath, type ProLeagueRef, type ProMatch, type ProTeamRef } from '../../lib/pro';
import { DataTable, type Column } from '../../components/DataTable';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { ProForm } from '../../components/pro/LeagueTable';
import { EmptyState, ErrorBox, Figure, PageHeader, PlayerAvatar, Section, Select, Skeleton, TeamLogo } from '../../components/primitives';
import { ProMoved } from './ProMoved';

interface SquadRow { player: { id: number; name: string; slug: string; photo: string | null; position: string | null; nationality: string | null; birth_date: string | null }; apps: number; starts: number; minutes: number; goals: number; assists: number; yellow: number; red: number; saves: number | null; conceded: number | null; clean_sheets: number | null; rating: number | null }
interface TeamData {
  team: ProTeamRef & { founded: number | null; national: boolean; venue: { name: string; city: string | null; capacity: number | null } | null };
  season: number | null; seasons: number[];
  competitions: { league: (ProLeagueRef & { priority: number }) | null; played: number; w: number; d: number; l: number; gf: number; ga: number; clean_sheets: number; possession: number | null }[];
  standings: { league: ProLeagueRef | null; group: string; rank: number | null; points: number | null; played: number | null; form: string | null }[];
  squad: SquadRow[]; results: ProMatch[]; fixtures: ProMatch[];
}

export default function ProTeam() {
  const { slug = '' } = useParams();
  const patch = useUrlPatch();
  const [seasonParam] = useUrlState('season', '');
  const q = useQuery({ queryKey: ['pro-team', slug, seasonParam], queryFn: () => api<TeamData>(`/api/pro/teams/${slug}${qs({ season: seasonParam })}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <ProMoved kind="team" slug={slug} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  const d = q.data!;
  const t = d.team;
  const total = d.competitions.reduce((a, c) => ({ p: a.p + c.played, w: a.w + c.w, d: a.d + c.d, l: a.l + c.l, gf: a.gf + c.gf, ga: a.ga + c.ga }), { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  const cols: Column<SquadRow>[] = [
    { key: 'name', label: 'Player', primary: true, value: (r) => r.player.name, render: (r) => <span className="flex items-center gap-2"><PlayerAvatar src={r.player.photo} name={r.player.name} size={22} /><span>{r.player.name}</span></span> },
    { key: 'position', label: 'Pos', value: (r) => r.player.position ?? '', render: (r) => (r.player.position ?? '').slice(0, 3) },
    { key: 'age', label: 'Age', num: true, priority: 2, value: (r) => ageFrom(r.player.birth_date) },
    { key: 'apps', label: 'Apps', title: 'Appearances', num: true, value: (r) => r.apps },
    { key: 'minutes', label: 'Min', title: 'Minutes', num: true, priority: 2, value: (r) => r.minutes },
    { key: 'goals', label: 'G', title: 'Goals', num: true, value: (r) => r.goals },
    { key: 'assists', label: 'A', title: 'Assists', num: true, value: (r) => r.assists },
    { key: 'rating', label: 'Rating', title: 'Average match rating', num: true, decimals: 2, priority: 2, value: (r) => r.rating },
    { key: 'yellow', label: 'YC', title: 'Yellow cards', num: true, priority: 3, value: (r) => r.yellow },
    { key: 'red', label: 'RC', title: 'Red cards', num: true, priority: 3, value: (r) => r.red },
    { key: 'clean_sheets', label: 'CS', title: 'Clean sheets (keepers)', num: true, priority: 3, value: (r) => r.clean_sheets },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title={<span className="flex items-center gap-3"><TeamLogo src={t.logo} name={t.name} size={48} />{t.name}</span>}
        meta={[t.country, t.founded ? `founded ${t.founded}` : null, t.venue ? `${t.venue.name}${t.venue.city ? `, ${t.venue.city}` : ''}${t.venue.capacity ? ` (${fmt.num(t.venue.capacity)})` : ''}` : null].filter(Boolean).join(' · ')}>
        {d.seasons.length > 1 && <Select aria-label="Season" className="h-9 text-sm" value={String(d.season ?? '')} onChange={(v) => patch({ season: v === String(d.seasons[0]) ? null : v })} options={d.seasons.map((s) => ({ value: String(s), label: String(s) }))} />}
      </PageHeader>
      {d.season != null && total.p > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label={`${d.season} record`} value={`${total.w}-${total.d}-${total.l}`} sub="won, drawn, lost" />
          <Figure label="Goals" value={`${total.gf}:${total.ga}`} sub={`${total.p} matches`} />
          {d.standings.slice(0, 2).map((s) => s.league && <Figure key={`${s.league.id}-${s.group}`} label={s.group || s.league.name} value={s.rank ? fmt.ordinal(s.rank) : '–'} sub={<span className="inline-flex items-center gap-2">{s.points ?? 0} pts <ProForm form={s.form} /></span>} />)}
        </div>
      )}
      {d.competitions.length > 0 && (
        <Section title="Competitions">
          <ul className="flex flex-wrap gap-2">{d.competitions.map((c) => c.league && <li key={c.league.id}><Link to={proPath.league(c.league.slug, d.season)} className="chip">{c.league.name} · {c.w}-{c.d}-{c.l}</Link></li>)}</ul>
        </Section>
      )}
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <Section title={`Squad${d.season ? `, ${d.season}` : ''}`}>
            <DataTable rows={d.squad} columns={cols} rowKey={(r) => String(r.player.id)} caption={`${t.name} squad`} rowHref={(r) => proPath.player(r.player.slug)} dense
              empty={<EmptyState title="No squad stats yet" body="Player lines appear once this season's matches have their detail." />} />
          </Section>
        </div>
        <div className="space-y-5 lg:col-span-5">
          {d.fixtures.length > 0 && <Section title="Next matches"><div className="frame divide-y divide-field-700">{d.fixtures.slice(0, 6).map((m) => <ProMatchRow key={m.id} m={m} showDate showLeague />)}</div></Section>}
          <Section title="Results">{d.results.length ? <div className="frame divide-y divide-field-700">{d.results.slice(0, 15).map((m) => <ProMatchRow key={m.id} m={m} showDate showLeague />)}</div> : <p className="text-sm text-chalk-400">No results this season yet.</p>}</Section>
        </div>
      </div>
    </div>
  );
}
