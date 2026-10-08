// Every competition Plaibook Stats Pro follows, grouped by country (international ones first), with a filter.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useUrlState, useUrlText } from '../../lib/urlState';
import { proPath, type ProLeagueRef } from '../../lib/pro';
import { EmptyState, ErrorBox, Field, PageHeader, SegmentedControl, Skeleton, TeamLogo } from '../../components/primitives';

type Row = ProLeagueRef & { priority: number; current_season: number | null };

export default function ProLeagues() {
  const q = useQuery({ queryKey: ['pro-leagues'], queryFn: () => api<Row[]>('/api/pro/leagues'), staleTime: 300_000 });
  const [gender, setGender] = useUrlState('gender', '', { allow: ['m', 'w'] });
  const search = useUrlText('q');
  const term = search.value.trim().toLowerCase();
  const byCountry = useMemo(() => {
    const rows = (q.data ?? []).filter((l) => (!gender || l.gender === gender) && (!term || l.name.toLowerCase().includes(term) || (l.country ?? '').toLowerCase().includes(term)));
    const m = new Map<string, Row[]>();
    for (const l of rows) { const k = !l.country || l.country === 'World' ? 'International' : l.country; m.set(k, [...(m.get(k) ?? []), l]); }
    // International first, then the country of the highest-priority competition first (USA, England, ...), then A-Z.
    return [...m.entries()].sort(([a, x], [b, y]) => (a === 'International' ? -1 : b === 'International' ? 1 : 0) || Math.min(...x.map((l) => l.priority)) - Math.min(...y.map((l) => l.priority)) || a.localeCompare(b));
  }, [q.data, gender, term]);
  const total = byCountry.reduce((n, [, l]) => n + l.length, 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Pro competitions" meta={q.data ? `${total} competitions in ${byCountry.length} countries and regions` : undefined}>
        <Field label="Show">{() => <SegmentedControl label="Gender" size="sm" value={gender} onChange={setGender} options={[{ value: '', label: 'All' }, { value: 'm', label: "Men's" }, { value: 'w', label: "Women's" }]} />}</Field>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-48" placeholder="League or country" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-64" />}
      {q.data && !total && <EmptyState title="No competitions match" body="Try a country name, or clear the filter." action={<button className="btn-ghost btn-sm" onClick={search.clear}>Clear</button>} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {byCountry.map(([country, list]) => (
          <section key={country} className="frame" aria-label={country}>
            <h2 className="px-3 py-2 text-sm font-semibold text-chalk-100">{country}</h2>
            <ul className="divide-y divide-field-700 border-t border-field-700">
              {list.map((l) => (
                <li key={l.id}>
                  <Link to={proPath.league(l.slug)} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-field-800">
                    <TeamLogo src={l.logo} name={l.name} size={18} />
                    <span className="min-w-0 truncate text-chalk-200">{l.name}</span>
                    <span className="ml-auto shrink-0 text-2xs text-chalk-500">{l.gender === 'w' ? 'W' : ''}{l.type === 'cup' ? ' cup' : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
