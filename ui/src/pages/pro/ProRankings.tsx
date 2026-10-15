// Pro club rankings: Plaibook Elo from every club result since 2023 in every competition we follow. US clubs first
// (their rank among US clubs beside the world rank), or the world's.
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { useUrlNumber, useUrlState } from '../../lib/urlState';
import { proPath, SCOPE_OPTIONS } from '../../lib/pro';
import { useGender } from '../../lib/proGender';
import { Flag } from '../../components/pro/People';
import { EmptyState, ErrorBox, Field, PageHeader, Pager, SegmentedControl, Skeleton, TeamLogo } from '../../components/primitives';
import { Change } from '../rankings/EloView';

const PAGE = 100;
interface Row { rank: number; world_rank: number; team: { id: number; name: string; slug: string | null; logo: string | null }; country: string | null; rating: number; change_30d: number | null; games: number }

export default function ProRankings() {
  const [gender] = useGender();
  const [scope, setScope] = useUrlState('scope', 'us', { allow: ['us', 'world'] });
  const [page, setPage] = useUrlNumber('page', 0, { min: 0, replace: true, resetPage: false });
  const world = scope === 'world';
  const q = useQuery({ queryKey: ['pro-rankings', gender, scope, page], queryFn: () => api<{ total: number; as_of: string | null; rows: Row[] }>(`/api/pro/rankings${qs({ gender, scope: world ? 'world' : '', limit: PAGE, offset: page * PAGE })}`), placeholderData: keepPreviousData });
  const pager = q.data && q.data.total > PAGE ? <Pager page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} busy={q.isFetching} noun="clubs" /> : null;
  return (
    <div className="space-y-4">
      <PageHeader title="Club rankings" meta={`Plaibook Elo, ${gender === 'w' ? "women's" : "men's"} clubs, ${world ? 'worldwide' : 'US clubs with their world rank'}${q.data?.as_of ? `, as of ${fmt.date(q.data.as_of)}` : ''}`}>
        <Field label="Where">{() => <SegmentedControl label="US or worldwide" size="sm" value={scope as 'us' | 'world'} onChange={(v) => { setScope(v); setPage(0); }} options={[...SCOPE_OPTIONS]} />}</Field>
      </PageHeader>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {q.data && !q.data.rows.length && <EmptyState title="No ratings yet" body="Ratings are worked out every morning from the results we hold." />}
      {pager}
      {q.data && q.data.rows.length > 0 && (
        <div className="frame overflow-x-auto">
          <table className={`w-full text-sm ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
            <caption className="sr-only">Plaibook Elo club rankings</caption>
            <thead><tr><th scope="col" className="th text-right">#</th><th scope="col" className="th">Club</th>{world ? <th scope="col" className="th hidden sm:table-cell">Country</th> : <th scope="col" className="th text-right">World</th>}<th scope="col" className="th text-right">Rating</th><th scope="col" className="th text-right" title="Change over the last 30 days">30 days</th><th scope="col" className="th hidden text-right sm:table-cell">Matches</th></tr></thead>
            <tbody>{q.data.rows.map((r) => (
              <tr key={r.team.id} className="border-t border-field-700">
                <td className="td num text-chalk-500">{r.rank}</td>
                <td className="td">{r.team.slug ? <Link to={proPath.team(r.team.slug, null, false)} className="flex items-center gap-2 font-medium text-chalk-100 hover:text-pitch-300"><TeamLogo src={r.team.logo} name={r.team.name} size={20} />{r.team.name}</Link> : r.team.name}</td>
                {world ? <td className="td hidden text-chalk-400 sm:table-cell"><span className="inline-flex items-center gap-1.5"><Flag country={r.country} size={11} />{r.country}</span></td> : <td className="td num text-chalk-400">{r.world_rank}</td>}
                <td className="td num font-semibold text-chalk-100">{r.rating}</td>
                <td className="td num"><Change v={r.change_30d} /></td>
                <td className="td num hidden text-chalk-400 sm:table-cell">{r.games}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {pager}
      <p className="max-w-3xl text-xs text-chalk-500">Plaibook Elo is our own rating, worked out every morning from every club result since 2023 in every competition we follow,. Each league carries a level that cup and continental matches move, so a title in a weaker league counts for less. Ranked: professional clubs with ten or more matches and one in the last year; amateur US leagues (USL League Two, NPSL) are rated but not ranked.</p>
    </div>
  );
}
