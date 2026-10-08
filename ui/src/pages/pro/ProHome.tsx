// Plaibook Stats Pro front door: what is on today across professional soccer, the featured competitions, search.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { todayEastern } from '../../lib/dates';
import { proPath, genderWord, type ProDay, type ProLeagueRef } from '../../lib/pro';
import { ProSearchBox } from '../../components/pro/ProSearchBox';
import { LeagueHeading, ProMatchRow } from '../../components/pro/ProMatchRow';
import { EmptyState, ErrorBox, Section, Skeleton, TeamLogo } from '../../components/primitives';

interface HomeData { date: string; matches: ProDay; featured: (ProLeagueRef & { current_season: number | null })[]; counts: { leagues: number; teams: number; players: number; matches: number } }

export default function ProHome() {
  const date = todayEastern();
  const q = useQuery({ queryKey: ['pro-home', date], queryFn: () => api<HomeData>(`/api/pro/home${qs({ date })}`), refetchInterval: (query) => ((query.state.data?.matches.live ?? 0) > 0 ? 60_000 : false) });
  const d = q.data;
  // The top competitions only on the front page; the full scoreboard has everything.
  const groups = (d?.matches.groups ?? []).filter((g) => g.priority < 100).slice(0, 10);
  const more = (d?.matches.total ?? 0) - groups.reduce((n, g) => n + g.matches.length, 0);
  return (
    <div className="space-y-6 pb-4">
      <section className="grid gap-6 pt-2 sm:pt-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-pitch-300">Plaibook Stats Pro</p>
          <h1 className="display mt-1 text-3xl leading-[0.95] text-chalk-100 sm:text-5xl">Professional soccer, every league we can reach.</h1>
          <p className="mt-3 text-sm text-chalk-300 sm:text-base">Live scores, lineups, tables and player stats from MLS and the NWSL to the Premier League and beyond, men's and women's. Players who came through college link back to their NCAA careers.</p>
          <div className="mt-5"><ProSearchBox size="lg" examples={['Premier League', 'NWSL', 'Inter Miami', 'Trinity Rodman']} /></div>
        </div>
        {d && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[['Competitions', d.counts.leagues], ['Clubs', d.counts.teams], ['Players', d.counts.players], ['Matches', d.counts.matches]].map(([k, v]) => (
              <div key={k as string} className="card px-3 py-2"><dt className="text-2xs text-chalk-500">{k}</dt><dd className="display text-2xl text-chalk-100 tnum">{fmt.num(v)}</dd></div>
            ))}
          </dl>
        )}
      </section>

      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8"><Section title={<span className="flex items-center gap-2">Today{d?.matches.live ? <span className="flex items-center gap-1 text-sm font-normal text-win"><span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-win motion-reduce:animate-none" />{d.matches.live} live</span> : null}</span>}
          right={<Link to={proPath.matches} className="text-sm text-pitch-300 hover:text-pitch-200">Full scoreboard</Link>}>
          <div className="space-y-3">
            {q.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
            {d && !groups.length && <EmptyState title="No featured matches today" body={d.matches.total ? `${d.matches.total} matches in other competitions.` : 'Try the full scoreboard for another day.'} action={<Link to={proPath.matches} className="btn-ghost btn-sm">Open the scoreboard</Link>} />}
            {groups.map((g) => (
              <div key={g.league.id} className="frame divide-y divide-field-700">
                <LeagueHeading league={g.league} />
                {g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}
              </div>
            ))}
            {more > 0 && <Link to={proPath.matches} className="btn-ghost btn-sm">{fmt.num(more)} more matches today</Link>}
          </div>
        </Section></div>
        <div className="lg:col-span-4"><Section title="Competitions" right={<Link to={proPath.leagues} className="text-sm text-pitch-300 hover:text-pitch-200">All</Link>}>
          <ul className="frame divide-y divide-field-700">
            {(d?.featured ?? []).map((l) => (
              <li key={l.id}>
                <Link to={proPath.league(l.slug)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-field-800">
                  <TeamLogo src={l.logo} name={l.name} size={22} />
                  <span className="min-w-0 truncate font-medium text-chalk-100">{l.name}</span>
                  <span className="ml-auto shrink-0 text-2xs text-chalk-500">{l.country && l.country !== 'World' ? l.country : 'International'}{l.gender === 'w' ? `, ${genderWord('w')}` : ''}</span>
                </Link>
              </li>
            ))}
            {q.isPending && <li className="p-3"><Skeleton lines={6} /></li>}
          </ul>
        </Section></div>
      </div>
    </div>
  );
}
