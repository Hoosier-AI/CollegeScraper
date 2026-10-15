import { useState } from 'react';
import { PointsLine, ResultStrip } from '../components/pro/Charts';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, fmt, useAdmin } from '../lib/api';
import { useFilters, useHref } from '../lib/filters';
import { useUrlState } from '../lib/urlState';
import { useEntityId } from '../lib/entity';
import { PlayerAvatar, Badge, EmptyState, ErrorBox, Figure, Section, Skeleton, TabsNav, TeamLogo, PageWithRail } from '../components/primitives';
import { RunProgress } from '../components/RunProgress';
import { TeamMasthead, sideOf } from './team/Masthead';
import { TeamRail } from './team/TeamRail';
import { RosterTable } from './team/RosterTable';
import { GamesList } from './team/GamesList';
import { NewsFeed } from '../components/news/News';
import { GoalsByPeriod } from '../components/pro/People';
import { Crumbs } from '../components/shell';
import { genderLabel } from '../lib/filters';

// The team tab order every area uses: Roster, Matches, Stats, News, then the college-only tabs.
type Tab = 'roster' | 'matches' | 'stats' | 'news' | 'coaches' | 'honors' | 'pros';
const TABS: Tab[] = ['roster', 'matches', 'stats', 'news', 'coaches', 'honors', 'pros'];
// Old tab ids (before 2026-10-14) still open the right tab.
const OLD_TAB: Record<string, Tab> = { games: 'matches', season: 'stats' };

