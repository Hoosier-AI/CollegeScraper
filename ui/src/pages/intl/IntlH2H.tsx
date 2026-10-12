// Head to head between two national teams: every meeting since the first, the record and the goals.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, qs } from '../../lib/api';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { winPct, type IntlNation, type IntlResult, type NationRef, type Tally } from '../../lib/intl';
import { ResultList, nationHref } from '../../components/intl/NationHistory';
import { EmptyState, ErrorBox, Field, PageHeader, Select, Skeleton, TeamLogo } from '../../components/primitives';
import { StatTile } from '../../components/pro/Hero';
import { useProGender } from '../../lib/proGender';

interface H2H { a: NationRef | null; b: NationRef | null; gender: 'm' | 'w'; record: Tally; results: IntlResult[] }

export default function IntlH2H() {
  const patch = useUrlPatch();
  const [a] = useUrlState('a');
  const [b] = useUrlState('b');
  const [gender] = useProGender();
  const nations = useQuery({ queryKey: ['intl-nations'], queryFn: () => api<IntlNation[]>('/api/intl/nations'), staleTime: 600_000 });
  const options = useMemo(() => [{ value: '', label: 'Choose a nation' }, ...(nations.data ?? []).filter((n) => n.level === 'senior' && n.gender === gender).sort((x, y) => x.name.localeCompare(y.name)).map((n) => ({ value: n.slug, label: n.name }))], [nations.data, gender]);
  const q = useQuery({ queryKey: ['intl-h2h', a, b], queryFn: () => api<H2H>(`/api/intl/h2h${qs({ a, b })}`), enabled: !!a && !!b && a !== b, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  const d = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Head to head" meta={d?.a && d?.b ? `${d.a.name} against ${d.b.name}` : 'Two national teams, every meeting'}>
        <Field label="Nation">{(id) => <Select id={id} value={a} onChange={(v) => patch({ a: v || null })} options={options} className="max-w-[220px]" />}</Field>
        <Field label="Against">{(id) => <Select id={id} value={b} onChange={(v) => patch({ b: v || null })} options={options} className="max-w-[220px]" />}</Field>
      </PageHeader>
      {(!a || !b) && <EmptyState title="Pick two national teams" body="Every meeting between them since their first, with the record." />}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isFetching && !d && <Skeleton className="h-64" />}
      {d && d.a && d.b && (
        <>
          <div className="flex items-center justify-center gap-4 text-lg">
            <Link to={nationHref(d.a)} className="flex items-center gap-2 font-semibold text-chalk-100 hover:text-pitch-300"><TeamLogo src={d.a.logo} name={d.a.name} size={28} />{d.a.name}</Link>
            <span className="text-chalk-500">v</span>
            <Link to={nationHref(d.b)} className="flex items-center gap-2 font-semibold text-chalk-100 hover:text-pitch-300">{d.b.name}<TeamLogo src={d.b.logo} name={d.b.name} size={28} /></Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Meetings" value={d.record.played} sub={d.results.length ? `since ${d.results[d.results.length - 1]!.date.slice(0, 4)}` : undefined} />
            <StatTile label={`${d.a.name} won`} value={d.record.w} sub={`${winPct(d.record)}%`} accent />
            <StatTile label="Drawn" value={d.record.d} />
            <StatTile label={`${d.b.name} won`} value={d.record.l} sub={d.record.played ? `${Math.round((d.record.l / d.record.played) * 100)}%` : undefined} />
          </div>
          <p className="text-center text-sm text-chalk-300 tnum">Goals {d.record.gf}–{d.record.ga}</p>
          <ResultList rows={d.results} nation={d.a.key} empty="They have never met." />
        </>
      )}
    </div>
  );
}
