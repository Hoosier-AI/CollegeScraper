// Every club we follow, by league: US leagues first (MLS, USL, MLS NEXT Pro… or the NWSL and USL Super League),
// Worldwide for the leagues we rank highest, or any one league from the list. Like the national teams page.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useUrlState, useUrlText } from '../../lib/urlState';
import { proPath, SCOPE_OPTIONS, type ProLeagueRef, type ProTeamRef } from '../../lib/pro';
import { useGender } from '../../lib/proGender';
import { EmptyState, ErrorBox, Field, PageHeader, SegmentedControl, Select, Skeleton, TeamLogo } from '../../components/primitives';

interface Group { league: ProLeagueRef & { priority: number; current_season: number | null }; teams: ProTeamRef[] }

export default function ProTeams() {
  const [gender] = useGender();
  const [scope, setScope] = useUrlState('scope', 'us', { allow: ['us', 'world'] });
  const [league, setLeague] = useUrlState('league');
  const search = useUrlText('q');
  const leagues = useQuery({ queryKey: ['pro-leagues', 'pro'], queryFn: () => api<(ProLeagueRef & { priority: number })[]>('/api/pro/leagues'), staleTime: 300_000 });
  // A league picked under the other game is set aside (NWSL chosen, then Men): the toggle wins.
  const leagueGender = leagues.data?.find((l) => String(l.id) === league)?.gender;
  const leagueOn = league && (!leagueGender || leagueGender === gender) ? league : '';
  const q = useQuery({ queryKey: ['pro-teams', gender, scope, leagueOn], queryFn: () => api<{ groups: Group[] }>(`/api/pro/teams${qs({ gender, scope, league: leagueOn })}`), placeholderData: keepPreviousData, staleTime: 300_000 });
  const term = search.value.trim().toLowerCase();
  const groups = useMemo(() => (q.data?.groups ?? []).map((g) => ({ ...g, teams: g.teams.filter((t) => !term || t.name.toLowerCase().includes(term)) })).filter((g) => g.teams.length), [q.data, term]);
  const total = new Set(groups.flatMap((g) => g.teams.map((t) => t.id))).size;
  const leagueOptions = useMemo(() => [{ value: '', label: scope === 'us' ? 'Every US league' : 'The top leagues' }, ...(leagues.data ?? []).filter((l) => l.gender === gender && l.type !== 'cup' && (scope === 'world' || l.country === 'USA')).slice(0, 400).map((l) => ({ value: String(l.id), label: `${l.name}${l.country && l.country !== 'World' ? ` (${l.country})` : ''}` }))], [leagues.data, gender, scope]);
  return (
    <div className="space-y-4">
      <PageHeader title="Teams" meta={q.data ? `${total} ${gender === 'w' ? "women's" : "men's"} clubs in ${groups.length} ${groups.length === 1 ? 'league' : 'leagues'}, this season` : 'US clubs first'}>
        <Field label="Where">{() => <SegmentedControl label="US or worldwide" size="sm" value={scope as 'us' | 'world'} onChange={(v) => { setScope(v); setLeague(''); }} options={[...SCOPE_OPTIONS]} />}</Field>
        <Field label="League">{(id) => <Select id={id} value={leagueOn} onChange={setLeague} options={leagueOptions} className="max-w-[260px]" />}</Field>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-48" placeholder="Club name" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      <p className="text-xs text-chalk-400">Clubs in each league's current season. For every club in a country, open <Link to="/pro/countries" className="text-pitch-300 hover:text-pitch-200">Countries</Link>.</p>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-64" />}
      {q.data && !groups.length && <EmptyState title={term ? `No club matches “${search.value}”` : 'No clubs listed yet'} body={term ? 'Clear the search, or look Worldwide.' : 'Try Worldwide or another league.'} action={term ? <button className="btn-ghost btn-sm" onClick={search.clear}>Clear search</button> : undefined} />}
      <div className={`grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3 ${q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}`}>
        {groups.map((g) => (
          <section key={g.league.id} className="frame overflow-hidden" aria-label={g.league.name}>
            <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-chalk-100">
              <TeamLogo src={g.league.logo} name={g.league.name} size={18} />
              <Link to={proPath.league(g.league.slug, null, null, 'club')} className="min-w-0 truncate hover:text-pitch-300">{g.league.name}</Link>
              {g.league.country && g.league.country !== 'USA' && <span className="truncate text-xs font-normal text-chalk-500">{g.league.country}</span>}
              <span className="ml-auto text-2xs font-normal text-chalk-500 tnum">{g.teams.length}</span>
            </h2>
            <ul className="grid grid-cols-2 border-t border-field-700">
              {g.teams.map((t) => (
                <li key={t.id} className="border-b border-field-700/70 odd:border-r">
                  <Link to={proPath.team(t.slug, null, false)} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-field-800 coarse:py-2.5">
                    <TeamLogo src={t.logo} name={t.name} size={18} />
                    <span className="min-w-0 truncate text-chalk-200" title={t.name}>{t.name}</span>
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
