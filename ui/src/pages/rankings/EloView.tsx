// College Plaibook Elo: every NCAA program's rating from every result since 2024, ranked within its division.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api, fmt, qs } from '../../lib/api';
import { divisionLabel, genderLabel, useFilters, useHref } from '../../lib/filters';
import { useUrlNumber, useUrlState } from '../../lib/urlState';
import { EmptyState, ErrorBox, Field, PageHeader, Pager, SegmentedControl, Select, Skeleton, TeamLogo } from '../../components/primitives';

const PAGE = 100;
const DIV_OPTIONS = [{ value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];
interface Row { rank: number; program: { id: string; name: string; seo: string | null; logo: string | null }; division: string; conference: string | null; rating: number; change_30d: number | null; games: number }

export function Change({ v }: { v: number | null }) {
  if (v == null || Math.abs(v) < 1) return <span className="text-chalk-500">–</span>;
  return v > 0 ? <span className="inline-flex items-center gap-0.5 text-win tnum" aria-label={`up ${Math.round(v)}`}><ArrowUp size={13} aria-hidden />{Math.round(v)}</span>
    : <span className="inline-flex items-center gap-0.5 text-loss tnum" aria-label={`down ${Math.round(-v)}`}><ArrowDown size={13} aria-hidden />{Math.round(-v)}</span>;
}

export function EloView() {
  const f = useFilters();
  const href = useHref();
  const [division, setDivision] = useUrlState('division', 'd1', { allow: ['d1', 'd2', 'd3'] });
  const [conference, setConference] = useUrlState('conference');
  const [page, setPage] = useUrlNumber('page', 0, { min: 0, replace: true, resetPage: false });
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ conferences: { id: string; name: string; division: string | null }[] }>('/api/meta') });
  const q = useQuery({ queryKey: ['college-elo', f.gender, division, conference, page], queryFn: () => api<{ total: number; as_of: string | null; rows: Row[] }>(`/api/elo${qs({ gender: f.gender, division, conference, limit: PAGE, offset: page * PAGE })}`), placeholderData: keepPreviousData });
  const confOptions = useMemo(() => [{ value: '', label: 'All conferences' }, ...(meta.data?.conferences ?? []).filter((c) => c.division === division).map((c) => ({ value: c.id, label: c.name }))], [meta.data, division]);
  const pager = q.data && q.data.total > PAGE ? <Pager page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} busy={q.isFetching} noun="teams" /> : null;
  return (
    <div className="space-y-4">
      <PageHeader as="h2" title="Plaibook Elo" meta={`${divisionLabel(division)} ${genderLabel(f.gender)}, every result since 2024${q.data?.as_of ? `, as of ${fmt.date(q.data.as_of)}` : ''}`}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={(v) => { setDivision(v); setConference(''); }} options={DIV_OPTIONS} />}</Field>
        <Field label="Conference">{(id) => <Select id={id} value={conference} onChange={setConference} options={confOptions} className="max-w-[220px]" />}</Field>
      </PageHeader>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {q.data && !q.data.rows.length && <EmptyState title="No ratings yet" body="Ratings are worked out every morning from the results we hold." />}
      {pager}
      {q.data && q.data.rows.length > 0 && (
        <div className="frame overflow-x-auto">
          <table className={`w-full text-sm ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
            <caption className="sr-only">Plaibook Elo, {divisionLabel(division)} {genderLabel(f.gender)}</caption>
            <thead><tr><th scope="col" className="th text-right">#</th><th scope="col" className="th">Team</th><th scope="col" className="th hidden sm:table-cell">Conference</th><th scope="col" className="th text-right">Rating</th><th scope="col" className="th text-right" title="Change over the last 30 days">30 days</th><th scope="col" className="th hidden text-right sm:table-cell">Games</th></tr></thead>
            <tbody>{q.data.rows.map((r) => (
              <tr key={r.program.id} className="border-t border-field-700">
                <td className="td num text-chalk-500">{r.rank}</td>
                <td className="td"><Link to={href(`/teams/${r.program.id}`)} className="flex items-center gap-2 font-medium text-chalk-100 hover:text-pitch-300"><TeamLogo src={r.program.logo} seo={r.program.seo} name={r.program.name} size={20} />{r.program.name}</Link></td>
                <td className="td hidden text-chalk-400 sm:table-cell">{r.conference ?? ''}</td>
                <td className="td num font-semibold text-chalk-100">{r.rating}</td>
                <td className="td num"><Change v={r.change_30d} /></td>
                <td className="td num hidden text-chalk-400 sm:table-cell">{r.games}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {pager}
      <p className="max-w-3xl text-xs text-chalk-500">Plaibook Elo is our own rating, worked out every morning from every result since 2024 with the World Football Elo method: a win against a stronger side gains more, a bigger margin counts a little more, and home sides get a small edge. Conferences carry a level that results between conferences move, so a strong record in a weaker conference counts for less. Teams with three or more games this season are ranked within their division.</p>
    </div>
  );
}
