// One conference: its table, this week's matches, its leading players, members, news and ranked teams. Tabs follow the
// competition order every area uses: Table, Matches, Players, Teams, News, then Rankings.
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api, qs, fmt } from '../../lib/api';
import { useFilters, useHref, genderLabel, divisionLabel } from '../../lib/filters';
import { useUrlState } from '../../lib/urlState';
import { DataTable, type Column } from '../../components/DataTable';
import { Chip, EmptyState, ErrorBox, FormPips, Skeleton, TabsNav, TeamLogo, VerifiedMark, PageWithRail, RailCard, RailRow, HeroStat } from '../../components/primitives';
import { MatchRow, RailMatch } from '../../components/match/MatchRow';
import { StandingsGrid } from './StandingsGrid';
import { longDay } from '../../lib/dates';
import { NewsFeed, RailNews } from '../../components/news/News';
import { Crumbs } from '../../components/shell';

type Tab = 'table' | 'matches' | 'players' | 'teams' | 'news' | 'rankings';
// Old tab ids (before 2026-10-14) still open the right tab.
const OLD_TAB: Record<string, Tab> = { leaders: 'players', polls: 'rankings' };

export function ConferenceDetail({ id }: { id: string }) {
  const f = useFilters();
  const href = useHref();
  const { pathname } = useLocation();
  const [rawTab] = useUrlState('tab', 'table', { allow: ['table', 'matches', 'players', 'teams', 'news', 'rankings', 'leaders', 'polls'] });
  const tab = OLD_TAB[rawTab] ?? (rawTab as Tab);
  const q = useQuery({ queryKey: ['conference', id, f.season, f.gender], queryFn: () => api<any>(`/api/conferences/${id}${qs({ season: f.season, gender: f.gender })}`) });
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (!q.data?.conference) return <EmptyState title="No such conference" action={<Link className="btn-ghost btn-sm" to={href('/conferences')}>All conferences</Link>} />;
  const d = q.data; const c = d.conference;
  const official = d.standings.rows.find((r: any) => r.source === 'conference');
  const best = [...d.members].filter((m: any) => m.stats && (m.stats.w + m.stats.l + m.stats.t) > 0).sort((a: any, b: any) => (b.stats.ppg ?? 0) - (a.stats.ppg ?? 0))[0] ?? null;
  const byDate = new Map<string, any[]>(); for (const g of d.this_week.games) byDate.set(g.game_date, [...(byDate.get(g.game_date) ?? []), g]);
  const memberCols: Column<any>[] = [
    { key: 'name', label: 'Team', primary: true, render: (m) => <span className="flex items-center gap-2"><TeamLogo src={m.logo} seo={m.seo} name={m.name} size={22} />{m.name}{m.rank && <span className="text-2xs text-note">No. {m.rank}</span>}</span> },
    { key: 'record', label: 'W-L-T', value: (m) => m.stats?.w ?? null, render: (m) => <span className="inline-flex items-center gap-2 tnum">{m.stats ? fmt.rec(m.stats.w, m.stats.l, m.stats.t) : '–'}{m.official && m.stats && <VerifiedMark compact state={fmt.rec(m.official.w, m.official.l, m.official.t) === fmt.rec(m.stats.w, m.stats.l, m.stats.t) ? 'ok' : (m.official.w <= m.stats.w && m.official.l <= m.stats.l && m.official.t <= m.stats.t ? 'lag' : 'mismatch')} />}</span> },
    { key: 'conf', label: 'Conf', value: (m) => m.stats?.conf_w ?? null, render: (m) => m.stats ? fmt.rec(m.stats.conf_w, m.stats.conf_l, m.stats.conf_t) : '–' },
    { key: 'form', label: 'Form', sortable: false, render: (m) => <FormPips form={m.stats?.form?.last5} size="sm" /> },
    { key: 'gd', label: 'GD', num: true, value: (m) => m.stats?.gd ?? null, priority: 2 },
    { key: 'ppg', label: 'PPG', num: true, decimals: 2, value: (m) => m.stats?.ppg ?? null, priority: 2 },
  ];
  const tabs = [{ id: 'table' as Tab, label: 'Table' }, { id: 'matches' as Tab, label: 'Matches', count: d.this_week.games.length }, { id: 'players' as Tab, label: 'Players' }, { id: 'teams' as Tab, label: 'Teams', count: d.members.length }, { id: 'news' as Tab, label: 'News' }, { id: 'rankings' as Tab, label: 'Rankings', count: d.ranked.length || undefined }];
  const leaderList = (title: string, rows: any[], line: (r: any) => string) => (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-chalk-100">{title}</h3>
      {rows.length ? <ol className="frame divide-y divide-field-700">{rows.map((r, i) => <li key={r.player_season_id} className="flex items-center gap-2 px-3 py-1.5 text-sm"><span className="w-4 text-right text-xs text-chalk-500 tnum">{i + 1}</span><Link to={href(`/players/${r.player_id}`)} className="min-w-0 flex-1 truncate font-medium text-chalk-100 hover:text-pitch-300">{r.display_name}</Link><span className="truncate text-xs text-chalk-500">{r.program_name}</span><span className="text-xs text-chalk-300 tnum">{line(r)}</span></li>)}</ol> : <p className="text-sm text-chalk-500">Nothing yet.</p>}
    </div>
  );
  return (
    <div className="space-y-5">
      <header className="card flex flex-col gap-5 p-4 sm:p-6 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="min-w-0">
          <Crumbs items={[{ label: divisionLabel(c.division), to: href('/conferences', { division: c.division }) }, { label: c.short_name ?? c.name }]} />
          <h1 className="display mt-1 text-3xl sm:text-4xl">{c.name}</h1>
          <p className="mt-2 text-sm text-chalk-300">{d.members.length} {genderLabel(f.gender)} teams, {divisionLabel(c.division)}, {f.season}{d.ranked.length ? `, ${d.ranked.length} in the coaches poll` : ''}</p>
          <p className="mt-2 flex flex-wrap gap-2 text-xs">
            {official?.source_url && <a className="inline-flex items-center gap-1 text-pitch-400 hover:text-pitch-300" href={official.source_url} target="_blank" rel="noreferrer">Official standings <ExternalLink size={12} aria-hidden /></a>}
            {c.site_host && <a className="inline-flex items-center gap-1 text-chalk-400 hover:text-pitch-300" href={`https://${c.site_host}`} target="_blank" rel="noreferrer">{c.site_host} <ExternalLink size={12} aria-hidden /></a>}
          </p>
  </div>
        <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4 lg:max-w-[40rem] lg:flex-1">
          <HeroStat label="Teams" value={d.members.length} sub={`${genderLabel(f.gender).toLowerCase()}, ${f.season}`} />
          <HeroStat label="In the coaches' poll" value={d.ranked.length} sub={d.ranked[0] ? `best: No. ${d.ranked[0].rank} ${d.ranked[0].name}` : undefined} accent />
          {best && <HeroStat label="Best record" value={fmt.rec(best.stats.w, best.stats.l, best.stats.t)} sub={best.name} />}
          {d.leaders.goals?.[0] && <HeroStat label="Top scorer" value={d.leaders.goals[0].goals} sub={d.leaders.goals[0].display_name} />}
        </dl>
      </header>
      <TabsNav label="Conference sections" tabs={tabs} value={tab as Tab} hrefFor={(x) => href(pathname, { tab: x === 'table' ? null : x })} />
      <PageWithRail label={`${c.name} at a glance`} rail={<>
        {tab !== 'players' && d.leaders.goals?.length > 0 && (
          <RailCard title="Top scorers" to={href(pathname, { tab: 'players' })} toLabel="Players">
            <ol className="space-y-0.5">{d.leaders.goals.slice(0, 5).map((r: any, i: number) => (
              <RailRow key={r.player_season_id} to={href(`/players/${r.player_id}`)} title={r.program_name}
                left={<><span className="w-3 text-2xs text-chalk-500 tnum">{i + 1}</span><span className="truncate">{r.display_name}</span><span className="truncate text-2xs text-chalk-500">{r.program_name}</span></>} right={`${r.goals} G`} />
            ))}</ol>
          </RailCard>
        )}
        {tab !== 'players' && d.leaders.assists?.length > 0 && (
          <RailCard title="Most assists" to={href(pathname, { tab: 'players' })} toLabel="Players">
            <ol className="space-y-0.5">{d.leaders.assists.slice(0, 5).map((r: any, i: number) => (
              <RailRow key={r.player_season_id} to={href(`/players/${r.player_id}`)} title={r.program_name}
                left={<><span className="w-3 text-2xs text-chalk-500 tnum">{i + 1}</span><span className="truncate">{r.display_name}</span><span className="truncate text-2xs text-chalk-500">{r.program_name}</span></>} right={`${r.assists} A`} />
            ))}</ol>
          </RailCard>
        )}
        {tab !== 'matches' && d.this_week.games.length > 0 && (
          <RailCard title="This week" to={href(pathname, { tab: 'matches' })} toLabel="All" flush>
            <div className="divide-y divide-field-700">{d.this_week.games.slice(0, 5).map((g: any) => <RailMatch key={g.id} g={g} href={href(`/matches/${g.id}`)} />)}</div>
          </RailCard>
        )}
        {tab !== 'rankings' && d.ranked.length > 0 && (
          <RailCard title="In the coaches' poll" to={href(pathname, { tab: 'rankings' })} toLabel="Rankings">
            <ol className="space-y-0.5">{d.ranked.slice(0, 6).map((m: any) => (
              <RailRow key={m.id} to={href(`/teams/${m.id}`)} left={<><span className="w-6 text-right font-semibold text-chalk-100 tnum">{m.rank}</span><TeamLogo src={m.logo} seo={m.seo} name={m.name} size={18} /><span className="truncate">{m.name}</span></>} right={m.stats ? fmt.rec(m.stats.w, m.stats.l, m.stats.t) : ''} />
            ))}</ol>
          </RailCard>
        )}
        {tab !== 'news' && <RailNews q={{ conference: id }} hide={`conference:${id}`} to={href(pathname, { tab: 'news' })} />}
      </>}>
        {tab === 'table' && <StandingsGrid conference={id} embedded />}
        {tab === 'matches' && (byDate.size ? [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, games]) => (
        <section key={date} className="space-y-2"><h2 className="text-sm font-semibold text-chalk-100">{longDay(date)}</h2><div className="frame divide-y divide-field-700">{games.map((g: any) => <MatchRow key={g.id} g={g} />)}</div></section>
      )) : <EmptyState title="No matches this week" body="Conference members have nothing scheduled Monday to Sunday." action={<Chip to={href('/matches', { conference: id })}>Browse matches</Chip>} />)}
        {tab === 'teams' && <DataTable rows={d.members} columns={memberCols} rowKey={(m) => m.id} caption={`${c.name} members`} rowHref={(m) => href(`/teams/${m.id}`)} defaultSort={{ key: 'conf', dir: 'desc' }} dense />}
        {tab === 'players' && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {leaderList('Points', d.leaders.points, (r) => `${r.points} pts`)}
          {leaderList('Goals', d.leaders.goals, (r) => `${r.goals} G`)}
          {leaderList('Assists', d.leaders.assists, (r) => `${r.assists} A`)}
          {leaderList('Save percentage (450+ minutes in goal)', d.leaders.save_pct, (r) => fmt.pct(r.save_pct))}
          <p className="text-xs text-chalk-500 md:col-span-2"><Link className="text-pitch-400 hover:text-pitch-300" to={href('/leaders', { conference: id, division: c.division })}>All leaders in the {c.short_name ?? c.name}</Link></p>
        </div>
      )}
        {tab === 'news' && <NewsFeed q={{ conference: id }} hide={`conference:${id}`} empty="No news for this conference yet" />}
        {tab === 'rankings' && (d.ranked.length ? <ol className="frame divide-y divide-field-700">{d.ranked.map((m: any) => <li key={m.id}><Link to={href(`/teams/${m.id}`)} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-field-800"><span className="display w-6 text-right text-lg tnum">{m.rank}</span><TeamLogo src={m.logo} seo={m.seo} name={m.name} size={22} /><span className="flex-1 font-medium text-chalk-100">{m.name}</span><span className="text-xs text-chalk-400 tnum">{m.stats ? fmt.rec(m.stats.w, m.stats.l, m.stats.t) : ''}</span></Link></li>)}</ol> : <EmptyState title="No members in the coaches poll this week" />)}
      </PageWithRail>
    </div>
  );
}
