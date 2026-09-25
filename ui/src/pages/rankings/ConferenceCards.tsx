// Every conference for a division: who leads the table, how many members, a door into each.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useFilters, useHref, genderLabel, divisionLabel } from '../../lib/filters';
import { useUrlState, useUrlText } from '../../lib/urlState';
import { Badge, Chip, EmptyState, ErrorBox, Field, PageHeader, SegmentedControl, Skeleton, TeamLogo } from '../../components/primitives';

const DIV_OPTIONS = [{ value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];

export function ConferenceCards() {
  const f = useFilters();
  const href = useHref();
  const [division, setDivision] = useUrlState('division', 'd1', { allow: ['d1', 'd2', 'd3'] });
  const search = useUrlText('q');
  const q = useQuery({ queryKey: ['conferences', f.season, f.gender, division], queryFn: () => api<any[]>(`/api/conferences${qs({ season: f.season, gender: f.gender, division })}`) });
  const term = search.value.toLowerCase();
  const rows = useMemo(() => (q.data ?? []).filter((c) => !term || c.name.toLowerCase().includes(term) || (c.short_name ?? '').toLowerCase().includes(term)), [q.data, term]);
  const scope = `${divisionLabel(division)} ${genderLabel(f.gender)}, ${f.season}`;
  return (
    <div className="space-y-4">
      <PageHeader as="h2" title="Standings" meta={q.data ? `${rows.length} conferences, ${scope}. Pick a conference for its table, matches, teams and leaders.` : scope}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={setDivision} options={DIV_OPTIONS} />}</Field>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-44" placeholder="Conference name" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
        <Chip to={href('/rankings', { view: 'standings', all: 1 })}>Compare all tables</Chip>
      </PageHeader>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40" />)}</div>}
      {q.data && !rows.length && <EmptyState title={term ? `No conference matches “${search.value}”` : `No conferences for ${scope}`} action={term ? <button className="btn-ghost btn-sm" onClick={search.clear}>Clear search</button> : undefined} />}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => {
          const t = c.table?.[f.gender] ?? { top: [], source: 'none' };
          return (
            <li key={c.id}>
              <Link to={href('/rankings', { view: 'standings', conference: c.id })} className="group card flex h-full flex-col p-4 transition-colors duration-150 hover:border-field-600 hover:bg-field-800/60">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="display text-lg">{c.name}</div><div className="text-xs text-chalk-500">{c.members[f.gender]} {genderLabel(f.gender)} teams{c.short_name && c.short_name !== c.name ? `, ${c.short_name}` : ''}</div></div>
                  {t.source === 'conference' ? <Badge tone="teal">Official table</Badge> : t.source === 'computed' ? <Badge>Computed</Badge> : null}
                </div>
                {t.top.length ? (
                  <ol className="mt-3 space-y-1.5">
                    {t.top.map((r: any) => <li key={r.program_id} className="flex items-center gap-2 text-sm"><span className="w-4 text-right text-xs text-chalk-500 tnum">{r.rank}</span><TeamLogo src={r.logo} seo={r.seo} name={r.name} size={18} /><span className="min-w-0 flex-1 truncate text-chalk-100">{r.name}</span><span className="text-xs text-chalk-400 tnum">{r.conf_w}-{r.conf_l}-{r.conf_t}</span><span className="w-8 text-right text-xs text-chalk-500 tnum">{r.conf_pts ?? ''}</span></li>)}
                  </ol>
                ) : <p className="mt-3 text-sm text-chalk-500">Conference play has not started.</p>}
                <span className="mt-auto flex items-center justify-between gap-2 pt-3">
                  <span className="text-xs text-chalk-500">{Math.max(0, (c.members[f.gender] ?? 0) - t.top.length) ? `+${(c.members[f.gender] ?? 0) - t.top.length} more teams` : ''}</span>
                  <span className="inline-flex min-h-9 items-center gap-1 rounded-md border border-field-600 px-3 text-sm font-medium text-pitch-300 transition-colors duration-150 group-hover:border-pitch-400 group-hover:bg-pitch-400/10">Full table and stats <ChevronRight size={14} aria-hidden /></span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
