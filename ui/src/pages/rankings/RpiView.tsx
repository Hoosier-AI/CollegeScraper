// Live RPI: every program's Rating Percentage Index from this season's results, recomputed within minutes of each
// final, ranked within its division. D1 shows NCAA.com's official rank beside ours (the NCAA publishes the order, not
// the values); D2 and D3 have no official RPI page, so theirs is our calculation.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { divisionLabel, genderLabel, useFilters, useHref } from '../../lib/filters';
import { useUrlNumber, useUrlState } from '../../lib/urlState';
import { EmptyState, ErrorBox, Field, PageHeader, Pager, SegmentedControl, Select, Skeleton, TeamLogo } from '../../components/primitives';
import { Change } from './EloView';

const PAGE = 100;
const DIV_OPTIONS = [{ value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];
interface Row { rank: number; rank_yesterday: number | null; official_rank: number | null; official_prev: number | null; program: { id: string; name: string; seo: string | null; logo: string | null }; conference: string | null; record: { w: number; l: number; t: number }; rpi: number; wp: number; owp: number; oowp: number }
interface Data { total: number; updated_at: string | null; official_as_of: string | null; agreement: { spearman: number; teams: number; top25_mean_diff: number } | null; rows: Row[] }

const p4 = (v: number) => v.toFixed(4);

export function RpiView() {
  const f = useFilters();
  const href = useHref();
  const [division, setDivision] = useUrlState('division', 'd1', { allow: ['d1', 'd2', 'd3'] });
  const [conference, setConference] = useUrlState('conference');
  const [page, setPage] = useUrlNumber('page', 0, { min: 0, replace: true, resetPage: false });
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ conferences: { id: string; name: string; division: string | null }[] }>('/api/meta') });
  // Live: refreshed every minute (the job reruns within minutes of each final).
  const q = useQuery({ queryKey: ['college-rpi', f.gender, division, conference, page], queryFn: () => api<Data>(`/api/rpi${qs({ gender: f.gender, division, conference, limit: PAGE, offset: page * PAGE })}`), placeholderData: keepPreviousData, refetchInterval: 60_000 });
  const confOptions = useMemo(() => [{ value: '', label: 'All conferences' }, ...(meta.data?.conferences ?? []).filter((c) => c.division === division).map((c) => ({ value: c.id, label: c.name }))], [meta.data, division]);
  const d1 = division === 'd1';
  const updated = q.data?.updated_at ? new Date(q.data.updated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  const pager = q.data && q.data.total > PAGE ? <Pager page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} busy={q.isFetching} noun="teams" /> : null;
  return (
    <div className="space-y-4">
      <PageHeader as="h2" title="Live RPI" meta={`${divisionLabel(division)} ${genderLabel(f.gender)}, ${f.season}${updated ? `, updated ${updated}` : ''}${d1 ? '' : '. The NCAA publishes no RPI for this division: ours, by the same method'}`}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={(v) => { setDivision(v); setConference(''); }} options={DIV_OPTIONS} />}</Field>
        <Field label="Conference">{(id) => <Select id={id} value={conference} onChange={setConference} options={confOptions} className="max-w-[220px]" />}</Field>
      </PageHeader>
      {d1 && q.data?.agreement && <p className="text-xs text-chalk-400">Matches the NCAA's official order closely: rank correlation {q.data.agreement.spearman.toFixed(3)} over {q.data.agreement.teams} teams, the top 25 within {q.data.agreement.top25_mean_diff.toFixed(1)} places on average{q.data.official_as_of ? ` (official list ${q.data.official_as_of.replace(/^Through Games\s*/i, 'through ')})` : ''}. Ours moves with each result; the official list is published weekly.</p>}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {q.data && !q.data.rows.length && <EmptyState title="No RPI yet" body="It is worked out from the season's results as they come in." />}
      {pager}
      {q.data && q.data.rows.length > 0 && (
        <div className="frame overflow-x-auto">
          <table className={`w-full text-sm ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
            <caption className="sr-only">Live RPI, {divisionLabel(division)} {genderLabel(f.gender)}</caption>
            <thead><tr>
              <th scope="col" className="th text-right">#</th><th scope="col" className="th text-right" title="Change since yesterday">Day</th><th scope="col" className="th">Team</th>
              <th scope="col" className="th hidden md:table-cell">Conference</th><th scope="col" className="th text-right">W-L-T</th><th scope="col" className="th text-right">RPI</th>
              <th scope="col" className="th hidden text-right lg:table-cell" title="Winning percentage, a tie a third of a win">WP</th><th scope="col" className="th hidden text-right lg:table-cell" title="Opponents' winning percentage">OWP</th><th scope="col" className="th hidden text-right lg:table-cell" title="Opponents' opponents' winning percentage">OOWP</th>
              {d1 && <th scope="col" className="th text-right" title="The published order">Published</th>}
            </tr></thead>
            <tbody>{q.data.rows.map((r) => (
              <tr key={r.program.id} className="border-t border-field-700">
                <td className="td num font-semibold text-chalk-100">{r.rank}</td>
                <td className="td num"><Change v={r.rank_yesterday != null ? r.rank_yesterday - r.rank : null} /></td>
                <td className="td"><Link to={href(`/teams/${r.program.id}`, { tab: 'stats' })} className="flex items-center gap-2 font-medium text-chalk-100 hover:text-pitch-300"><TeamLogo src={r.program.logo} seo={r.program.seo} name={r.program.name} size={20} />{r.program.name}</Link></td>
                <td className="td hidden text-chalk-400 md:table-cell">{r.conference ?? ''}</td>
                <td className="td num text-chalk-300">{fmt.rec(r.record.w, r.record.l, r.record.t)}</td>
                <td className="td num font-semibold text-chalk-100">{p4(r.rpi)}</td>
                <td className="td num hidden text-chalk-400 lg:table-cell">{p4(r.wp)}</td><td className="td num hidden text-chalk-400 lg:table-cell">{p4(r.owp)}</td><td className="td num hidden text-chalk-400 lg:table-cell">{p4(r.oowp)}</td>
                {d1 && <td className="td num text-chalk-400">{r.official_rank ?? '–'}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {pager}
      <p className="max-w-3xl text-xs text-chalk-500">RPI is the NCAA's selection index: a quarter the team's winning percentage, half its opponents' and a quarter its opponents' opponents', counting only games against teams of the same division. Ours is worked out from every result as it comes in, with ties a third of a win in a team's own record and half in its opponents' (the settings that match the NCAA's published D1 order best).</p>
    </div>
  );
}