export default function Team() {
  // /teams/<uuid> (links inside the app) or /teams/<school>/<men|women> (the address search engines see).
  const { id: param = '', school, gender } = useParams();
  const entity = useEntityId('team', school ? `${school}/${gender}` : param);
  const id = entity.id;
  const { pathname } = useLocation();
  const f = useFilters();
  const admin = useAdmin();
  const href = useHref();
  const qc = useQueryClient();
  const [rawTab] = useUrlState('tab', 'roster', { allow: [...TABS, ...Object.keys(OLD_TAB)] });
  const tab = OLD_TAB[rawTab] ?? (rawTab as Tab);
  const [runId, setRunId] = useState<string | null>(null);
  const team = useQuery({ queryKey: ['program', id, f.season], queryFn: () => api<any>(`/api/programs/${id}${qs({ season: f.season })}`), enabled: !!id });
  const roster = useQuery({ queryKey: ['roster', id, f.season], queryFn: () => api<any[]>(`/api/programs/${id}/roster${qs({ season: f.season })}`), enabled: !!id });
  const games = useQuery({ queryKey: ['pgames', id, f.season], queryFn: () => api<any[]>(`/api/programs/${id}/games${qs({ season: f.season })}`), enabled: !!id });
  const sync = useMutation({ mutationFn: (force: boolean) => api<{ id: string }>(`/api/programs/${id}/sync`, { method: 'POST', body: JSON.stringify({ season: f.season, force }) }), onSuccess: (r) => setRunId(r.id) });
  // Plaibook Stats Pro: players from this program who play professionally (College to Pro links).
  const prog = team.data?.program;
  const alumni = useQuery({ queryKey: ['pro-alumni', prog?.school_seo, prog?.gender], queryFn: () => api<{ players: any[] }>(`/api/pro/college/${prog!.school_seo}/${prog!.gender}`), enabled: !!prog?.school_seo, staleTime: 600_000 });
  const refreshAll = () => { qc.invalidateQueries({ queryKey: ['program', id] }); qc.invalidateQueries({ queryKey: ['roster', id] }); qc.invalidateQueries({ queryKey: ['pgames', id] }); };
  if (entity.missing) return <EmptyState title="No such team" body="The link may be out of date." action={<Link className="btn-ghost btn-sm" to={href('/teams')}>Browse teams</Link>} />;
  if (entity.error) return <ErrorBox error={entity.error} />;
  if (team.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-40" /><Skeleton className="h-10 w-96 max-w-full" /><Skeleton className="h-64" /></div>;
  if (team.error) return <ErrorBox error={team.error} retry={() => team.refetch()} />;
  if (!team.data?.program) return <EmptyState title="No such team" body="The link may be out of date." action={<Link className="btn-ghost btn-sm" to={href('/teams')}>Browse teams</Link>} />;
  const t = team.data; const p = t.program; const s = t.teamStats;
  const honors = (roster.data ?? []).flatMap((r: any) => r.honors.map((h: string) => ({ player: r.player?.display_name, id: r.player?.id, text: h })));
  const tabHref = (x: Tab) => href(pathname, { tab: x === 'roster' ? null : x });
  // Finals in date order (forfeits left out, as in the standings' points), for the results strip and points line.
  const formItems = (games.data ?? []).filter((g: any) => g.status === 'final' && !g.forfeit).sort((a: any, b: any) => String(a.game_date).localeCompare(String(b.game_date)))
    .flatMap((g: any) => { const x = sideOf(g, id); return x.result ? [{ result: x.result, title: `${fmt.date(g.game_date)}: ${x.home ? 'vs' : 'at'} ${x.opp ?? '?'}, ${x.us}-${x.them}`, href: href(`/matches/${g.id}`) }] : []; });
  const tabs = [
    { id: 'roster' as Tab, label: 'Roster', count: roster.data?.length },
    { id: 'matches' as Tab, label: 'Matches', count: games.data?.length },
    { id: 'stats' as Tab, label: 'Stats' },
    { id: 'news' as Tab, label: 'News' },
    { id: 'coaches' as Tab, label: 'Coaches', count: t.coaches?.length },
    { id: 'honors' as Tab, label: 'Honors', count: honors.length || undefined },
    ...(alumni.data?.players.length ? [{ id: 'pros' as Tab, label: 'Pro alumni', count: alumni.data.players.length }] : []),
  ];
  return (
    <div className="space-y-5">
      <Crumbs items={[{ label: `${p.name} (${genderLabel(p.gender)})` }]} />
      <TeamMasthead t={t} id={id} season={f.season} games={games.data} />
      {admin && (
        <div className="flex flex-wrap items-center gap-2">
          {runId ? <RunProgress runId={runId} onDone={() => { setRunId(null); refreshAll(); }} /> : <>
            <button className="btn-primary btn-sm" onClick={() => sync.mutate(false)} disabled={sync.isPending}>Sync now</button>
            <button className="btn-ghost btn-sm" onClick={() => sync.mutate(true)} disabled={sync.isPending} title="Ignore the fetch cache and re-download everything">Force re-sync</button>
          </>}
          {t.runs?.[0] && !runId && <span className="text-xs text-chalk-500">last run: {t.runs[0].job} {t.runs[0].status} {fmt.ago(t.runs[0].finished_at ?? t.runs[0].started_at)}</span>}
        </div>
      )}
      <TabsNav label="Team sections" tabs={tabs} value={tab as Tab} hrefFor={tabHref} />
      <PageWithRail label={`${p.name} at a glance`} rail={<TeamRail t={t} id={id} season={f.season} roster={roster.data} href={href} news={tab !== 'news'} />}>
      {tab === 'roster' && <RosterTable rows={roster.data ?? []} loading={roster.isPending} playerHref={(r) => `/players/${r.player?.id}`} />}
      {tab === 'matches' && <>
        {formItems.length >= 3 && (
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            <ResultStrip items={formItems.slice(-15)} caption={`Last ${Math.min(15, formItems.length)} results`} />
            <PointsLine results={formItems.map((x) => x.result)} caption={`Points over the ${f.season} season (3 a win, 1 a tie)`} />
          </div>
        )}
        <GamesList games={games.data ?? []} id={id} loading={games.isPending} href={href} />
      </>}
      {tab === 'stats' && <SeasonProfile t={t} id={id} season={f.season} href={href} admin={admin} />}
      {tab === 'news' && <NewsFeed q={{ program: id }} hide={`program:${id}`} empty="No news for this team yet" />}
      {tab === 'coaches' && (t.coaches?.length
        ? <ul className="frame divide-y divide-field-700">{t.coaches.map((c: any) => <li key={c.college_coaches?.id}><Link to={`/coaches/${c.college_coaches?.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-field-800"><PlayerAvatar src={c.college_coaches?.headshot_url} name={c.college_coaches?.name} size={36} /><div><div className="font-medium text-chalk-100">{c.college_coaches?.name}</div><div className="text-xs text-chalk-400">{c.title}{c.is_head && <Badge tone="teal" className="ml-2">Head coach</Badge>}</div></div></Link></li>)}</ul>
        : <EmptyState title="No coaches listed" body="The staff page has not been collected for this season." />)}
      {tab === 'pros' && (alumni.data?.players.length
        ? <ul className="frame divide-y divide-field-700">{alumni.data.players.map((a: any) => <li key={a.id}><Link to={`/pro/players/${a.slug}`} className="flex items-center gap-3 px-3 py-2 hover:bg-field-800"><PlayerAvatar src={a.photo} name={a.name} size={32} /><div className="min-w-0 flex-1"><div className="truncate font-medium text-chalk-100">{a.name}</div><div className="text-xs text-chalk-400">{[a.position, a.college_years?.length ? `here ${a.college_years.join('–')}` : null].filter(Boolean).join(' · ')}</div></div>{a.team && <span className="flex items-center gap-1.5 text-xs text-chalk-300"><TeamLogo src={a.team.logo} name={a.team.name} size={18} />{a.team.name}</span>}</Link></li>)}</ul>
        : <EmptyState title="No pro alumni found yet" body="Links come from public career records and our rosters, matched by name and birth date." action={<Link className="btn-ghost btn-sm" to="/pro/college">College to Pro</Link>} />)}
      {tab === 'honors' && (honors.length
        ? <ul className="frame divide-y divide-field-700 text-sm">{honors.map((h: any, i: number) => <li key={i} className="flex flex-wrap gap-x-2 px-3 py-2"><Link className="font-medium text-chalk-100 hover:text-pitch-300" to={`/players/${h.id}`}>{h.player}</Link><span className="text-chalk-300">{h.text}</span></li>)}</ul>
        : <EmptyState title="No honors yet" body="Awards are read from player bios as they are published." />)}
      </PageWithRail>
    </div>
  );
}

/** The long tail of team numbers, plus the conference table and poll history, in one calm place. */
function SeasonProfile({ t, id, season, href, admin }: { t: any; id: string; season: number; href: (p: string, o?: Record<string, string | number | null | undefined>) => string; admin: boolean }) {
  const s = t.teamStats;
  // Goals by 15-minute period from the play-by-play, once it covers most of the season's finished games.
  const periods = useQuery({ queryKey: ['periods', id, season], queryFn: () => api<{ games: number; timed: number; rows: { period: string; for: number; against: number }[] }>(`/api/programs/${id}/periods${qs({ season })}`), staleTime: 300_000 });
  const pd = periods.data;
  const periodsShown = !!pd && pd.games > 0 && pd.timed >= 0.6 * pd.games;
  const row = (label: string, value: string, note?: string) => <tr key={label}><th scope="row" className="td !whitespace-normal text-left font-normal text-chalk-400">{label}</th><td className="td num text-chalk-100">{value}</td><td className="td !whitespace-normal text-xs text-chalk-500">{note ?? ''}</td></tr>;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Section title="Season in numbers">
        {s ? (
          <table className="frame w-full table-fixed border-separate border-spacing-0 text-sm"><caption className="sr-only">Season totals</caption><colgroup><col className="w-[38%]" /><col className="w-[22%]" /><col /></colgroup><tbody>
            {row('Home', fmt.rec(s.home_w, s.home_l, s.home_t), `${s.gf_home ?? '–'} for, ${s.ga_home ?? '–'} against`)}
            {row('Away', fmt.rec(s.away_w, s.away_l, s.away_t), `${s.gf_away ?? '–'} for, ${s.ga_away ?? '–'} against`)}
            {row('Neutral', fmt.rec(s.neutral_w, s.neutral_l, s.neutral_t))}
            {row('Against ranked teams', fmt.rec(s.vs_ranked_w, s.vs_ranked_l, s.vs_ranked_t))}
            {row('Last five', `${s.last5_gf ?? '–'}–${s.last5_ga ?? '–'}`, 'goals for–against')}
            {row('Goals by half', `${s.gf_1h ?? '–'} / ${s.gf_2h ?? '–'}`, `conceded ${s.ga_1h ?? '–'} / ${s.ga_2h ?? '–'}`)}
            {row('Shots', `${s.shots ?? '–'}`, `${s.sog ?? '–'} on target, ${fmt.pct(s.sog_pct)}`)}
            {row('Shots per goal', fmt.num(s.shots_per_goal, 1))}
            {row('Penalties', `${s.pk_goals ?? 0} of ${s.pk_att ?? 0}`)}
            {row('Corners', `${s.corners ?? '–'}`, `${fmt.num(s.corners_pg, 1)} a game`)}
            {row('Fouls', `${s.fouls ?? '–'}`, `${s.offsides ?? '–'} offsides`)}
            {row('Attendance', fmt.num(s.avg_attendance), 'average at home')}
            {row('Attack percentile', fmt.pctile(s.div_pct_gf_pg), 'goals a game, within the division')}
            {row('Defence percentile', fmt.pctile(s.div_pct_ga_pg), 'goals against a game, within the division')}
            {row('Conference rank', s.conf_rank_ppg ? fmt.ordinal(s.conf_rank_ppg) : '–', 'by points a game')}
          </tbody></table>
        ) : <EmptyState title="No season totals yet" />}
      </Section>
      <Section title={`Conference table${t.standing?.source === 'conference' ? '' : t.standing ? ' (computed)' : ''}`} right={t.season?.conference_id ? <Link className="text-xs text-pitch-400 hover:text-pitch-300" to={href(`/conferences/${t.season.conference_id}`)}>Full conference</Link> : undefined}>
        {t.conferenceTable?.length ? (
          <table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Conference table</caption>
            <thead><tr><th scope="col" className="th text-right">#</th><th scope="col" className="th">Team</th><th scope="col" className="th text-right">Conf</th><th scope="col" className="th text-right">Pts</th></tr></thead>
            <tbody>{t.conferenceTable.map((r: any) => <tr key={r.program_id} className={r.program_id === id ? '[&>td]:bg-pitch-400/10' : ''}><td className="td num text-chalk-500">{r.rank}</td><td className="td"><Link className="hover:text-pitch-300" to={href(`/teams/${r.program_id}`)}>{r.college_programs?.name}</Link></td><td className="td num">{fmt.rec(r.conf_w, r.conf_l, r.conf_t)}</td><td className="td num">{r.conf_pts ?? ''}</td></tr>)}</tbody>
          </table>
        ) : <EmptyState title="No conference table yet" body={admin ? 'Run compute-standings.' : undefined} />}
      </Section>
      <div className="space-y-6">
        <Section title="Goals by period">
          {periodsShown ? <><GoalsByPeriod rows={pd!.rows} /><p className="mt-1 text-xs text-chalk-500">Scored and conceded by 15-minute period, from the play-by-play of {pd!.timed} of {pd!.games} matches.</p></>
            : <p className="text-sm text-chalk-500">{periods.isPending ? 'Loading…' : 'Shows once goal times are in for most of the season\'s matches.'}</p>}
        </Section>
        <Section title="Coaches' poll">
          {t.uscHistory?.length ? (
            <table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Poll history</caption>
              <thead><tr><th scope="col" className="th">Poll</th><th scope="col" className="th text-right">Rank</th><th scope="col" className="th text-right">Prev</th><th scope="col" className="th text-right">Points</th><th scope="col" className="th">Record</th></tr></thead>
              <tbody>{t.uscHistory.map((r: any) => <tr key={r.week_of}><td className="td">{r.label} <span className="text-xs text-chalk-500">{fmt.day(r.week_of)}</span></td><td className="td num">{r.rank}</td><td className="td num">{r.previous_rank ?? 'NR'}</td><td className="td num">{r.value}</td><td className="td">{r.record}</td></tr>)}</tbody>
            </table>
          ) : <p className="text-sm text-chalk-500">Not ranked this season.</p>}
        </Section>
        <Section title="National stat ranks">
          {t.categories?.length ? (
            <details className="group frame" open>
              <summary className="sr-only">Team categories</summary>
              <table className="w-full table-fixed border-separate border-spacing-0 text-sm"><caption className="sr-only">National rank by team category</caption><colgroup><col className="w-14" /><col /><col className="w-16" /></colgroup>
                <tbody>{t.categories.slice(0, 15).map((r: any) => <tr key={r.category}><td className="td num font-medium text-chalk-100">{fmt.ordinal(r.rank)}</td><td className="td !whitespace-normal text-chalk-300">{r.category}</td><td className="td num text-chalk-500">{fmt.num(r.value, Number(r.value) % 1 ? 2 : 0)}</td></tr>)}</tbody>
              </table>
              {t.categories.length > 15 && <p className="px-3 py-2 text-xs text-chalk-500">and {t.categories.length - 15} more categories</p>}
            </details>
          ) : <p className="text-sm text-chalk-500">No national category ranks yet.</p>}
        </Section>
      </div>
    </div>
  );
}
