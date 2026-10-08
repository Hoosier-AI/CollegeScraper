// One pro player: profile, college career (when they played NCAA soccer), season by season, recent matches.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { api, ApiError, fmt } from '../../lib/api';
import { ageFrom, proPath, type ProLeagueRef, type ProMatch, type ProTeamRef } from '../../lib/pro';
import { DataTable, type Column } from '../../components/DataTable';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { EmptyState, ErrorBox, Figure, PageHeader, PlayerAvatar, Section, Skeleton, TeamLogo } from '../../components/primitives';
import { ProMoved } from './ProMoved';

interface SeasonRow { season: number; league: ProLeagueRef | null; team: ProTeamRef | null; apps: number; starts: number; minutes: number; goals: number; assists: number; shots: number | null; key_passes: number | null; tackles: number | null; yellow: number; red: number; saves: number | null; conceded: number | null; clean_sheets: number | null; rating: number | null }
interface PlayerData {
  player: { id: number; name: string; slug: string; short_name: string; birth_date: string | null; birth_place: string | null; birth_country: string | null; nationality: string | null; height_cm: number | null; weight_kg: number | null; position: string | null; photo: string | null; gender: 'm' | 'w' | null };
  team: ProTeamRef | null; seasons: SeasonRow[];
  matches: { match: ProMatch; team_id: number; starter: boolean; minutes: number | null; goals: number | null; assists: number | null; rating: number | null }[];
  college: { college_name: string; school_seo: string | null; first_season: number | null; last_season: number | null; college_player_slug: string | null; verified: boolean }[];
}

export default function ProPlayer() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: ['pro-player', slug], queryFn: () => api<PlayerData>(`/api/pro/players/${slug}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <ProMoved kind="player" slug={slug} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  const d = q.data!;
  const p = d.player;
  const isGk = /goal/i.test(p.position ?? '') || d.seasons.some((s) => (s.saves ?? 0) > 0);
  const career = d.seasons.reduce((a, s) => ({ apps: a.apps + s.apps, goals: a.goals + s.goals, assists: a.assists + s.assists, cs: a.cs + (s.clean_sheets ?? 0) }), { apps: 0, goals: 0, assists: 0, cs: 0 });
  const age = ageFrom(p.birth_date);
  const cols: Column<SeasonRow>[] = [
    { key: 'season', label: 'Season', primary: true, value: (s) => s.season, render: (s) => String(s.season) },
    { key: 'team', label: 'Club', value: (s) => s.team?.name ?? '', render: (s) => s.team ? <Link to={proPath.team(s.team.slug, s.season)} className="flex items-center gap-2 hover:text-pitch-300"><TeamLogo src={s.team.logo} name={s.team.name} size={18} />{s.team.name}</Link> : '–' },
    { key: 'league', label: 'Competition', priority: 2, value: (s) => s.league?.name ?? '', render: (s) => s.league ? <Link to={proPath.league(s.league.slug, s.season)} className="hover:text-pitch-300">{s.league.name}</Link> : '–' },
    { key: 'apps', label: 'Apps', num: true, value: (s) => s.apps },
    { key: 'minutes', label: 'Min', num: true, priority: 2, value: (s) => s.minutes },
    ...(isGk
      ? [{ key: 'clean_sheets', label: 'CS', title: 'Clean sheets', num: true, value: (s: SeasonRow) => s.clean_sheets }, { key: 'saves', label: 'Saves', num: true, value: (s: SeasonRow) => s.saves }, { key: 'conceded', label: 'GA', title: 'Goals conceded', num: true, value: (s: SeasonRow) => s.conceded }] as Column<SeasonRow>[]
      : [{ key: 'goals', label: 'G', title: 'Goals', num: true, value: (s: SeasonRow) => s.goals }, { key: 'assists', label: 'A', title: 'Assists', num: true, value: (s: SeasonRow) => s.assists }, { key: 'shots', label: 'Sh', title: 'Shots', num: true, priority: 3, value: (s: SeasonRow) => s.shots }, { key: 'key_passes', label: 'KP', title: 'Key passes', num: true, priority: 3, value: (s: SeasonRow) => s.key_passes }] as Column<SeasonRow>[]),
    { key: 'rating', label: 'Rating', title: 'Average match rating', num: true, decimals: 2, priority: 2, value: (s) => s.rating },
    { key: 'yellow', label: 'YC', num: true, priority: 3, value: (s) => s.yellow },
    { key: 'red', label: 'RC', num: true, priority: 3, value: (s) => s.red },
  ];
  const facts = [p.position, p.nationality, age != null ? `${age} years old` : null, p.height_cm ? `${p.height_cm} cm` : null].filter(Boolean).join(' · ');
  return (
    <div className="space-y-5">
      <PageHeader title={<span className="flex items-center gap-3"><PlayerAvatar src={p.photo} name={p.name} size={56} />{p.name}</span>}
        meta={<>{facts}{d.team && <> · <Link to={proPath.team(d.team.slug)} className="text-pitch-300 hover:text-pitch-200">{d.team.name}</Link></>}</>} />
      {d.college.length > 0 && (
        <aside className="card flex items-start gap-3 px-4 py-3">
          <GraduationCap size={20} aria-hidden className="mt-0.5 shrink-0 text-pitch-300" />
          <div className="text-sm text-chalk-200">
            {d.college.map((c) => (
              <p key={c.college_name}>
                Played college soccer at{' '}
                {c.school_seo ? <Link to={`/teams/${c.school_seo}/${p.gender === 'w' ? 'women' : 'men'}`} className="font-medium text-pitch-300 hover:text-pitch-200">{c.college_name}</Link> : <span className="font-medium">{c.college_name}</span>}
                {c.first_season || c.last_season ? ` (${[c.first_season, c.last_season].filter(Boolean).join('–')})` : ''}.
                {c.college_player_slug && <> <Link to={`/players/${c.college_player_slug}`} className="text-pitch-300 hover:text-pitch-200">College stats</Link></>}
              </p>
            ))}
          </div>
        </aside>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Appearances" value={fmt.num(career.apps)} sub="in our records" />
        {isGk ? <Figure label="Clean sheets" value={fmt.num(career.cs)} /> : <Figure label="Goals" value={fmt.num(career.goals)} />}
        <Figure label="Assists" value={fmt.num(career.assists)} />
        <Figure label="Born" value={p.birth_date ? fmt.date(p.birth_date) : '–'} sub={[p.birth_place, p.birth_country].filter(Boolean).join(', ') || undefined} />
      </div>
      <Section title="Season by season">
        <DataTable rows={d.seasons} columns={cols} rowKey={(s) => `${s.season}-${s.league?.id}-${s.team?.id}`} caption={`${p.name} season by season`} dense
          empty={<EmptyState title="No season stats yet" body="Totals appear once this player's matches have their detail." />} />
      </Section>
      {d.matches.length > 0 && (
        <Section title="Recent matches">
          <ul className="frame divide-y divide-field-700">
            {d.matches.slice(0, 12).map((r) => (
              <li key={r.match.id} className="flex items-center">
                <div className="min-w-0 flex-1"><ProMatchRow m={r.match} showDate showLeague /></div>
                <span className="hidden w-36 shrink-0 px-3 text-right text-xs tnum text-chalk-400 sm:block">
                  {(r.minutes ?? 0) > 0 ? `${r.minutes}′` : 'on the bench'}{r.goals ? ` · ${r.goals} G` : ''}{r.assists ? ` · ${r.assists} A` : ''}{r.rating != null ? ` · ${r.rating.toFixed(1)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
