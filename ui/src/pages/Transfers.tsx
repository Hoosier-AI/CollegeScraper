// College transfers (/transfers): players found at a new school this season, newest finds first, with both schools
// and what they have done at the new one. Matched across rosters by name and bio, so a move shows once the new
// school's roster lists the player.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api, fmt, qs } from '../lib/api';
import { divisionShort, genderLabel, useFilters, useHref } from '../lib/filters';
import { useUrlNumber, useUrlState, useUrlText } from '../lib/urlState';
import { EmptyState, ErrorBox, Field, PageHeader, Pager, PlayerAvatar, SegmentedControl, Select, Skeleton, TeamLogo } from '../components/primitives';

const PAGE = 50;
const DIV_OPTIONS = [{ value: '', label: 'All' }, { value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];

interface Side { id: string; name: string; gender: 'm' | 'w'; seo: string | null; logo: string | null; division: string | null; conference: string | null }
interface Row { id: string; from_season: number; to_season: number; found_at: string; player: { id: string; name: string; slug: string | null; headshot: string | null }; from: Side | null; to: Side; line: { position: string | null; class: string | null; gp: number | null; minutes: number | null; goals: number | null; assists: number | null; saves: number | null } | null }

export default function Transfers() {
  const f = useFilters();
  const href = useHref();
  const [division, setDivision] = useUrlState('division', '', { allow: ['d1', 'd2', 'd3'] });
  const [conference, setConference] = useUrlState('conference');
  const [page, setPage] = useUrlNumber('page', 0, { min: 0, replace: true, resetPage: false });
  const search = useUrlText('q');
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ conferences: { id: string; name: string; division: string | null }[] }>('/api/meta') });
  const q = useQuery({
    queryKey: ['transfers', f.season, f.gender, division, conference, search.value, page],
    queryFn: () => api<{ total: number; rows: Row[] }>(`/api/transfers${qs({ season: f.season, gender: f.gender, division, conference, q: search.value, limit: PAGE, offset: page * PAGE })}`),
    placeholderData: keepPreviousData,
  });
  const confOptions = useMemo(() => [{ value: '', label: 'All conferences' }, ...(meta.data?.conferences ?? []).filter((c) => !division || c.division === division).map((c) => ({ value: c.id, label: c.name }))], [meta.data, division]);
  const school = (s: Side | null, season: number) => s
    ? <Link to={href(`/teams/${s.id}`, { season, gender: s.gender })} className="flex min-w-0 items-center gap-2 hover:text-pitch-300"><TeamLogo src={s.logo} seo={s.seo} name={s.name} size={20} /><span className="min-w-0"><span className="block truncate font-medium text-chalk-100">{s.name}</span><span className="block truncate text-2xs text-chalk-500">{[divisionShort(s.division), s.conference, season].filter(Boolean).join(', ')}</span></span></Link>
    : <span className="text-chalk-500">Another school</span>;
  const pager = q.data && q.data.total > PAGE ? <Pager page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} busy={q.isFetching} noun="transfers" /> : null;
  return (
    <div className="space-y-4">
      <PageHeader title="Transfers" meta={q.data ? `${fmt.num(q.data.total)} ${genderLabel(f.gender)} players at a new school in ${f.season}` : `${genderLabel(f.gender)} players at a new school in ${f.season}`}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={(v) => { setDivision(v); setConference(''); }} options={DIV_OPTIONS} />}</Field>
        <Field label="Conference">{(id) => <Select id={id} value={conference} onChange={setConference} options={confOptions} className="max-w-[220px]" />}</Field>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-48" placeholder="Player or school" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      <p className="text-xs text-chalk-400">Found by matching each player across schools' rosters by name, hometown and bio; the filters read the new school.</p>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {q.data && !q.data.rows.length && <EmptyState title={search.value ? `Nothing matches “${search.value}”` : 'No transfers found yet'} body="Transfers appear as the new season's rosters are collected." action={search.value ? <button className="btn-ghost btn-sm" onClick={search.clear}>Clear search</button> : undefined} />}
      {pager}
      {q.data && q.data.rows.length > 0 && (
        <ul className={`frame divide-y divide-field-700 ${q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}`}>
          {q.data.rows.map((r) => (
            <li key={r.id} className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto_minmax(0,1fr)_8rem]">
              <Link to={`/players/${r.player.slug ?? r.player.id}`} className="flex min-w-0 items-center gap-2.5 hover:text-pitch-300">
                <PlayerAvatar src={r.player.headshot} name={r.player.name} size={32} />
                <span className="min-w-0"><span className="block truncate font-medium text-chalk-100">{r.player.name}</span><span className="block text-2xs text-chalk-500">{[r.line?.position, r.line?.class].filter(Boolean).join(', ') || ' '}</span></span>
              </Link>
              {school(r.from, r.from_season)}
              <ArrowRight size={14} aria-label="to" className="hidden text-chalk-500 md:block" />
              {school(r.to, r.to_season)}
              <span className="text-xs text-chalk-400 tnum md:text-right">{r.line?.gp ? `${r.line.gp} GP, ${r.line.goals ?? 0} G, ${r.line.assists ?? 0} A` : 'No games yet'}</span>
            </li>
          ))}
        </ul>
      )}
      {pager}
    </div>
  );
}
