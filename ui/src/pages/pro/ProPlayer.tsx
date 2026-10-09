// One pro player: profile (flag, age, club, number), injury, college career, career by season in every competition
// with per-90 numbers, percentiles against the same position, transfers, trophies, injury history and recent matches.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Ambulance, GitCompare, GraduationCap, Trophy } from 'lucide-react';
import { api, ApiError, fmt } from '../../lib/api';
import { ageFrom, per90, proPath, proPaths2, type ProLeagueRef, type ProMatch, type ProTeamRef } from '../../lib/pro';
import { DataTable, type Column } from '../../components/DataTable';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { Flag, PercentileBars, TransfersList, type TransferLine } from '../../components/pro/People';
import { EmptyState, ErrorBox, Figure, PageHeader, PlayerAvatar, Section, SegmentedControl, Skeleton, TeamLogo } from '../../components/primitives';
import { ProMoved } from './ProMoved';

interface SeasonRow { season: number; league: (ProLeagueRef & { priority?: number }) | null; team: (ProTeamRef & { national?: boolean }) | null; source: string; position: string | null; apps: number; starts: number; minutes: number; goals: number; assists: number; shots: number | null; shots_on: number | null; key_passes: number | null; passes: number | null; pass_accuracy: number | null; tackles: number | null; interceptions: number | null; duels_won: number | null; dribbles_won: number | null; yellow: number; red: number; saves: number | null; conceded: number | null; clean_sheets: number | null; rating: number | null }
export interface PlayerData {
  player: { id: number; name: string; slug: string; short_name: string; birth_date: string | null; birth_place: string | null; birth_country: string | null; nationality: string | null; height_cm: number | null; weight_kg: number | null; position: string | null; photo: string | null; gender: 'm' | 'w' | null; number: number | null };
  team: ProTeamRef | null; seasons: SeasonRow[];
  percentiles: { league: ProLeagueRef | null; season: number; rows: { stat: string; value: number; pct: number; peers: number }[] } | null;
  transfers: TransferLine[]; trophies: { league: string; country: string; season: string; place: string }[];
  injury: { type: string | null; reason: string | null; date: string | null } | null;
  injury_history?: { type: string; start: string; end: string | null; days: number; matches_missed: number | null }[];
  matches: { match: ProMatch; team_id: number; starter: boolean; minutes: number | null; goals: number | null; assists: number | null; rating: number | null }[];
  college: { college_name: string; school_seo: string | null; first_season: number | null; last_season: number | null; college_player_slug: string | null; verified: boolean }[];
}

