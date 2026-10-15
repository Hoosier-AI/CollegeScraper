// Pro referees (/pro/referees): every referee with five or more matches in the chosen set (this season across every
// competition by default, one competition, or every season we hold), with cards, penalties, fouls, VAR checks and
// home wins a match, sortable, against the set's average. From API-Football's referee on each match.
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Flag as FlagIcon } from 'lucide-react';
import { api, fmt, qs } from '../../lib/api';
import { useSortParam, useUrlNumber, useUrlState, useUrlText } from '../../lib/urlState';
import { useProGender } from '../../lib/proGender';
import type { ProLeagueRef } from '../../lib/pro';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState, ErrorBox, Field, PageHeader, Pager, SegmentedControl, Select, TeamLogo } from '../../components/primitives';
import { REF_STATS, refValue, type RefNumbers } from '../../components/Referee';

type Row = RefNumbers & { slug: string; name: string; country: string | null; last_at: string | null; league: ProLeagueRef | null; matches: number };
interface Page { total: number; average: RefNumbers | null; rows: Row[]; leagues: { league: ProLeagueRef; matches: number }[]; league_id: number | null }
const PAGE = 50;

export default function ProReferees() {
  const [gender] = useProGender();
  const [league, setLeague] = useUrlState('league');
  const [period, setPeriod] = useUrlState('period', 'season', { allow: ['season', 'all'] });
  const [sort, setSort] = useSortParam('sort', { key: 'matches', dir: 'desc' });
  const [page, setPage] = useUrlNumber('page', 1, { min: 1 });
  const search = useUrlText('q');
  // US first: the top US competition unless another (or every one) is picked; '' is that default, 'all' every one.
  const leagueParam = league || 'default';
  // One competition this season has few matches per referee early on: two is enough to list them there.
  const min = league !== 'all' && period === 'season' ? 2 : 5;
  const q = useQuery({
    queryKey: ['pro-referees', gender, leagueParam, period, sort?.key, search.value, page],
    queryFn: () => api<Page>(`/api/pro/referees${qs({ gender, league: leagueParam, period: period === 'all' ? 'all' : '', q: search.value, min, sort: sort?.key ?? 'matches', limit: PAGE, offset: (page - 1) * PAGE })}`),
    placeholderData: keepPreviousData,
  });
  const shownLeague = q.data?.league_id != null ? String(q.data.league_id) : 'all';
  const leagueName = q.data?.leagues.find((l) => String(l.league.id) === shownLeague)?.league.name;
  const avg = q.data?.average;
  const cols: Column<Row>[] = [
    { key: 'name', label: 'Referee', primary: true, sortable: true, render: (r) => (
      <Link to={`/pro/referees/${r.slug}`} className="flex min-w-0 items-center gap-2 hover:text-pitch-300">
        {r.league?.logo ? <TeamLogo src={r.league.logo} name={r.league.name} size={20} chip={false} /> : <FlagIcon size={16} aria-hidden className="text-chalk-500" />}
        <span className="min-w-0"><span className="block truncate font-medium text-chalk-100">{r.name}</span><span className="block truncate text-2xs text-chalk-500">{[r.country, r.league?.name].filter(Boolean).join(', ')}</span></span>
      </Link>
    ) },
    { key: 'matches', label: 'Matches', num: true, sortable: true },
    ...REF_STATS.filter((s) => s.key !== 'yellow_pg').map((s): Column<Row> => ({
      key: s.key as string, label: s.short, title: s.label, num: true, sortable: true,
      priority: s.key === 'cards_pg' || s.key === 'pens_pg' ? 1 : s.key === 'goals_pg' ? 3 : 2,
      render: (r) => refValue(r[s.key] as number | null, s),
    })),
  ];
  const pager = q.data && q.data.total > PAGE ? <Pager page={page - 1} pageSize={PAGE} total={q.data.total} onPage={(p) => setPage(p + 1)} busy={q.isFetching} noun="referees" /> : null;
  return (
    <div className="space-y-4">
      <PageHeader title="Referees" meta={`${gender === 'w' ? "Women's" : "Men's"} referees with ${min}+ matches ${period === 'all' ? 'in every season we hold' : 'this season'}${leagueName ? ` in ${leagueName}` : ''}: cards, penalties, fouls and home wins a match.`}>
        <Field label="Competition">{(id) => <Select id={id} value={shownLeague} onChange={(v) => { setLeague(v); setPage(1); }} className="max-w-[260px]" options={[{ value: 'all', label: 'Every competition' }, ...(q.data?.leagues ?? []).map((l) => ({ value: String(l.league.id), label: `${l.league.name}${l.league.country && l.league.country !== 'World' ? ` (${l.league.country})` : ''}` }))]} />}</Field>
        <Field label="Seasons">{() => <SegmentedControl label="Seasons" size="sm" value={period} onChange={(v) => { setPeriod(v); setPage(1); }} options={[{ value: 'season', label: 'This season' }, { value: 'all', label: 'All' }]} />}</Field>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-44" placeholder="Referee" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      {avg && played(avg) > 0 && (
        <p className="text-xs text-chalk-400">
          Average over these matches: <span className="text-chalk-200 tnum">{refValue(avg.cards_pg, { d: 2 })}</span> cards, <span className="text-chalk-200 tnum">{refValue(avg.pens_pg, { d: 2 })}</span> penalties
          {avg.fouls_pg != null && <>, <span className="text-chalk-200 tnum">{refValue(avg.fouls_pg, { d: 1 })}</span> fouls</>} a match; the home side wins <span className="text-chalk-200 tnum">{refValue(avg.home_pct, { d: 0, pct: true })}</span>.
        </p>
      )}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && !q.data.rows.length && !q.isFetching && <EmptyState title={search.value ? `No referee matches “${search.value}”` : 'No referees here yet'} body="Referees appear once they have enough finished matches in our records. Smaller competitions often list no referee at all." action={search.value ? <button className="btn-ghost btn-sm" onClick={search.clear}>Clear search</button> : undefined} />}
      {(q.isPending || (q.data && q.data.rows.length > 0)) && (
        <div className={q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}>
          <DataTable rows={q.data?.rows ?? []} columns={cols} rowKey={(r) => r.slug} caption="Referees" rowHref={(r) => `/pro/referees/${r.slug}`} mode="server" sort={sort} onSort={(s) => { setSort(s); setPage(1); }} loading={q.isPending} />
        </div>
      )}
      {pager}
      <p className="text-xs text-chalk-500">Per match over the matches that have the figure: cards and penalties need the match's events, fouls both teams' stats. Penalties count those given in play (kicks in a shootout are left out).</p>
    </div>
  );
}

const played = (n: RefNumbers) => n.matches ?? n.games ?? 0;
