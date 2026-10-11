// Every competition Plaibook Stats Pro follows, grouped by country (international ones first), with a filter.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useUrlState, useUrlText } from '../../lib/urlState';
import { isCup, proPath, type ProLeagueRef } from '../../lib/pro';
import { Chip, EmptyState, ErrorBox, Field, PageHeader, Skeleton, TeamLogo } from '../../components/primitives';
import { useProGender } from '../../lib/proGender';

type Row = ProLeagueRef & { priority: number; current_season: number | null };

export default function ProLeagues() {
  const q = useQuery({ queryKey: ['pro-leagues'], queryFn: () => api<Row[]>('/api/pro/leagues'), staleTime: 300_000 });
  const [gender] = useProGender();
  const search = useUrlText('q');
  const term = search.value.trim().toLowerCase();
  // Cups (domestic cups, continental and friendly tournaments) wait behind a switch: the leagues come first.
  const [cupsParam, setCups] = useUrlState('cups', '', { allow: ['1'] });
  const cups = cupsParam === '1';
  const matching = useMemo(() => (q.data ?? []).filter((l) => (!gender || l.gender === gender) && (!term || l.name.toLowerCase().includes(term) || (l.country ?? '').toLowerCase().includes(term))), [q.data, gender, term]);
  const cupCount = matching.filter(isCup).length;
  const byCountry = useMemo(() => {
    const rows = matching.filter((l) => cups || !isCup(l));
    const m = new Map<string, Row[]>();
    for (const l of rows) { const k = !l.country || l.country === 'World' ? 'International' : l.country; m.set(k, [...(m.get(k) ?? []), l]); }
    // International first, then the country of the highest-priority competition first (USA, England, ...), then A-Z.
    return [...m.entries()].sort(([a, x], [b, y]) => (a === 'International' ? -1 : b === 'International' ? 1 : 0) || Math.min(...x.map((l) => l.priority)) - Math.min(...y.map((l) => l.priority)) || a.localeCompare(b));
  }, [matching, cups]);
  const total = byCountry.reduce((n, [, l]) => n + l.length, 0);
  const n = useColumnCount();
  const cols = useMemo(() => {
    const out: [string, Row[]][][] = Array.from({ length: n }, () => []);
    const height = new Array(n).fill(0);
    for (const c of byCountry) {
      const i = height.indexOf(Math.min(...height));
      out[i]!.push(c);
      height[i] += c[1].length === 1 ? 1.2 : Math.min(c[1].length, SHOWN + 1) + 1.6; // rows (long lists folded), header, gap
    }
    return out;
  }, [byCountry, n]);
  return (
    <div className="space-y-4">
      <PageHeader title="Pro competitions" meta={q.data ? `${total} ${gender === 'w' ? "women's" : "men's"} ${cups ? 'competitions' : 'leagues'} in ${byCountry.length} countries and regions` : undefined}>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-48" placeholder="League or country" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      {q.data && cupCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-chalk-400">
          <Chip on={cups} onClick={() => setCups(cups ? '' : '1')}>{cups ? `Hide cups (${cupCount})` : `Show cups (${cupCount})`}</Chip>
          {!cups && <span>Domestic cups and tournaments are hidden.</span>}
        </div>
      )}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-64" />}
      {q.data && !total && (cupCount > 0 && !cups
        ? <EmptyState title="Only cups match" body={`${cupCount} ${cupCount === 1 ? 'cup matches' : 'cups match'} "${search.value.trim()}".`} action={<button className="btn-ghost btn-sm" onClick={() => setCups('1')}>Show cups</button>} />
        : <EmptyState title="No competitions match" body="Try a country name, or clear the filter." action={<button className="btn-ghost btn-sm" onClick={search.clear}>Clear</button>} />)}
      {/* Balanced columns: each country goes to the shortest column in priority order, so the big countries read across
          the top (USA, England, Spain...) and no card is stretched to its neighbour's height. */}
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
        {cols.map((col, i) => (
          <div key={i} className="space-y-4">
            {col.map(([country, list]) => <CountryCard key={country} country={country} list={list} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 1 column on phones, 2 from 640px, 3 from 1024px, 4 from 1536px. */
function useColumnCount() {
  const pick = () => (typeof window === 'undefined' ? 3 : window.innerWidth >= 1536 ? 4 : window.innerWidth >= 1024 ? 3 : window.innerWidth >= 640 ? 2 : 1);
  const [n, setN] = useState(pick);
  useEffect(() => { const on = () => setN(pick()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  return n;
}

function Flag({ src }: { src: string | null | undefined }) {
  return src ? <img src={src} alt="" width={20} height={14} loading="lazy" className="h-3.5 w-5 shrink-0 rounded-sm object-cover" /> : <span aria-hidden className="h-3.5 w-5 shrink-0 rounded-sm bg-field-700" />;
}
const CupTag = () => <span className="ml-auto shrink-0 rounded bg-field-800 px-1.5 text-2xs text-chalk-400">Cup</span>;

// The provider's country names use hyphens for spaces ("Czech-Republic"); a few are hyphenated for real.
const countryName = (c: string) => (/^(Guinea-Bissau|Timor-Leste)$/.test(c) ? c : c.replace(/-/g, ' '));

// A long list (Brazil's 64 state leagues) shows its first ten, the rest one click away.
const SHOWN = 10;

/** A country and its competitions; a country with one competition is a single row. */
function CountryCard({ country, list }: { country: string; list: Row[] }) {
  const flag = list.find((l) => l.country_flag)?.country_flag;
  const [all, setAll] = useState(false);
  const shown = all || list.length <= SHOWN + 1 ? list : list.slice(0, SHOWN);
  if (list.length === 1) {
    const l = list[0]!;
    return (
      <section className="frame overflow-hidden" aria-label={country}>
        <Link to={proPath.league(l.slug)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-field-800 coarse:py-3">
          <Flag src={flag} />
          <h2 className="shrink-0 font-semibold text-chalk-100">{countryName(country)}</h2>
          <TeamLogo src={l.logo} name={l.name} size={18} />
          <span className="min-w-0 truncate text-chalk-300" title={l.name}>{l.name}</span>
          {isCup(l) && <CupTag />}
        </Link>
      </section>
    );
  }
  return (
    <section className="frame overflow-hidden" aria-label={country}>
      <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-chalk-100">
        <Flag src={flag} />
        <span className="min-w-0 truncate">{countryName(country)}</span>
        <span className="ml-auto shrink-0 text-2xs font-normal text-chalk-500 tnum">{list.length}</span>
      </h2>
      <ul className="divide-y divide-field-700/70 border-t border-field-700">
        {shown.map((l) => (
          <li key={l.id}>
            <Link to={proPath.league(l.slug)} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-field-800 coarse:py-2.5">
              <TeamLogo src={l.logo} name={l.name} size={18} />
              <span className="min-w-0 truncate text-chalk-200" title={l.name}>{l.name}</span>
              {isCup(l) && <CupTag />}
            </Link>
          </li>
        ))}
        {list.length > shown.length || all ? (list.length > SHOWN + 1 && (
          <li>
            <button type="button" className="w-full px-3 py-1.5 text-left text-xs text-pitch-300 hover:bg-field-800 hover:text-pitch-200 coarse:py-2.5" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${list.length}`}
            </button>
          </li>
        )) : null}
      </ul>
    </section>
  );
}
