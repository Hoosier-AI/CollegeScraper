// One pro player: a header with the essentials (photo, club, position, number, nationality, age, size), this season at a
// glance, and four tabs:
//   Overview  goals and assists by season, form (match ratings), the percentile wheel against the same position,
//             recent matches
//   Stats     every season number we hold, by group (attacking, passing, defending, discipline, keeping), totals or
//             per 90, plus the advanced stats (xG, xA, goals added) where American Soccer Analysis covers the season
//   Matches   the match log: minutes, goals, assists, shots, passes, tackles, rating
//   Career    college, transfers, honours, injury history
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Ambulance, GitCompare, GraduationCap, Shirt, Trophy } from 'lucide-react';
import { api, ApiError, fmt, qs } from '../../lib/api';
import { useUrlState } from '../../lib/urlState';
import { ageFrom, per90, proPath, proPaths2, type ProLeagueRef, type ProMatch, type ProTeamRef } from '../../lib/pro';
import { DataTable, type Column } from '../../components/DataTable';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { Flag, PercentileBars, TransfersList, type TransferLine } from '../../components/pro/People';
import { FormLine, PercentileWheel, SeasonBars } from '../../components/pro/Charts';
import { Credit, GplusBars, PlayerAdvancedTable, type AdvPlayerSeason, type SourceCredit } from '../../components/pro/Advanced';
import { EmptyState, ErrorBox, PlayerAvatar, Section, SegmentedControl, Skeleton, TabsNav, TeamLogo } from '../../components/primitives';
import { ProMoved } from './ProMoved';

type N = number | null;
interface SeasonRow {
  season: number; league: (ProLeagueRef & { priority?: number }) | null; team: (ProTeamRef & { national?: boolean }) | null; source: string; position: string | null;
  apps: number; starts: number; minutes: number; goals: number; assists: number; shots: N; shots_on: N; key_passes: N; passes: N; pass_accuracy: N;
  tackles: N; interceptions: N; duels_won: N; dribbles_won: N; yellow: number; red: number; saves: N; conceded: N; clean_sheets: N; rating: N;
  lineups?: N; sub_in?: N; sub_out?: N; bench?: N; captain?: N; blocks?: N; duels?: N; dribbles?: N; dribbled_past?: N; fouls_drawn?: N; fouls_committed?: N; yellowred?: N;
  pen_won?: N; pen_committed?: N; pen_scored?: N; pen_missed?: N; pen_saved?: N;
}
interface MatchLine {
  match: ProMatch; team_id: number; starter: boolean; minutes: N; goals: N; assists: N; yellow: N; red: N; rating: N; saves?: N; conceded?: N; pos?: string | null;
  shots?: N; shots_on?: N; key_passes?: N; passes?: N; pass_accuracy?: N; tackles?: N; interceptions?: N; duels?: N; duels_won?: N; dribbles?: N; dribbles_won?: N; fouls_drawn?: N; fouls_committed?: N;
}
export interface PlayerData {
  player: { id: number; name: string; slug: string; short_name: string; birth_date: string | null; birth_place: string | null; birth_country: string | null; nationality: string | null; height_cm: number | null; weight_kg: number | null; position: string | null; photo: string | null; gender: 'm' | 'w' | null; number: number | null };
  team: ProTeamRef | null; seasons: SeasonRow[];
  percentiles: { league: ProLeagueRef | null; season: number; rows: { stat: string; value: number; pct: number; peers: number }[] } | null;
  transfers: TransferLine[]; trophies: { league: string; country: string; season: string; place: string }[];
  injury: { type: string | null; reason: string | null; date: string | null } | null;
  injury_history?: { type: string; start: string; end: string | null; days: number; matches_missed: number | null }[];
  advanced?: { credit: SourceCredit; seasons: AdvPlayerSeason[] } | null;
  matches: MatchLine[];
  college: { college_name: string; school_seo: string | null; first_season: number | null; last_season: number | null; college_player_slug: string | null; verified: boolean }[];
}

