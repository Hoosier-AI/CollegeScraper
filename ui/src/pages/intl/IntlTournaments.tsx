// Every national-team competition we follow, by confederation, senior or youth, men's or women's (the header toggle),
// with what is playing now and what is next.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt } from '../../lib/api';
import { useUrlState, useUrlText } from '../../lib/urlState';
import { proPath } from '../../lib/pro';
import { CONFEDERATION_LABEL, confRank, type IntlTournament } from '../../lib/intl';
import { EmptyState, ErrorBox, Field, PageHeader, SegmentedControl, Skeleton, TeamLogo } from '../../components/primitives';
import { useProGender } from '../../lib/proGender';

const state = (t: IntlTournament) => (t.state === 'live' ? <span className="shrink-0 rounded bg-win/15 px-1.5 text-2xs font-semibold text-win">Playing now</span>
  : t.state === 'upcoming' && t.starts_on ? <span className="shrink-0 text-2xs text-chalk-500">From {fmt.date(t.starts_on)}</span> : null);

export default function IntlTournaments() {
  const q = useQuery({ queryKey: ['intl-tournaments'], queryFn: () => api<IntlTournament[]>('/api/intl/tournaments'), staleTime: 300_000 });
  const [gender] = useProGender();
  const [level, setLevel] = useUrlState('level', 'senior', { allow: ['senior', 'youth'] });
  const search = useUrlText('q');
  const term = search.value.trim().toLowerCase();
  const groups = useMemo(() => {
    const rows = (q.data ?? []).filter((t) => t.gender === gender && t.level === level && (!term || t.name.toLowerCase().includes(term)));
    const m = new Map<string, IntlTournament[]>();
    for (const t of rows) m.set(t.confederation, [...(m.get(t.confederation) ?? []), t]);
    return [...m.entries()].sort(([a], [b]) => confRank(a) - confRank(b));
  }, [q.data, gender, level, term]);
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  return (
    <div className="space-y-4">
      <PageHeader title="International tournaments" meta={q.data ? `${total} ${gender === 'w' ? "women's" : "men's"} ${level === 'youth' ? 'youth ' : ''}competitions` : undefined}>
        <Field label="Teams">{() => <SegmentedControl label="Senior or youth" size="sm" value={level} onChange={(v) => setLevel(v === 'senior' ? '' : v)} options={[{ value: 'senior', label: 'Senior' }, { value: 'youth', label: 'Youth' }]} />}</Field>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-48" placeholder="Tournament" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-64" />}
      {q.data && !total && <EmptyState title="No tournaments match" body={term ? 'Clear the filter, or try the other level.' : 'Try the other level.'} />}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map(([conf, list]) => (
          <section key={conf} className="frame overflow-hidden" aria-label={CONFEDERATION_LABEL[conf] ?? conf}>
            <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-chalk-100"><span className="min-w-0 truncate">{CONFEDERATION_LABEL[conf] ?? conf}</span><span className="ml-auto text-2xs font-normal text-chalk-500 tnum">{list.length}</span></h2>
            <ul className="divide-y divide-field-700/70 border-t border-field-700">
              {list.map((t) => (
                <li key={t.id}>
                  <Link to={proPath.league(t.slug, null, null, 'intl')} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-field-800 coarse:py-2.5">
                    <TeamLogo src={t.logo} name={t.name} size={18} />
                    <span className="min-w-0 flex-1 truncate text-chalk-200" title={t.name}>{t.name}</span>
                    {state(t)}
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