export default function ProPlayer() {
  const { slug = '' } = useParams();
  const [view, setView] = useState<'totals' | 'per90'>('totals');
  const q = useQuery({ queryKey: ['pro-player', slug], queryFn: () => api<PlayerData>(`/api/pro/players/${slug}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <ProMoved kind="player" slug={slug} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  const d = q.data!;
  const p = d.player;
  const isGk = /goal/i.test(p.position ?? '') || d.seasons.some((s) => (s.saves ?? 0) > 0 && /goal/i.test(s.position ?? ''));
  const club = d.seasons.filter((s) => !s.team?.national);
  const intl = d.seasons.filter((s) => s.team?.national);
  const career = club.reduce((a, s) => ({ apps: a.apps + s.apps, goals: a.goals + s.goals, assists: a.assists + s.assists, cs: a.cs + (s.clean_sheets ?? 0) }), { apps: 0, goals: 0, assists: 0, cs: 0 });
  const caps = intl.reduce((n, s) => n + s.apps, 0), intlGoals = intl.reduce((n, s) => n + s.goals, 0);
  const age = ageFrom(p.birth_date);
  const r = (v: number | null | undefined, s: SeasonRow) => (view === 'per90' ? per90(v ?? null, s.minutes) : v ?? null);
  const dec = view === 'per90' ? 2 : 0;
  const cols: Column<SeasonRow>[] = [
    { key: 'season', label: 'Season', primary: true, value: (s) => s.season, render: (s) => String(s.season) },
    { key: 'team', label: 'Club', value: (s) => s.team?.name ?? '', render: (s) => s.team ? <Link to={proPath.team(s.team.slug, s.season)} className="flex items-center gap-2 hover:text-pitch-300"><TeamLogo src={s.team.logo} name={s.team.name} size={18} />{s.team.name}</Link> : '–' },
    { key: 'league', label: 'Competition', priority: 2, value: (s) => s.league?.name ?? '', render: (s) => s.league ? <Link to={proPath.league(s.league.slug, s.season)} className="hover:text-pitch-300">{s.league.name}</Link> : '–' },
    { key: 'apps', label: 'Apps', num: true, value: (s) => s.apps },
    { key: 'minutes', label: 'Min', num: true, priority: 2, value: (s) => s.minutes },
    ...(isGk
      ? [{ key: 'clean_sheets', label: 'CS', title: 'Clean sheets', num: true, value: (s: SeasonRow) => s.clean_sheets }, { key: 'saves', label: 'Saves', num: true, decimals: dec, value: (s: SeasonRow) => r(s.saves, s) }, { key: 'conceded', label: 'GA', title: 'Goals conceded', num: true, decimals: dec, value: (s: SeasonRow) => r(s.conceded, s) }] as Column<SeasonRow>[]
      : [{ key: 'goals', label: 'G', title: 'Goals', num: true, decimals: dec, value: (s: SeasonRow) => r(s.goals, s) }, { key: 'assists', label: 'A', title: 'Assists', num: true, decimals: dec, value: (s: SeasonRow) => r(s.assists, s) },
        { key: 'shots', label: 'Sh', title: 'Shots', num: true, priority: 3, decimals: dec, value: (s: SeasonRow) => r(s.shots, s) }, { key: 'key_passes', label: 'KP', title: 'Key passes', num: true, priority: 3, decimals: dec, value: (s: SeasonRow) => r(s.key_passes, s) },
        { key: 'dribbles_won', label: 'Drb', title: 'Dribbles completed', num: true, priority: 3, decimals: dec, value: (s: SeasonRow) => r(s.dribbles_won, s) }] as Column<SeasonRow>[]),
    { key: 'tackles', label: 'Tkl', title: 'Tackles', num: true, priority: 3, decimals: dec, value: (s) => r(s.tackles, s) },
    { key: 'pass_accuracy', label: 'Pass %', title: 'Pass accuracy', num: true, priority: 3, value: (s) => s.pass_accuracy },
    { key: 'rating', label: 'Rating', title: 'Average match rating', num: true, decimals: 2, priority: 2, value: (s) => s.rating },
    { key: 'cards', label: 'Cards', title: 'Yellow / red cards', priority: 3, value: (s) => s.yellow, render: (s) => `${s.yellow}/${s.red}` },
  ];
  const facts = [p.position, age != null ? `${age} years old` : null, p.height_cm ? `${p.height_cm} cm` : null].filter(Boolean).join(' · ');
  const winners = d.trophies.filter((t) => /winner/i.test(t.place));
  return (
    <div className="space-y-5">
      <PageHeader title={<span className="flex items-center gap-3"><PlayerAvatar src={p.photo} name={p.name} size={64} />{p.name}</span>}
        meta={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"><Flag country={p.nationality} />{p.nationality}{facts && <> · {facts}</>}{d.team && <> · <Link to={proPath.team(d.team.slug)} className="inline-flex items-center gap-1 text-pitch-300 hover:text-pitch-200"><TeamLogo src={d.team.logo} name={d.team.name} size={16} />{d.team.name}</Link>{p.number != null && <span className="text-chalk-400"> No. {p.number}</span>}</>}</span>}>
        <Link to={proPaths2.compare(p.slug)} className="btn-ghost btn-sm"><GitCompare size={14} /> Compare</Link>
      </PageHeader>
      {d.injury && (
        <p className="flex items-center gap-2 rounded-md bg-loss/10 px-3 py-2 text-sm text-loss"><Ambulance size={16} aria-hidden />{d.injury.type === 'Questionable' ? 'Doubtful' : 'Out'}{d.injury.reason ? `: ${d.injury.reason}` : ''}{d.injury.date ? ` (listed ${fmt.date(d.injury.date)})` : ''}</p>
      )}
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
        <Figure label="Club appearances" value={fmt.num(career.apps)} sub="in our records" />
        {isGk ? <Figure label="Clean sheets" value={fmt.num(career.cs)} /> : <Figure label="Goals" value={fmt.num(career.goals)} sub={`${fmt.num(career.assists)} assists`} />}
        <Figure label="International" value={caps ? `${caps} caps` : '–'} sub={caps ? `${intlGoals} goals` : undefined} />
        <Figure label="Born" value={p.birth_date ? fmt.date(p.birth_date) : '–'} sub={[p.birth_place, p.birth_country].filter(Boolean).join(', ') || undefined} />
      </div>
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-8">
          <Section title="Career" right={<SegmentedControl label="Numbers" size="sm" value={view} onChange={setView} options={[{ value: 'totals', label: 'Totals' }, { value: 'per90', label: 'Per 90' }]} />}>
            <DataTable rows={d.seasons} columns={cols} rowKey={(s) => `${s.season}-${s.league?.id}-${s.team?.id}`} caption={`${p.name} career by season`} dense
              empty={<EmptyState title="No season stats yet" body="Season totals arrive as the crawl reaches this player's competitions." />} />
          </Section>
          {d.matches.length > 0 && (
            <Section title="Recent matches">
              <ul className="frame divide-y divide-field-700">
                {d.matches.slice(0, 10).map((m) => (
                  <li key={m.match.id} className="flex items-center">
                    <div className="min-w-0 flex-1"><ProMatchRow m={m.match} showDate showLeague /></div>
                    <span className="hidden w-36 shrink-0 px-3 text-right text-xs tnum text-chalk-400 sm:block">{(m.minutes ?? 0) > 0 ? `${m.minutes}′` : 'on the bench'}{m.goals ? ` · ${m.goals} G` : ''}{m.assists ? ` · ${m.assists} A` : ''}{m.rating != null ? ` · ${m.rating.toFixed(1)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        <div className="space-y-5 lg:col-span-4">
          {d.percentiles && d.percentiles.rows.length > 0 && (
            <Section title="Compared with peers">
              <PercentileBars rows={d.percentiles.rows} caption={`${d.percentiles.league?.name ?? ''} ${d.percentiles.season}, ${p.position ?? 'same position'}`} />
            </Section>
          )}
          {d.trophies.length > 0 && (
            <Section title={<span className="flex items-center gap-2"><Trophy size={16} aria-hidden className="text-note" />Honours{winners.length ? ` (${winners.length} won)` : ''}</span>}>
              <ul className="frame divide-y divide-field-700 text-sm">
                {d.trophies.slice(0, 20).map((t, i) => (
                  <li key={i} className="flex items-center gap-2 px-3 py-1.5"><span className={`w-16 shrink-0 text-2xs ${/winner/i.test(t.place) ? 'font-semibold text-note' : 'text-chalk-500'}`}>{t.place}</span><span className="min-w-0 flex-1 truncate text-chalk-200">{t.league}</span><span className="shrink-0 text-2xs tnum text-chalk-500">{t.season}</span></li>
                ))}
              </ul>
            </Section>
          )}
          {(d.injury_history?.length ?? 0) > 0 && (
            <Section title={<span className="flex items-center gap-2"><Ambulance size={16} aria-hidden className="text-loss" />Injury history</span>}>
              <ul className="frame divide-y divide-field-700 text-sm">
                {d.injury_history!.slice(0, 15).map((h, i) => (
                  <li key={`${h.start}-${h.type}-${i}`} className="flex flex-wrap items-center gap-x-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-chalk-200">{h.type}</span>
                    <span className="shrink-0 text-2xs tnum text-chalk-500">{fmt.date(h.start)} – {h.end ? fmt.date(h.end) : <span className="text-loss">now</span>}</span>
                    <span className="w-full text-2xs text-chalk-500">{h.days} {h.days === 1 ? 'day' : 'days'}{h.matches_missed ? ` · ${h.matches_missed} ${h.matches_missed === 1 ? 'match' : 'matches'} missed` : ''}</span>
                  </li>
                ))}
              </ul>
              {d.injury_history!.length > 15 && <p className="text-2xs text-chalk-500">{d.injury_history!.length - 15} earlier spells not shown.</p>}
            </Section>
          )}
          <Section title="Transfers"><TransfersList rows={d.transfers} /></Section>
        </div>
      </div>
    </div>
  );
}
