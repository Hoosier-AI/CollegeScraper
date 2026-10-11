// Plaibook Stats Pro front door: what is on today across professional soccer, the featured competitions, search.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { todayEastern } from '../../lib/dates';
import { proPath, type ProDay, type ProLeagueRef } from '../../lib/pro';
import { ProSearchBox } from '../../components/pro/ProSearchBox';
import { LeagueHeading, ProMatchRow } from '../../components/pro/ProMatchRow';
import { EmptyState, ErrorBox, Section, Skeleton, TeamLogo } from '../../components/primitives';
import { useProGender } from '../../lib/proGender';

interface HomeData { date: string; matches: ProDay; featured: (ProLeagueRef & { current_season: number | null })[]; counts: { leagues: number; teams: number; players: number; matches: number } }

export default function ProHome() {
  const date = todayEastern();
  const q = useQuery({ queryKey: ['pro-home', date], queryFn: () => api<HomeData>(`/api/pro/home${qs({ date })}`), refetchInterval: (query) => ((query.state.data?.matches.live ?? 0) > 0 ? 60_000 : false) });
  const d = q.data;
  const [gender] = useProGender();
  // The top competitions of the chosen game only on the front page; the full scoreboard has everything.
  const ofGender = (d?.matches.groups ?? []).filter((g) => g.league.gender === gender);
  const groups = ofGender.filter((g) => g.priority < 100).slice(0, 10);
  const more = ofGender.reduce((n, g) => n + g.matches.length, 0) - groups.reduce((n, g) => n + g.matches.length, 0);
  const live = ofGender.reduce((n, g) => n + g.matches.filter((m) => m.status === 'live').length, 0);
  return (
    <div className="space-y-5 pb-4">
      <section className="flex flex-col gap-4 pt-1 sm:pt-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="display text-2xl leading-tight text-chalk-100 sm:text-3xl">Professional soccer, every league we can reach</h1>
          <p className="mt-1.5 text-sm text-chalk-300">Live scores, lineups, tables and player stats, MLS and the NWSL to the Premier League and beyond, men's and women's. Players who came through college link back to their NCAA careers.</p>
          <div className="mt-3"><ProSearchBox examples={['Premier League', 'NWSL', 'Inter Miami', 'Trinity Rodman']} /></div>
        </div>
        {d && (
          <dl className="grid shrink-0 grid-cols-4 gap-x-5 gap-y-1 text-sm lg:text-right">
            {[['Competitions', d.counts.leagues], ['Clubs', d.counts.teams], ['Players', d.counts.players], ['Matches', d.counts.matches]].map(([k, v]) => (
              <div key={k as string} className="flex flex-col-reverse"><dt className="text-2xs text-chalk-500">{k}</dt><dd className="display text-lg text-chalk-100 tnum sm:text-xl">{fmt.num(v)}</dd></div>
            ))}
          </dl>
        )}
      </section>

      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <Section title={<span className="flex items-center gap-2">Today{live ? <span className="flex items-center gap-1 text-sm font-normal text-win"><span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-win motion-reduce:animate-none" />{live} live</span> : null}</span>}
          right={<Link to={proPath.matches} className="text-sm text-pitch-300 hover:text-pitch-200">Full scoreboard</Link>}>
          {q.isPending && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>}
          {d && !groups.length && <EmptyState title="No featured matches today" body={more ? `${more} matches in other competitions.` : 'Try the full scoreboard for another day.'} action={<Link to={proPath.matches} className="btn-ghost btn-sm">Open the scoreboard</Link>} />}
          {/* Competitions flow in two columns on wide screens: half the scrolling. */}
          <div className={`gap-3 ${groups.length > 2 ? 'xl:columns-2' : ''}`}>
            {groups.map((g) => (
              <div key={g.league.id} className="frame mb-3 break-inside-avoid divide-y divide-field-700 overflow-hidden">
                <LeagueHeading league={g.league} />
                {g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}
              </div>
            ))}
          </div>
          {more > 0 && <Link to={proPath.matches} className="btn-ghost btn-sm">{fmt.num(more)} more matches today</Link>}
        </Section>
        <aside className="lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:self-start lg:overflow-y-auto">
          <Section title="Competitions" right={<Link to={proPath.leagues} className="text-sm text-pitch-300 hover:text-pitch-200">All</Link>}>
            <ul className="frame divide-y divide-field-700/70">
              {(d?.featured ?? []).filter((l) => l.gender === gender).map((l) => (
                <li key={l.id}>
                  <Link to={proPath.league(l.slug)} className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-field-800" title={l.country && l.country !== 'World' ? l.country : 'International'}>
                    <TeamLogo src={l.logo} name={l.name} size={18} />
                    <span className="min-w-0 truncate text-chalk-100">{l.name}</span>
                  </Link>
                </li>
              ))}
              {q.isPending && <li className="p-3"><Skeleton lines={6} /></li>}
            </ul>
          </Section>
        </aside>
      </div>
    </div>
  );
}
