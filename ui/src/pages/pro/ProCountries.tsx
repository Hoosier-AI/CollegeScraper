// Countries (/pro/countries) and one country (/pro/countries/:slug): its competitions, its clubs in competitions we
// follow, its players at home and abroad.
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { useUrlText } from '../../lib/urlState';
import { proPath, proPaths2, useCountries, type ProLeagueRef, type ProTeamRef } from '../../lib/pro';
import { LeadersTable, type LeaderRow } from '../../components/pro/People';
import { EmptyState, ErrorBox, Field, PageHeader, Section, Skeleton, TeamLogo } from '../../components/primitives';

export function ProCountries() {
  const { list } = useCountries();
  const search = useUrlText('q');
  const term = search.value.trim().toLowerCase();
  const rows = useMemo(() => list.filter((c) => !term || c.name.toLowerCase().includes(term)).sort((a, b) => b.leagues - a.leagues || a.name.localeCompare(b.name)), [list, term]);
  return (
    <div className="space-y-4">
      <PageHeader title="Countries" meta={`${list.length} countries and regions`}>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-48" placeholder="Country" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      {!list.length && <Skeleton className="h-64" />}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((c) => (
          <li key={c.name}>
            <Link to={proPaths2.country(c.slug)} className="card flex items-center gap-2 px-3 py-2 text-sm hover:bg-field-800">
              {c.flag ? <img src={c.flag} alt="" width={22} height={16} className="h-4 w-[22px] rounded-[2px] object-cover" loading="lazy" /> : <span className="h-4 w-[22px]" />}
              <span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{c.name}</span>
              {c.leagues > 0 && <span className="text-2xs tnum text-chalk-500">{c.leagues} comps</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CountryData { country: { name: string; code: string | null; flag: string | null; slug: string }; leagues: (ProLeagueRef & { priority: number })[]; clubs: (ProTeamRef & { founded: number | null; venue: string | null })[]; players: LeaderRow[]; abroad: LeaderRow[] }

export function ProCountry() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: ['pro-country', slug], queryFn: () => api<CountryData>(`/api/pro/countries/${slug}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="No such country" action={<Link className="btn-ghost btn-sm" to={proPaths2.countries}>All countries</Link>} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-96" /></div>;
  const d = q.data!;
  const c = d.country;
  return (
    <div className="space-y-5">
      <PageHeader title={<span className="flex items-center gap-3">{c.flag && <img src={c.flag} alt="" width={44} height={32} className="h-8 w-11 rounded object-cover" />}{c.name}</span>}
        meta={`${d.leagues.length} competitions, ${d.clubs.length} clubs we follow`}>
        <Link to={`${proPaths2.players}?nationality=${encodeURIComponent(c.name)}`} className="btn-ghost btn-sm">All {c.name} players</Link>
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-8">
          <Section title={`${c.name} players abroad`}><LeadersTable rows={d.abroad} stat="minutes" caption={`${c.name} players abroad`} empty={<p className="px-3 py-4 text-sm text-chalk-400">No players of this nationality abroad in our records yet.</p>} /></Section>
          <Section title={`Most-used ${c.name} players`}><LeadersTable rows={d.players} stat="minutes" caption={`${c.name} players by minutes`} empty={<p className="px-3 py-4 text-sm text-chalk-400">No season stats yet.</p>} /></Section>
        </div>
        <div className="space-y-5 lg:col-span-4">
          {d.leagues.length > 0 && (
            <Section title="Competitions">
              <ul className="frame divide-y divide-field-700">{d.leagues.map((l) => <li key={l.id}><Link to={proPath.league(l.slug)} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-field-800"><TeamLogo src={l.logo} name={l.name} size={18} /><span className="truncate text-chalk-200">{l.name}</span>{l.gender === 'w' && <span className="ml-auto text-2xs text-chalk-500">W</span>}</Link></li>)}</ul>
            </Section>
          )}
          {d.clubs.length > 0 && (
            <Section title="Clubs">
              <ul className="frame max-h-[32rem] divide-y divide-field-700 overflow-y-auto">{d.clubs.map((t) => <li key={t.id}><Link to={proPath.team(t.slug)} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-field-800"><TeamLogo src={t.logo} name={t.name} size={18} /><span className="truncate text-chalk-200">{t.name}</span>{t.gender === 'w' && <span className="ml-auto text-2xs text-chalk-500">W</span>}</Link></li>)}</ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
