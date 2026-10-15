// College referees (/referees): the referee each box score names, with five or more games in the season (or every
// season), and cards, fouls, penalty kicks and home wins a game against the set's average. Only Sidearm and Presto
// box scores list officials, so many games have no referee here.
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../lib/api';
import { divisionShort, genderLabel, useFilters } from '../lib/filters';
import { useSortParam, useUrlNumber, useUrlState, useUrlText } from '../lib/urlState';
import { DataTable, type Column } from '../components/DataTable';
import { EmptyState, ErrorBox, Field, PageHeader, Pager, SegmentedControl } from '../components/primitives';
import { REF_STATS, refValue, type RefNumbers } from '../components/Referee';

type Row = RefNumbers & { slug: string; name: string; last_date: string | null; division: string | null; games: number };
interface Page { total: number; referees: number; average: RefNumbers | null; rows: Row[] }
const PAGE = 50;
const DIV_OPTIONS = [{ value: '', label: 'All' }, { value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];
const COLLEGE_STATS = REF_STATS.filter((s) => s.key !== 'var_pg' && s.key !== 'yellow_pg');

export default function Referees() {
  const f = useFilters();
  const [division, setDivision] = useUrlState('division', '', { allow: ['d1', 'd2', 'd3'] });
  const [period, setPeriod] = useUrlState('period', 'season', { allow: ['season', 'all'] });
  const [sort, setSort] = useSortParam('sort', { key: 'games', dir: 'desc' });
  const [page, setPage] = useUrlNumber('page', 1, { min: 1 });
  const search = useUrlText('q');
  const q = useQuery({
    queryKey: ['referees', f.season, f.gender, division, period, sort?.key, search.value, page],
    queryFn: () => api<Page>(`/api/referees${qs({ season: period === 'all' ? 'all' : f.season, gender: f.gender, division, q: search.value, sort: sort?.key ?? 'games', limit: PAGE, offset: (page - 1) * PAGE })}`),
    placeholderData: keepPreviousData,
  });
  const avg = q.data?.average;
  const cols: Column<Row>[] = [
    { key: 'name', label: 'Referee', primary: true, sortable: true, render: (r) => (
      <Link to={`/referees/${r.slug}`} className="min-w-0 hover:text-pitch-300">
        <span className="block truncate font-medium text-chalk-100">{r.name}</span>
        <span className="block text-2xs text-chalk-500">{[divisionShort(r.division), r.last_date ? `last ${fmt.day(r.last_date)}` : null].filter(Boolean).join(', ')}</span>
      </Link>
    ) },
    { key: 'games', label: 'Games', num: true, sortable: true },
    ...COLLEGE_STATS.map((s): Column<Row> => ({
      key: s.key as string, label: s.short, title: s.label.replace('a match', 'a game'), num: true, sortable: true,
      priority: s.key === 'cards_pg' || s.key === 'fouls_pg' ? 1 : s.key === 'goals_pg' ? 3 : 2,
      render: (r) => refValue(r[s.key] as number | null, s),
    })),
  ];
  const pager = q.data && q.data.total > PAGE ? <Pager page={page - 1} pageSize={PAGE} total={q.data.total} onPage={(p) => setPage(p + 1)} busy={q.isFetching} noun="referees" /> : null;
  return (
    <div className="space-y-4">
      <PageHeader title="Referees" meta={`${genderLabel(f.gender).replace(/^./, (c) => c.toUpperCase())} college referees with 5+ games ${period === 'all' ? 'in every season we hold' : `in ${f.season}`}: cards, fouls, penalty kicks and home wins a game.`}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={(v) => { setDivision(v); setPage(1); }} options={DIV_OPTIONS} />}</Field>
        <Field label="Seasons">{() => <SegmentedControl label="Seasons" size="sm" value={period} onChange={(v) => { setPeriod(v); setPage(1); }} options={[{ value: 'season', label: String(f.season) }, { value: 'all', label: 'All' }]} />}</Field>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-44" placeholder="Referee" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      {avg && (avg.games ?? 0) > 0 && (
        <p className="text-xs text-chalk-400">
          Over {fmt.num(avg.games)} games with a named referee ({fmt.num(q.data?.referees)} referees): <span className="text-chalk-200 tnum">{refValue(avg.cards_pg, { d: 2 })}</span> cards and <span className="text-chalk-200 tnum">{refValue(avg.fouls_pg, { d: 1 })}</span> fouls a game; the home side wins <span className="text-chalk-200 tnum">{refValue(avg.home_pct, { d: 0, pct: true })}</span> of games not at a neutral site.
        </p>
      )}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && !q.data.rows.length && !q.isFetching && <EmptyState title={search.value ? `No referee matches “${search.value}”` : 'No referees here yet'} body="A referee appears after five games whose box score names them. Box scores from NCAA.com do not list officials, so many games have none." action={search.value ? <button className="btn-ghost btn-sm" onClick={search.clear}>Clear search</button> : undefined} />}
      {(q.isPending || (q.data && q.data.rows.length > 0)) && (
        <div className={q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}>
          <DataTable rows={q.data?.rows ?? []} columns={cols} rowKey={(r) => r.slug} caption="College referees" rowHref={(r) => `/referees/${r.slug}`} mode="server" sort={sort} onSort={(s) => { setSort(s); setPage(1); }} loading={q.isPending} />
        </div>
      )}
      {pager}
      <p className="text-xs text-chalk-500">From the officials each school's box score lists (Sidearm and Presto sites), with both teams' cards, fouls and penalty kicks from the same box score. A name written two ways counts as two referees.</p>
    </div>
  );
}
