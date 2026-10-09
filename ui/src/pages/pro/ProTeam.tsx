// One club: record and table places, the current squad by position (number, age, nationality, season numbers), coach,
// injuries, ground, goals by 15-minute period, home/away splits, the provider's season stats (formations, biggest
// results, streaks, clean sheets, penalties, cards by minute), transfers in and out, results and fixtures.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Ambulance } from 'lucide-react';
import { api, ApiError, fmt, qs } from '../../lib/api';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { ageFrom, positionShort, proPath, type ProLeagueRef, type ProMatch, type ProTeamRef } from '../../lib/pro';
import { DataTable, type Column } from '../../components/DataTable';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { ProForm } from '../../components/pro/LeagueTable';
import { Flag, GoalsByPeriod, TransfersList, type TransferLine } from '../../components/pro/People';
import { EmptyState, ErrorBox, Figure, PageHeader, PlayerAvatar, Section, Select, Skeleton, TabsNav, TeamLogo } from '../../components/primitives';
import { ClubSeasonDetail, GroundCard, type ClubSeasonRow, type Ground } from '../../components/pro/ClubSeason';
import { ProMoved } from './ProMoved';

interface SquadRow { player: { id: number; name: string; slug: string; photo: string | null; position: string | null; nationality: string | null; birth_date: string | null }; number: number | null; listed: boolean; apps: number; starts: number; minutes: number; goals: number; assists: number; yellow: number; red: number; saves: number | null; conceded: number | null; clean_sheets: number | null; rating: number | null }
interface Split { played: number; w: number; d: number; l: number; gf: number; ga: number }
interface TeamData {
  team: ProTeamRef & { founded: number | null; national: boolean; venue: Ground | null };
  season: number | null; seasons: number[];
  competitions: { league: (ProLeagueRef & { priority: number }) | null; played: number; w: number; d: number; l: number; gf: number; ga: number; clean_sheets: number; possession: number | null }[];
  standings: { league: ProLeagueRef | null; group: string; rank: number | null; points: number | null; played: number | null; form: string | null }[];
  squad: SquadRow[];
  coaches: { id: number; name: string; photo: string | null; nationality: string | null; birth_date: string | null; start: string | null; end: string | null; current: boolean; trophies?: number }[];
  transfers: TransferLine[];
  injuries: { player: { name: string; slug: string } | null; type: string | null; reason: string | null; date: string | null }[];
  goals_by_period: { period: string; for: number; against: number }[];
  goals_by_period_source?: 'provider' | 'events';
  season_detail?: ClubSeasonRow[];
  splits: { home: Split; away: Split };
  results: ProMatch[]; fixtures: ProMatch[];
}
type Tab = 'squad' | 'matches' | 'stats' | 'transfers';
const GROUPS = [['Goalkeeper', 'Goalkeepers'], ['Defender', 'Defenders'], ['Midfielder', 'Midfielders'], ['Attacker', 'Forwards'], ['', 'Other players']] as const;