type Tab = 'overview' | 'stats' | 'matches' | 'career';
type Group = 'overview' | 'attacking' | 'passing' | 'defending' | 'discipline' | 'keeping';
const WHEEL_LABELS: Record<string, string> = { goals: 'Goals', assists: 'Assists', shots: 'Shots', shots_on: 'On target', key_passes: 'Key passes', passes: 'Passes', pass_accuracy: 'Pass %', tackles: 'Tackles', interceptions: 'Interceptions', duels_won: 'Duels won', dribbles_won: 'Dribbles', saves: 'Saves', rating: 'Rating' };
const SUM_KEYS = ['shots', 'shots_on', 'key_passes', 'passes', 'tackles', 'interceptions', 'duels_won', 'dribbles_won', 'saves', 'conceded', 'clean_sheets', 'blocks', 'duels', 'dribbles', 'dribbled_past', 'fouls_drawn', 'fouls_committed', 'pen_scored', 'pen_missed', 'pen_won', 'pen_committed', 'pen_saved', 'sub_in', 'sub_out', 'bench', 'yellowred'] as const;

/** Sum a set of season rows into one (pass accuracy and rating weighted). */
function sumRows(rows: SeasonRow[]): SeasonRow | null {
  if (!rows.length) return null;
  const out: Record<string, unknown> = { ...rows[0]!, apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0 };
  for (const k of SUM_KEYS) out[k] = null;
  let rw = 0, ra = 0, pw = 0, pp = 0;
  for (const r of rows) {
    for (const k of ['apps', 'starts', 'minutes', 'goals', 'assists', 'yellow', 'red'] as const) out[k] = (out[k] as number) + (r[k] ?? 0);
    for (const k of SUM_KEYS) { const v = (r as unknown as Record<string, N>)[k]; if (v != null) out[k] = ((out[k] as N) ?? 0) + v; }
    if (r.rating != null && r.apps) { rw += r.rating * r.apps; ra += r.apps; }
    if (r.pass_accuracy != null && r.passes) { pw += r.pass_accuracy * r.passes; pp += r.passes; }
  }
  out.rating = ra ? Math.round((rw / ra) * 100) / 100 : null;
  out.pass_accuracy = pp ? Math.round(pw / pp) : null;
  return out as unknown as SeasonRow;
}

