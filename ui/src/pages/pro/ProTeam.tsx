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
import { EmptyState, ErrorBox, PlayerAvatar, Section, Select, Skeleton, TabsNav, TeamLogo } from '../../components/primitives';
import { ClubSeasonDetail, GroundCard, type ClubSeasonRow, type Ground } from '../../components/pro/ClubSeason';
import { PointsLine, ResultStrip } from '../../components/pro/Charts';
import { Credit, TeamAdvancedCards, type AdvTeamSeason, type SourceCredit } from '../../components/pro/Advanced';
import { ProHero, StatTile } from '../../components/pro/Hero';
import { ProMoved } from './ProMoved';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface SquadRow { player: { id: number; name: string; slug: string; photo: string | null; position: string | null; nationality: string | null; birth_date: string | null }; number: number | null; listed: boolean; apps: number; starts: number; minutes: number; goals: number; assists: number; yellow: number; red: number; saves: number | null; conceded: number | null; clean_sheets: number | null; rating: number | null }
interface Split { played: number; w: number; d: number; l: number; gf: number; ga: number }
interface TeamData {
  team: ProTeamRef & { founded: number | null; national: boolean; venue: Ground | null };
  season: number | null; seasons: number[];
  competitions: { league: (ProLeagueRef & { priority: number }) | null; played: number; w: number; d: number; l: number; gf: number; ga: number; clean_sheets: number; possession: number | null; shots?: number | null; shots_on?: number | null; corners?: number | null; fouls?: number | null; yellow?: number | null; red?: number | null }[];
  standings: { league: ProLeagueRef | null; group: string; rank: number | null; points: number | null; played: number | null; form: string | null }[];
  squad: SquadRow[];
  coaches: { id: number; name: string; photo: string | null; nationality: string | null; birth_date: string | null; start: string | null; end: string | null; current: boolean; trophies?: number }[];
  transfers: TransferLine[];
  injuries: { player: { name: string; slug: string } | null; type: string | null; reason: string | null; date: string | null }[];
  goals_by_period: { period: string; for: number; against: number }[];
  goals_by_period_source?: 'provider' | 'events';
  season_detail?: ClubSeasonRow[];
  advanced?: { credit: SourceCredit; competitions: AdvTeamSeason[] } | null;
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
  // The season across competitions: averages over the matches that have each number (shots and the rest need detail).
  const sum = total.p > 0 ? (() => {
    const withStats = d.competitions.filter((c) => c.shots != null);
    const add = (k: 'shots' | 'shots_on' | 'corners' | 'yellow' | 'red') => (withStats.length ? withStats.reduce((n, c) => n + (c[k] ?? 0), 0) : null);
    const possRows = d.competitions.filter((c) => c.possession != null && c.played);
    return { ...total, cs: d.competitions.reduce((n, c) => n + c.clean_sheets, 0), statP: Math.max(1, withStats.reduce((n, c) => n + c.played, 0)),
      shots: add('shots'), shotsOn: add('shots_on'), corners: add('corners'), yellow: add('yellow'), red: add('red'),
      poss: possRows.length ? possRows.reduce((n, c) => n + c.possession! * c.played, 0) / possRows.reduce((n, c) => n + c.played, 0) : null };
  })() : null;
  // Goals by period from our own match events only once they cover most of the season's goals (lower leagues have few).
  const periodGoals = d.goals_by_period.reduce((n, r) => n + r.for + r.against, 0);
  const periodShown = d.goals_by_period_source === 'provider' || (periodGoals > 0 && periodGoals >= 0.6 * (total.gf + total.ga));
  // Results oldest first, from this club's side.
  const formItems = [...d.results].filter((m) => m.status === 'final').reverse().map((m) => {
    const home = m.home.id === t.id; const us = (home ? m.home.score : m.away.score) ?? 0, them = (home ? m.away.score : m.home.score) ?? 0;
    const opp = home ? m.away : m.home;
    return { result: (us > them ? 'W' : us < them ? 'L' : 'D') as 'W' | 'D' | 'L', title: `${fmt.date(m.kickoff)} ${home ? 'v' : '@'} ${opp.name} ${us}-${them}`, href: proPath.match(m.slug) };
  });
  const best = (pick: (r: SquadRow) => number | null, min = 0) => [...d.squad].filter((r) => (pick(r) ?? 0) > min).sort((a, b) => (pick(b) ?? 0) - (pick(a) ?? 0))[0] ?? null;
  const performers = ([
    ['Top scorer', best((r) => r.goals), (r: SquadRow) => `${r.goals} goals`],
    ['Most assists', best((r) => r.assists), (r: SquadRow) => `${r.assists} assists`],
    ['Most minutes', best((r) => r.minutes), (r: SquadRow) => `${fmt.num(r.minutes)} min`],
    ['Best rated', best((r) => (r.minutes >= 450 ? r.rating : null)), (r: SquadRow) => (r.rating != null ? r.rating.toFixed(2) : '–')],
    ['Most cards', best((r) => r.yellow + r.red * 2), (r: SquadRow) => `${r.yellow} yellow${r.red ? `, ${r.red} red` : ''}`],
  ] as [string, SquadRow | null, (r: SquadRow) => string][]).filter(([, row]) => row).map(([label, row, value]) => ({ label, row: row!, value: value(row!) }));
  const ins = d.transfers.filter((x) => x.direction === 'in'), outs = d.transfers.filter((x) => x.direction === 'out');
  const splitRow = (label: string, s: Split) => <tr className="border-t border-field-700"><th scope="row" className="td text-left font-normal text-chalk-300">{label}</th><td className="td text-right tnum">{s.played}</td><td className="td text-right tnum">{s.w}-{s.d}-{s.l}</td><td className="td text-right tnum">{s.gf}:{s.ga}</td><td className="td text-right tnum">{s.played ? ((s.w * 3 + s.d) / s.played).toFixed(2) : '–'}</td></tr>;
  return (
    <div className="space-y-5">
      <ProHero image={<span className="grid h-24 w-24 place-items-center rounded-xl bg-white/95 p-2 shadow-lg"><TeamLogo src={t.logo} name={t.name} size={76} chip={false} /></span>} title={t.name}
        line={<>{t.country && <span className="inline-flex items-center gap-1.5"><Flag country={t.country} />{t.country}</span>}{coach && <span>Coach {coach.name}</span>}</>}
        chips={[t.founded ? `Founded ${t.founded}` : null, t.venue ? `${t.venue.name}${t.venue.capacity ? ` · ${fmt.num(t.venue.capacity)}` : ''}` : null, t.venue?.surface ? cap(t.venue.surface) : null]}
        actions={d.seasons.length > 1 && <Select aria-label="Season" className="h-9 text-sm" value={String(d.season ?? '')} onChange={(v) => patch({ season: v === String(d.seasons[0]) ? null : v })} options={d.seasons.map((s) => ({ value: String(s), label: String(s) }))} />}>
        {d.season != null && total.p > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label={`${d.season} record`} value={`${total.w}-${total.d}-${total.l}`} sub="won, drawn, lost" />
            <StatTile label="Goals" value={`${total.gf}:${total.ga}`} sub={`${total.p} matches · ${(total.gf / total.p).toFixed(2)} a match`} />
            {d.standings.slice(0, 2).map((s) => s.league && <StatTile key={`${s.league.id}-${s.group}`} accent label={s.group || s.league.name} value={s.rank ? fmt.ordinal(s.rank) : '–'} sub={<span className="inline-flex items-center gap-2">{s.points ?? 0} pts <ProForm form={s.form} /></span>} />)}
          </div>
        )}
      </ProHero>
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
        <div className="space-y-5">
          {sum && (
            <div className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${sum.shots != null || sum.poss != null ? 'lg:grid-cols-8' : ''}`}>
              <StatTile label="Matches" value={sum.p} sub={`${sum.w}-${sum.d}-${sum.l}`} />
              <StatTile label="Goals for" value={(sum.gf / sum.p).toFixed(2)} sub={`a match · ${sum.gf} in all`} accent />
              <StatTile label="Goals against" value={(sum.ga / sum.p).toFixed(2)} sub={`a match · ${sum.ga} in all`} />
              <StatTile label="Clean sheets" value={sum.cs} sub={`${Math.round((sum.cs / sum.p) * 100)}% of matches`} />
              {sum.shots != null && <StatTile label="Shots" value={sum.shots != null ? (sum.shots / sum.statP).toFixed(1) : '–'} sub={sum.shotsOn != null ? `a match · ${(sum.shotsOn / sum.statP).toFixed(1)} on target` : 'from match detail'} />}
              {sum.poss != null && <StatTile label="Possession" value={sum.poss != null ? `${Math.round(sum.poss)}%` : '–'} sub="average" />}
              {sum.corners != null && <StatTile label="Corners" value={sum.corners != null ? (sum.corners / sum.statP).toFixed(1) : '–'} sub="a match" />}
              {sum.yellow != null && <StatTile label="Cards" value={sum.yellow != null ? `${sum.yellow} / ${sum.red ?? 0}` : '–'} sub="yellow / red" />}
            </div>
          )}
          {formItems.length > 0 && (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <ResultStrip items={formItems.slice(-15)} caption={`Last ${Math.min(15, formItems.length)} results`} />
              <PointsLine results={formItems.map((f) => f.result)} caption={`Points over the ${d.season} season, every competition`} />
            </div>
          )}
          {performers.length > 0 && (
            <Section title="Top performers">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {performers.map((p) => (
                  <Link key={p.label} to={proPath.player(p.row.player.slug)} className="group flex items-center gap-2.5 rounded-lg border border-field-700 bg-field-900/60 p-2.5 hover:border-pitch-400/50">
                    <PlayerAvatar src={p.row.player.photo} name={p.row.player.name} size={40} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-chalk-100 group-hover:text-pitch-300">{p.row.player.name}</span>
                      <span className="block text-2xs uppercase tracking-wider text-chalk-500">{p.label}</span>
                      <span className="display block text-lg tnum text-chalk-100">{p.value}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Section>
          )}
          {d.advanced && d.advanced.competitions.length > 0 && <Section title={`${d.season} advanced`}><TeamAdvancedCards competitions={d.advanced.competitions} /><Credit credit={d.advanced.credit} /></Section>}
          {(d.season_detail?.length ?? 0) > 0 && <Section title={`${d.season} in detail`}><ClubSeasonDetail rows={d.season_detail!} /></Section>}
          <div className="grid gap-5 lg:grid-cols-2">
            {periodShown ? <Section title="Goals by period"><GoalsByPeriod rows={d.goals_by_period} /></Section>
              : <Section title="Goals by period"><p className="text-sm text-chalk-400">Shows once goal times are in for most of the season's matches.</p></Section>}
            <Section title="Home and away">
              <div className="frame overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Home and away record</caption>
                <thead><tr className="text-2xs text-chalk-500"><th className="th text-left" scope="col"></th><th className="th text-right" scope="col">P</th><th className="th text-right" scope="col">W-D-L</th><th className="th text-right" scope="col">Goals</th><th className="th text-right" scope="col">Pts/game</th></tr></thead>
                <tbody>{splitRow('Home', d.splits.home)}{splitRow('Away', d.splits.away)}</tbody></table></div>
            </Section>
          </div>
          <Section title="By competition">
            <ul className="frame divide-y divide-field-700 text-sm">
              {d.competitions.map((c) => c.league && (
                <li key={c.league.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2"><Link to={proPath.league(c.league.slug, d.season)} className="min-w-0 flex-1 truncate font-medium text-chalk-100 hover:text-pitch-300">{c.league.name}</Link>
                  <span className="text-xs tnum text-chalk-300">{c.w}-{c.d}-{c.l} · {c.gf}:{c.ga} · {c.clean_sheets} clean sheets{c.possession != null ? ` · ${Math.round(c.possession)}% possession` : ''}{c.shots != null && c.played ? ` · ${(c.shots / c.played).toFixed(1)} shots a match` : ''}</span></li>
              ))}
            </ul>
          </Section>
          {!sum && <EmptyState title="No season numbers yet" body="They arrive with this club's results; shots, possession and cards with match detail." />}
        </div>
      )}
      {tab === 'transfers' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title={`In (${ins.length})`}><TransfersList rows={ins} showPlayer empty="No arrivals recorded yet." /></Section>
          <Section title={`Out (${outs.length})`}><TransfersList rows={outs} showPlayer empty="No departures recorded yet." /></Section>
        </div>
      )}
    </div>
  );
}