export default function ProTeam() {
  const { slug = '' } = useParams();
  const patch = useUrlPatch();
  const [seasonParam] = useUrlState('season', '');
  const [tab] = useUrlState('tab', 'squad', { allow: ['squad', 'matches', 'stats', 'transfers'] });
  const q = useQuery({ queryKey: ['pro-team', slug, seasonParam], queryFn: () => api<TeamData>(`/api/pro/teams/${slug}${qs({ season: seasonParam })}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <ProMoved kind="team" slug={slug} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  const d = q.data!;
  const t = d.team;
  const total = d.competitions.reduce((a, c) => ({ p: a.p + c.played, w: a.w + c.w, d: a.d + c.d, l: a.l + c.l, gf: a.gf + c.gf, ga: a.ga + c.ga }), { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  const coach = d.coaches.find((c) => c.current) ?? null;
  const hrefFor = (x: Tab) => `${proPath.team(slug)}${qs({ season: seasonParam || undefined, tab: x === 'squad' ? undefined : x })}`;
  const cols: Column<SquadRow>[] = [
    { key: 'number', label: '#', num: true, value: (r) => r.number },
    { key: 'name', label: 'Player', primary: true, value: (r) => r.player.name, render: (r) => <span className="flex items-center gap-2"><PlayerAvatar src={r.player.photo} name={r.player.name} size={22} /><span className="truncate">{r.player.name}</span><Flag country={r.player.nationality} size={11} /></span> },
    { key: 'position', label: 'Pos', value: (r) => r.player.position ?? '', render: (r) => positionShort(r.player.position) },
    { key: 'age', label: 'Age', num: true, priority: 2, value: (r) => ageFrom(r.player.birth_date) },
    { key: 'apps', label: 'Apps', title: 'Appearances', num: true, value: (r) => r.apps },
    { key: 'minutes', label: 'Min', title: 'Minutes', num: true, priority: 2, value: (r) => r.minutes },
    { key: 'goals', label: 'G', title: 'Goals', num: true, value: (r) => r.goals },
    { key: 'assists', label: 'A', title: 'Assists', num: true, value: (r) => r.assists },
    { key: 'rating', label: 'Rating', title: 'Average match rating', num: true, decimals: 2, priority: 2, value: (r) => r.rating },
    { key: 'clean_sheets', label: 'CS', title: 'Clean sheets (keepers)', num: true, priority: 3, value: (r) => r.clean_sheets },
    { key: 'cards', label: 'Cards', title: 'Yellow / red', priority: 3, value: (r) => r.yellow, render: (r) => `${r.yellow}/${r.red}` },
  ];
  const tabs: { id: Tab; label: string; count?: number }[] = [{ id: 'squad', label: 'Squad', count: d.squad.length }, { id: 'matches', label: 'Matches', count: d.results.length + d.fixtures.length }, { id: 'stats', label: 'Stats' }, { id: 'transfers', label: 'Transfers', count: d.transfers.length }];
  const splitRow = (label: string, s: Split) => <tr className="border-t border-field-700"><th scope="row" className="td text-left font-normal text-chalk-300">{label}</th><td className="td text-right tnum">{s.played}</td><td className="td text-right tnum">{s.w}-{s.d}-{s.l}</td><td className="td text-right tnum">{s.gf}:{s.ga}</td><td className="td text-right tnum">{s.played ? ((s.w * 3 + s.d) / s.played).toFixed(2) : '–'}</td></tr>;
  return (
    <div className="space-y-5">
      <PageHeader title={<span className="flex items-center gap-3"><TeamLogo src={t.logo} name={t.name} size={52} />{t.name}</span>}
        meta={<span className="inline-flex flex-wrap items-center gap-x-2"><Flag country={t.country} />{[t.country, t.founded ? `founded ${t.founded}` : null, t.venue ? `${t.venue.name}${t.venue.city ? `, ${t.venue.city}` : ''}${t.venue.capacity ? ` (${fmt.num(t.venue.capacity)})` : ''}` : null, coach ? `coach ${coach.name}` : null].filter(Boolean).join(' · ')}</span>}>
        {d.seasons.length > 1 && <Select aria-label="Season" className="h-9 text-sm" value={String(d.season ?? '')} onChange={(v) => patch({ season: v === String(d.seasons[0]) ? null : v })} options={d.seasons.map((s) => ({ value: String(s), label: String(s) }))} />}
      </PageHeader>
      {d.season != null && total.p > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label={`${d.season} record`} value={`${total.w}-${total.d}-${total.l}`} sub="won, drawn, lost" />
          <Figure label="Goals" value={`${total.gf}:${total.ga}`} sub={`${total.p} matches`} />
          {d.standings.slice(0, 2).map((s) => s.league && <Figure key={`${s.league.id}-${s.group}`} label={s.group || s.league.name} value={s.rank ? fmt.ordinal(s.rank) : '–'} sub={<span className="inline-flex items-center gap-2">{s.points ?? 0} pts <ProForm form={s.form} /></span>} />)}
        </div>
      )}
      {d.injuries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-loss/10 px-3 py-2 text-sm text-loss">
          <Ambulance size={16} aria-hidden /><span className="font-medium">Unavailable:</span>
          {d.injuries.map((i, k) => <span key={k} className="text-chalk-200">{i.player ? <Link to={proPath.player(i.player.slug)} className="hover:text-pitch-300">{i.player.name}</Link> : 'Unknown'}{i.reason ? ` (${i.reason.toLowerCase()})` : ''}{k < d.injuries.length - 1 ? ',' : ''}</span>)}
        </div>
      )}
      <TabsNav label="Club sections" tabs={tabs} value={tab as Tab} hrefFor={hrefFor} />
      {tab === 'squad' && (
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            {GROUPS.map(([pos, label]) => {
              const rows = d.squad.filter((r) => (pos ? r.player.position === pos : !GROUPS.slice(0, 4).some(([p]) => p === r.player.position)));
              return rows.length ? <Section key={label} title={label}><DataTable rows={rows} columns={cols} rowKey={(r) => String(r.player.id)} caption={`${t.name} ${label.toLowerCase()}`} rowHref={(r) => proPath.player(r.player.slug)} dense /></Section> : null;
            })}
            {!d.squad.length && <EmptyState title="No squad yet" body="The squad arrives as the crawl reaches this club." />}
          </div>
          <div className="space-y-5 lg:col-span-4">
            {t.venue && <Section title="Ground"><GroundCard ground={t.venue} /></Section>}
            {d.coaches.length > 0 && (
              <Section title="Coaches">
                <ul className="frame divide-y divide-field-700 text-sm">
                  {d.coaches.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 px-3 py-2"><PlayerAvatar src={c.photo} name={c.name} size={28} /><span className="min-w-0 flex-1"><span className="block truncate font-medium text-chalk-100">{c.name} <Flag country={c.nationality} size={10} /></span><span className="text-2xs text-chalk-500">{c.start ? fmt.date(c.start) : '?'} – {c.end ? fmt.date(c.end) : 'now'}{c.trophies ? ` · ${c.trophies} ${c.trophies === 1 ? 'trophy' : 'trophies'}` : ''}</span></span>{c.current && <span className="rounded bg-pitch-400/15 px-1.5 text-2xs text-pitch-300">current</span>}</li>
                  ))}
                </ul>
              </Section>
            )}
            {d.fixtures.length > 0 && <Section title="Next matches"><div className="frame divide-y divide-field-700">{d.fixtures.slice(0, 5).map((m) => <ProMatchRow key={m.id} m={m} showDate showLeague />)}</div></Section>}
          </div>
        </div>
      )}
      {tab === 'matches' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Results">{d.results.length ? <div className="frame divide-y divide-field-700">{d.results.map((m) => <ProMatchRow key={m.id} m={m} showDate showLeague />)}</div> : <p className="text-sm text-chalk-400">No results this season yet.</p>}</Section>
          <Section title="Fixtures">{d.fixtures.length ? <div className="frame divide-y divide-field-700">{d.fixtures.map((m) => <ProMatchRow key={m.id} m={m} showDate showLeague />)}</div> : <p className="text-sm text-chalk-400">No upcoming fixtures.</p>}</Section>
        </div>
      )}
      {tab === 'stats' && (
        <div className="grid gap-5 lg:grid-cols-2">
          {(d.season_detail?.length ?? 0) > 0 && <div className="lg:col-span-2"><Section title={`${d.season} in detail`}><ClubSeasonDetail rows={d.season_detail!} /></Section></div>}
          <Section title="Goals by period"><GoalsByPeriod rows={d.goals_by_period} /></Section>
          <Section title="Home and away">
            <div className="frame overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Home and away record</caption>
              <thead><tr className="text-2xs text-chalk-500"><th className="th text-left" scope="col"></th><th className="th text-right" scope="col">P</th><th className="th text-right" scope="col">W-D-L</th><th className="th text-right" scope="col">Goals</th><th className="th text-right" scope="col">Pts/game</th></tr></thead>
              <tbody>{splitRow('Home', d.splits.home)}{splitRow('Away', d.splits.away)}</tbody></table></div>
          </Section>
          <Section title="By competition">
            <ul className="frame divide-y divide-field-700 text-sm">
              {d.competitions.map((c) => c.league && (
                <li key={c.league.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2"><Link to={proPath.league(c.league.slug, d.season)} className="min-w-0 flex-1 truncate font-medium text-chalk-100 hover:text-pitch-300">{c.league.name}</Link>
                  <span className="text-xs tnum text-chalk-300">{c.w}-{c.d}-{c.l} · {c.gf}:{c.ga} · {c.clean_sheets} clean sheets{c.possession != null ? ` · ${Math.round(c.possession)}% possession` : ''}</span></li>
              ))}
            </ul>
          </Section>
        </div>
      )}
      {tab === 'transfers' && <Section title="Transfers in and out"><TransfersList rows={d.transfers} showPlayer empty="No transfers recorded for this club yet." /></Section>}
    </div>
  );
}