function Tile({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg border px-3 py-2.5 ${accent ? 'border-pitch-400/40 bg-pitch-400/5' : 'border-field-700 bg-field-900/60'}`}>
      <div className="display text-2xl tnum text-chalk-100">{value}</div>
      <div className="truncate text-2xs uppercase tracking-wider text-chalk-500">{label}</div>
      {sub != null && <div className="truncate text-2xs text-chalk-400">{sub}</div>}
    </div>
  );
}

const ratingChip = (v: number) => (v >= 8 ? 'bg-win/20 text-win' : v >= 7 ? 'bg-pitch-400/15 text-pitch-300' : v >= 6.3 ? 'bg-note/15 text-note' : 'bg-loss/15 text-loss');

export default function ProPlayer() {
  const { slug = '' } = useParams();
  const [view, setView] = useState<'totals' | 'per90'>('totals');
  const [group, setGroup] = useState<Group>('overview');
  const [tab] = useUrlState('tab', 'overview', { allow: ['overview', 'stats', 'matches', 'career'] });
  const q = useQuery({ queryKey: ['pro-player', slug], queryFn: () => api<PlayerData>(`/api/pro/players/${slug}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <ProMoved kind="player" slug={slug} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-40" /><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  const d = q.data!;
  const p = d.player;
  const isGk = /goal/i.test(p.position ?? '') || d.seasons.some((s) => (s.saves ?? 0) > 0 && /goal/i.test(s.position ?? ''));
  const club = d.seasons.filter((s) => !s.team?.national);
  const intl = d.seasons.filter((s) => s.team?.national);
  const caps = intl.reduce((n, s) => n + s.apps, 0), intlGoals = intl.reduce((n, s) => n + s.goals, 0);
  const latest = club[0]?.season ?? null;
  const now = sumRows(club.filter((s) => s.season === latest));
  const adv = d.advanced?.seasons.filter((s) => s.season === latest) ?? [];
  const xg = adv.reduce((n, s) => n + (s.xg ?? 0), 0), xa = adv.reduce((n, s) => n + (s.xa ?? 0), 0);
  const age = ageFrom(p.birth_date);
  const winners = d.trophies.filter((t) => /winner/i.test(t.place));
  const hrefFor = (x: Tab) => `${proPath.player(p.slug)}${qs({ tab: x === 'overview' ? undefined : x })}`;

  // Goals and assists by season, club competitions together (oldest first).
  const bySeason = [...new Set(club.map((s) => s.season))].sort((a, b) => a - b).map((y) => {
    const rows = club.filter((s) => s.season === y);
    return { label: String(y), a: rows.reduce((n, s) => n + s.goals, 0), b: rows.reduce((n, s) => n + s.assists, 0) };
  });
  const form = d.matches.filter((m) => m.rating != null && (m.minutes ?? 0) > 0).slice(0, 15).reverse().map((m) => {
    const home = m.team_id === m.match.home.id;
    const opp = home ? m.match.away : m.match.home;
    return { label: `${home ? 'v' : '@'} ${opp.name}`, value: m.rating!, href: proPath.match(m.match.slug), title: `${fmt.date(m.match.kickoff)} ${home ? 'v' : '@'} ${opp.name}: ${m.rating!.toFixed(1)}${m.goals ? `, ${m.goals} G` : ''}${m.assists ? `, ${m.assists} A` : ''}` };
  });

  const r = (v: N | undefined, s: SeasonRow) => (view === 'per90' ? per90(v ?? null, s.minutes) : v ?? null);
  const dec = view === 'per90' ? 2 : 0;
  const col = (key: string, label: string, get: (s: SeasonRow) => N | undefined, o: { title?: string; scale?: boolean; decimals?: number; priority?: 2 | 3 } = {}): Column<SeasonRow> =>
    ({ key, label, title: o.title, num: true, priority: o.priority, decimals: o.scale === false ? o.decimals ?? 0 : dec, value: (s: SeasonRow) => (o.scale === false ? get(s) ?? null : r(get(s), s)) });
  const share = (a: N | undefined, b: N | undefined) => (a != null && b ? Math.round((a / b) * 100) : null);
  const base: Column<SeasonRow>[] = [
    { key: 'season', label: 'Season', primary: true, value: (s) => s.season, render: (s) => String(s.season) },
    { key: 'team', label: 'Club', value: (s) => s.team?.name ?? '', render: (s) => s.team ? <Link to={proPath.team(s.team.slug, s.season)} className="flex items-center gap-2 hover:text-pitch-300"><TeamLogo src={s.team.logo} name={s.team.name} size={18} /><span className="truncate">{s.team.name}</span></Link> : '–' },
    { key: 'league', label: 'Competition', priority: 2, value: (s) => s.league?.name ?? '', render: (s) => s.league ? <Link to={proPath.league(s.league.slug, s.season)} className="hover:text-pitch-300">{s.league.name}</Link> : '–' },
  ];
  const GROUPS: Record<Group, Column<SeasonRow>[]> = {
    overview: [col('apps', 'Apps', (s) => s.apps, { scale: false }), col('starts', 'Starts', (s) => s.starts, { scale: false, priority: 2 }), col('minutes', 'Min', (s) => s.minutes, { scale: false }),
      col('goals', 'G', (s) => s.goals, { title: 'Goals' }), col('assists', 'A', (s) => s.assists, { title: 'Assists' }), col('rating', 'Rating', (s) => s.rating, { scale: false, decimals: 2, title: 'Average match rating' })],
    attacking: [col('goals', 'G', (s) => s.goals, { title: 'Goals' }), col('shots', 'Sh', (s) => s.shots, { title: 'Shots' }), col('shots_on', 'SoT', (s) => s.shots_on, { title: 'Shots on target' }),
      col('conv', 'Conv %', (s) => share(s.goals, s.shots), { scale: false, title: 'Goals per shot' }), col('dribbles', 'Drb', (s) => s.dribbles, { title: 'Dribbles attempted', priority: 2 }), col('dribbles_won', 'Drb won', (s) => s.dribbles_won, { title: 'Dribbles completed' }),
      col('pen_scored', 'Pen', (s) => s.pen_scored, { title: 'Penalties scored', priority: 2 }), col('pen_won', 'Pen won', (s) => s.pen_won, { title: 'Penalties won', priority: 3 }), col('fouls_drawn', 'Fouled', (s) => s.fouls_drawn, { title: 'Fouls drawn', priority: 3 })],
    passing: [col('assists', 'A', (s) => s.assists, { title: 'Assists' }), col('key_passes', 'KP', (s) => s.key_passes, { title: 'Key passes' }), col('passes', 'Passes', (s) => s.passes),
      col('pass_accuracy', 'Pass %', (s) => s.pass_accuracy, { scale: false, title: 'Pass accuracy' })],
    defending: [col('tackles', 'Tkl', (s) => s.tackles, { title: 'Tackles' }), col('interceptions', 'Int', (s) => s.interceptions, { title: 'Interceptions' }), col('blocks', 'Blk', (s) => s.blocks, { title: 'Blocks' }),
      col('duels', 'Duels', (s) => s.duels, { priority: 2 }), col('duels_won', 'Won', (s) => s.duels_won, { title: 'Duels won' }), col('duel_pct', 'Duel %', (s) => share(s.duels_won, s.duels), { scale: false, title: 'Share of duels won' }),
      col('dribbled_past', 'Beaten', (s) => s.dribbled_past, { title: 'Dribbled past', priority: 3 })],
    discipline: [col('yellow', 'Yellow', (s) => s.yellow), col('yellowred', '2nd yellow', (s) => s.yellowred, { priority: 2 }), col('red', 'Red', (s) => s.red),
      col('fouls_committed', 'Fouls', (s) => s.fouls_committed, { title: 'Fouls committed' }), col('pen_committed', 'Pen conc.', (s) => s.pen_committed, { title: 'Penalties conceded', priority: 2 }),
      col('sub_in', 'On', (s) => s.sub_in, { scale: false, title: 'Came on', priority: 3 }), col('sub_out', 'Off', (s) => s.sub_out, { scale: false, title: 'Taken off', priority: 3 }), col('bench', 'Bench', (s) => s.bench, { scale: false, title: 'Unused substitute', priority: 3 })],
    keeping: [col('clean_sheets', 'CS', (s) => s.clean_sheets, { scale: false, title: 'Clean sheets' }), col('saves', 'Saves', (s) => s.saves), col('conceded', 'GA', (s) => s.conceded, { title: 'Goals conceded' }),
      col('save_pct', 'Save %', (s) => share(s.saves, (s.saves ?? 0) + (s.conceded ?? 0)), { scale: false, title: 'Share of shots on target saved' }), col('pen_saved', 'Pen saved', (s) => s.pen_saved, { title: 'Penalties saved' })],
  };
  const groupOptions = ([['overview', 'Overview'], ['attacking', 'Attacking'], ['passing', 'Passing'], ['defending', 'Defending'], ['discipline', 'Discipline'], ...(isGk ? [['keeping', 'Keeping']] : [])] as [Group, string][])
    .map(([value, label]) => ({ value, label }));

  const matchCols: Column<MatchLine>[] = [
    { key: 'date', label: 'Date', value: (m) => m.match.kickoff, render: (m) => <span className="tnum text-chalk-400">{fmt.date(m.match.kickoff)}</span> },
    { key: 'opp', label: 'Opponent', primary: true, value: (m) => (m.team_id === m.match.home.id ? m.match.away.name : m.match.home.name), render: (m) => { const home = m.team_id === m.match.home.id; const o = home ? m.match.away : m.match.home; return <span className="flex items-center gap-1.5"><span className="w-4 text-2xs text-chalk-500">{home ? 'v' : '@'}</span><TeamLogo src={o.logo} name={o.name} size={16} /><span className="truncate">{o.name}</span></span>; } },
    { key: 'result', label: 'Result', value: (m) => `${m.match.home.score ?? ''}-${m.match.away.score ?? ''}`, render: (m) => {
      const home = m.team_id === m.match.home.id; const us = (home ? m.match.home.score : m.match.away.score) ?? 0, them = (home ? m.match.away.score : m.match.home.score) ?? 0;
      const tone = us > them ? 'bg-win/15 text-win' : us < them ? 'bg-loss/15 text-loss' : 'bg-draw/15 text-draw';
      return <span className={`rounded px-1.5 py-0.5 text-xs tnum ${tone}`}>{us}-{them}</span>; } },
    { key: 'comp', label: 'Competition', priority: 3, value: (m) => m.match.league.name },
    { key: 'min', label: 'Min', num: true, value: (m) => m.minutes, render: (m) => (m.minutes ? `${m.minutes}′` : <span className="text-chalk-500">bench</span>) },
    { key: 'g', label: 'G', num: true, value: (m) => m.goals || null },
    { key: 'a', label: 'A', num: true, value: (m) => m.assists || null },
    { key: 'sh', label: 'Sh', title: 'Shots (on target)', num: true, priority: 2, value: (m) => m.shots ?? null, render: (m) => (m.shots == null ? '–' : `${m.shots} (${m.shots_on ?? 0})`) },
    { key: 'kp', label: 'KP', title: 'Key passes', num: true, priority: 2, value: (m) => m.key_passes ?? null },
    { key: 'pass', label: 'Passes', num: true, priority: 3, value: (m) => m.passes ?? null, render: (m) => (m.passes == null ? '–' : `${m.passes}${m.pass_accuracy != null ? ` (${m.pass_accuracy})` : ''}`) },
    { key: 'tkl', label: 'Tkl', title: 'Tackles', num: true, priority: 3, value: (m) => m.tackles ?? null },
    { key: 'rating', label: 'Rating', num: true, decimals: 1, value: (m) => m.rating, render: (m) => (m.rating == null ? '–' : <span className={`rounded px-1.5 py-0.5 text-xs tnum font-semibold ${ratingChip(m.rating)}`}>{m.rating.toFixed(1)}</span>) },
  ];

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'stats', label: 'Stats' }, { id: 'matches', label: 'Matches', count: d.matches.length || undefined }, { id: 'career', label: 'Career' },
  ];
  const chips = [p.position, p.number != null ? `No. ${p.number}` : null, age != null ? `${age} years old` : null, p.height_cm ? `${p.height_cm} cm` : null, p.weight_kg ? `${p.weight_kg} kg` : null].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      <header className="relative overflow-hidden rounded-xl border border-field-700 bg-gradient-to-br from-field-800 via-field-900 to-field-950 p-4 sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-pitch-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative w-fit shrink-0">
            <PlayerAvatar src={p.photo} name={p.name} size={104} />
            {d.team && <span className="absolute -bottom-1 -right-1 rounded-full bg-field-900 p-1 ring-2 ring-field-700"><TeamLogo src={d.team.logo} name={d.team.name} size={28} /></span>}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="display text-3xl leading-tight text-chalk-100 sm:text-4xl">{p.name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-chalk-300">
              {d.team && <Link to={proPath.team(d.team.slug)} className="inline-flex items-center gap-1.5 font-medium text-pitch-300 hover:text-pitch-200"><Shirt size={14} aria-hidden />{d.team.name}</Link>}
              {p.nationality && <span className="inline-flex items-center gap-1.5"><Flag country={p.nationality} />{p.nationality}</span>}
            </div>
            <ul className="flex flex-wrap gap-1.5" aria-label="Profile">
              {chips.map((c) => <li key={c} className="rounded-full border border-field-600 bg-field-900/70 px-2.5 py-0.5 text-xs text-chalk-200">{c}</li>)}
              {p.birth_date && <li className="rounded-full border border-field-600 bg-field-900/70 px-2.5 py-0.5 text-xs text-chalk-200">Born {fmt.date(p.birth_date)}{p.birth_place ? `, ${p.birth_place}` : ''}</li>}
            </ul>
          </div>
          <Link to={proPaths2.compare(p.slug)} className="btn-ghost btn-sm self-start"><GitCompare size={14} /> Compare</Link>
        </div>
      </header>

      {d.injury && (
        <p className="flex items-center gap-2 rounded-md bg-loss/10 px-3 py-2 text-sm text-loss"><Ambulance size={16} aria-hidden />{d.injury.type === 'Questionable' ? 'Doubtful' : 'Out'}{d.injury.reason ? `: ${d.injury.reason}` : ''}{d.injury.date ? ` (listed ${fmt.date(d.injury.date)})` : ''}</p>
      )}

      {now && (
        <section aria-label={`${latest} at a glance`} className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-chalk-500">{latest}, club competitions</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Tile label="Appearances" value={now.apps} sub={`${now.starts} starts`} />
            <Tile label="Minutes" value={fmt.num(now.minutes)} sub={now.apps ? `${Math.round(now.minutes / now.apps)} a match` : undefined} />
            {isGk ? <>
              <Tile label="Clean sheets" value={now.clean_sheets ?? '–'} accent />
              <Tile label="Saves" value={now.saves ?? '–'} sub={now.saves != null && now.conceded != null ? `${Math.round((now.saves / Math.max(1, now.saves + now.conceded)) * 100)}% saved` : undefined} />
              <Tile label="Conceded" value={now.conceded ?? '–'} />
            </> : <>
              <Tile label="Goals" value={now.goals} sub={xg ? `${xg.toFixed(1)} xG` : now.minutes >= 450 ? `${per90(now.goals, now.minutes)?.toFixed(2)} per 90` : undefined} accent />
              <Tile label="Assists" value={now.assists} sub={xa ? `${xa.toFixed(1)} xA` : undefined} accent />
              <Tile label="Shots" value={now.shots ?? '–'} sub={now.shots_on != null ? `${now.shots_on} on target` : undefined} />
            </>}
            <Tile label="Key passes" value={now.key_passes ?? '–'} />
            <Tile label="Pass accuracy" value={now.pass_accuracy != null ? `${now.pass_accuracy}%` : '–'} />
            <Tile label="Rating" value={now.rating != null ? now.rating.toFixed(2) : '–'} sub="average" />
          </div>
        </section>
      )}

      <TabsNav label="Player sections" tabs={tabs} value={tab as Tab} hrefFor={hrefFor} />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-7">
            {!d.seasons.length && <EmptyState title="No season stats yet" body="Season totals arrive as the crawl reaches this player's competitions." />}
            <SeasonBars rows={bySeason} a="Goals" b="Assists" caption="Goals and assists by season (club)" />
            <FormLine points={form} caption={`Match ratings, last ${form.length} matches`} />
            {d.matches.length > 0 && (
              <Section title="Recent matches" right={<Link to={hrefFor('matches')} className="text-xs text-pitch-300 hover:text-pitch-200">All matches</Link>}>
                <ul className="frame divide-y divide-field-700">
                  {d.matches.slice(0, 6).map((m) => (
                    <li key={m.match.id} className="flex items-center">
                      <div className="min-w-0 flex-1"><ProMatchRow m={m.match} showDate showLeague /></div>
                      <span className="hidden w-36 shrink-0 px-3 text-right text-xs tnum text-chalk-400 sm:block">{(m.minutes ?? 0) > 0 ? `${m.minutes}′` : 'on the bench'}{m.goals ? ` · ${m.goals} G` : ''}{m.assists ? ` · ${m.assists} A` : ''}{m.rating != null ? ` · ${m.rating.toFixed(1)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
          <div className="space-y-5 lg:col-span-5">
            {d.percentiles && d.percentiles.rows.length > 0 && (
              <Section title="Compared with peers">
                <PercentileWheel rows={d.percentiles.rows} labels={WHEEL_LABELS} caption={`Percentiles per 90 against ${d.percentiles.rows[0]?.peers ?? 0} players in the same position, ${d.percentiles.league?.name ?? ''} ${d.percentiles.season}`} />
                <details className="text-xs text-chalk-400"><summary className="cursor-pointer hover:text-chalk-200">Show as bars</summary><div className="mt-2"><PercentileBars rows={d.percentiles.rows} caption={`${d.percentiles.league?.name ?? ''} ${d.percentiles.season}, ${p.position ?? 'same position'}`} /></div></details>
              </Section>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Club appearances" value={fmt.num(club.reduce((n2, s) => n2 + s.apps, 0))} sub={`${fmt.num(club.reduce((n2, s) => n2 + s.goals, 0))} goals, ${fmt.num(club.reduce((n2, s) => n2 + s.assists, 0))} assists`} />
              <Tile label="International" value={caps ? `${caps} caps` : '–'} sub={caps ? `${intlGoals} goals` : undefined} />
            </div>
            {winners.length > 0 && <p className="flex items-center gap-2 text-sm text-chalk-300"><Trophy size={16} aria-hidden className="text-note" />{winners.length} {winners.length === 1 ? 'trophy' : 'trophies'} won · <Link to={hrefFor('career')} className="text-pitch-300 hover:text-pitch-200">Career</Link></p>}
          </div>
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl label="Stat group" size="sm" value={group} onChange={setGroup} options={groupOptions} />
            <SegmentedControl label="Numbers" size="sm" value={view} onChange={setView} options={[{ value: 'totals', label: 'Totals' }, { value: 'per90', label: 'Per 90' }]} />
          </div>
          <DataTable rows={d.seasons} columns={[...base, ...GROUPS[group]]} rowKey={(s) => `${s.season}-${s.league?.id}-${s.team?.id}`} caption={`${p.name} by season: ${group}`} dense
            empty={<EmptyState title="No season stats yet" body="Season totals arrive as the crawl reaches this player's competitions." />} />
          {d.advanced && d.advanced.seasons.length > 0 && (
            <Section title="Advanced">
              <PlayerAdvancedTable seasons={d.advanced.seasons} />
              {d.advanced.seasons[0]!.g_plus_by_action && <GplusBars byAction={d.advanced.seasons[0]!.g_plus_by_action} caption={`Goals added above average by action, ${d.advanced.seasons[0]!.season}${d.advanced.seasons[0]!.team ? `, ${d.advanced.seasons[0]!.team.name}` : ''}`} />}
              <Credit credit={d.advanced.credit} />
            </Section>
          )}
        </div>
      )}

      {tab === 'matches' && (
        d.matches.length
          ? <DataTable rows={d.matches} columns={matchCols} rowKey={(m) => String(m.match.id)} caption={`${p.name} match log`} dense rowHref={(m) => proPath.match(m.match.slug)} />
          : <EmptyState title="No match lines yet" body="Lineups and match stats arrive as the crawl reaches this player's matches." />
      )}

      {tab === 'career' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
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
            <Section title="Transfers"><TransfersList rows={d.transfers} /></Section>
          </div>
          <div className="space-y-5">
            <Section title={<span className="flex items-center gap-2"><Trophy size={16} aria-hidden className="text-note" />Honours{winners.length ? ` (${winners.length} won)` : ''}</span>}>
              {d.trophies.length ? (
                <ul className="frame divide-y divide-field-700 text-sm">
                  {d.trophies.slice(0, 30).map((t, i) => (
                    <li key={i} className="flex items-center gap-2 px-3 py-1.5"><span className={`w-16 shrink-0 text-2xs ${/winner/i.test(t.place) ? 'font-semibold text-note' : 'text-chalk-500'}`}>{t.place}</span><span className="min-w-0 flex-1 truncate text-chalk-200">{t.league}</span><span className="shrink-0 text-2xs tnum text-chalk-500">{t.season}</span></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-chalk-400">No honours recorded yet.</p>}
            </Section>
            <Section title={<span className="flex items-center gap-2"><Ambulance size={16} aria-hidden className="text-loss" />Injury history</span>}>
              {(d.injury_history?.length ?? 0) > 0 ? (
                <ul className="frame divide-y divide-field-700 text-sm">
                  {d.injury_history!.slice(0, 20).map((h, i) => (
                    <li key={`${h.start}-${h.type}-${i}`} className="flex flex-wrap items-center gap-x-2 px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-chalk-200">{h.type}</span>
                      <span className="shrink-0 text-2xs tnum text-chalk-500">{fmt.date(h.start)} – {h.end ? fmt.date(h.end) : <span className="text-loss">now</span>}</span>
                      <span className="w-full text-2xs text-chalk-500">{h.days} {h.days === 1 ? 'day' : 'days'}{h.matches_missed ? ` · ${h.matches_missed} ${h.matches_missed === 1 ? 'match' : 'matches'} missed` : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-chalk-400">No injuries recorded.</p>}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}
