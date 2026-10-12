// International front door: national teams. Today's internationals (live first), or the next window's when today has
// none; the latest results; the tournaments playing now or next; the Plaibook Elo top ten.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { todayEastern } from '../../lib/dates';
import { proPath, type ProMatch } from '../../lib/pro';
import type { IntlHome as HomeData, IntlRankings, IntlTournament } from '../../lib/intl';
import { ProSearchBox } from '../../components/pro/ProSearchBox';
import { LeagueHeading, ProMatchRow } from '../../components/pro/ProMatchRow';
import { ErrorBox, Section, Skeleton, TeamLogo } from '../../components/primitives';
import { useProGender } from '../../lib/proGender';
import { nationHref } from '../../components/intl/NationHistory';

function Groups({ groups }: { groups: HomeData['matches']['groups'] }) {
  return (
    <div className={`gap-3 ${groups.length > 2 ? 'xl:columns-2' : ''}`}>
      {groups.map((g) => (
        <div key={g.league.id} className="frame mb-3 break-inside-avoid divide-y divide-field-700 overflow-hidden">
          <LeagueHeading league={g.league} />
          {g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}
        </div>
      ))}
    </div>
  );
}

function MatchList({ rows }: { rows: ProMatch[] }) {
  return <div className="frame divide-y divide-field-700 overflow-hidden">{rows.map((m) => <ProMatchRow key={m.id} m={m} showDate showLeague />)}</div>;
}

const when = (t: IntlTournament) => (t.state === 'live' ? 'Playing now' : t.starts_on ? `From ${fmt.date(t.starts_on)}` : '');

export default function IntlHome() {
  const date = todayEastern();
  const [gender] = useProGender();
  const q = useQuery({ queryKey: ['intl-home', date], queryFn: () => api<HomeData>(`/api/intl/home${qs({ date })}`), refetchInterval: (query) => ((query.state.data?.matches.live ?? 0) > 0 ? 60_000 : false) });
  const rank = useQuery({ queryKey: ['intl-rankings', gender], queryFn: () => api<IntlRankings>(`/api/intl/rankings${qs({ gender })}`), staleTime: 600_000 });
  const d = q.data;
  const groups = (d?.matches.groups ?? []).filter((g) => g.league.gender === gender);
  const live = groups.reduce((n, g) => n + g.matches.filter((m) => m.status === 'live').length, 0);
  const upcoming = (d?.upcoming ?? []).filter((m) => m.league.gender === gender).slice(0, 12);
  const recent = (d?.recent ?? []).filter((m) => m.league.gender === gender).slice(0, 12);
  const tournaments = (d?.tournaments ?? []).filter((t) => t.gender === gender && t.state !== 'off').sort((a, b) => (a.state === 'live' ? 0 : 1) - (b.state === 'live' ? 0 : 1) || (a.starts_on ?? '').localeCompare(b.starts_on ?? '')).slice(0, 10);
  const liveDot = (n: number) => (n ? <span className="flex items-center gap-1 text-sm font-normal text-win"><span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-win motion-reduce:animate-none" />{n} live</span> : null);
  return (
    <div className="space-y-6 pb-4">
      <section className="flex flex-col gap-4 pt-1 sm:pt-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="display text-2xl leading-tight text-chalk-100 sm:text-3xl">National teams, every match since 1872</h1>
          <p className="mt-1.5 text-sm text-chalk-300">{gender === 'w' ? "The Women's World Cup, the Olympics, the continental championships and qualifiers" : 'The World Cup, the Euros, Copa América, the Gold Cup and every qualifier and friendly'}: live scores, lineups, all-time records, head to head, top scorers, caps and Plaibook Elo rankings.</p>
          <div className="mt-3"><ProSearchBox size="lg" examples={gender === 'w' ? ['USA', "Women's World Cup", 'Trinity Rodman', 'England'] : ['USA', 'World Cup', 'Christian Pulisic', 'Argentina']} /></div>
        </div>
        {d && (
          <dl className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-1 text-sm lg:text-right">
            {[['Tournaments', d.counts.tournaments], ['National teams', d.counts.nations]].map(([k, v]) => (
              <div key={k as string} className="flex flex-col-reverse"><dt className="text-2xs text-chalk-500">{k}</dt><dd className="display text-lg text-chalk-100 tnum sm:text-xl">{fmt.num(v)}</dd></div>
            ))}
          </dl>
        )}
      </section>

      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6">
          <Section title={<span className="flex items-center gap-2">{groups.length ? 'Today' : 'Next international matches'}{liveDot(live)}</span>}
            right={<Link to="/intl/matches" className="text-sm text-pitch-300 hover:text-pitch-200">Scoreboard</Link>}>
            {q.isPending && <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>}
            {d && groups.length > 0 && <Groups groups={groups} />}
            {d && !groups.length && (upcoming.length ? <MatchList rows={upcoming} /> : <p className="text-sm text-chalk-400">No international matches scheduled yet.</p>)}
          </Section>
          {recent.length > 0 && <Section title="Latest results"><MatchList rows={recent} /></Section>}
        </div>
        <aside className="space-y-5 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:self-start lg:overflow-y-auto">
          {tournaments.length > 0 && (
            <Section title="Tournaments" right={<Link to={proPath.leagues} className="text-sm text-pitch-300 hover:text-pitch-200">All</Link>}>
              <ul className="frame divide-y divide-field-700/70">
                {tournaments.map((t) => (
                  <li key={t.id}><Link to={proPath.league(t.slug, null, null, 'intl')} className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-field-800 coarse:py-2.5">
                    <TeamLogo src={t.logo} name={t.name} size={18} /><span className="min-w-0 flex-1 truncate text-chalk-100">{t.name}</span>
                    <span className={`shrink-0 text-2xs ${t.state === 'live' ? 'font-semibold text-win' : 'text-chalk-500'}`}>{when(t)}</span>
                  </Link></li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Plaibook Elo" right={<Link to="/intl/rankings" className="text-sm text-pitch-300 hover:text-pitch-200">Rankings</Link>}>
            {rank.isPending && <Skeleton lines={6} />}
            {rank.data && (rank.data.rows.length ? (
              <ol className="frame divide-y divide-field-700/70 text-sm">
                {rank.data.rows.slice(0, 10).map((r) => (
                  <li key={r.nation.key}><Link to={nationHref(r.nation)} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-field-800">
                    <span className="w-5 text-right text-xs tnum text-chalk-500">{r.rank}</span><TeamLogo src={r.nation.logo} name={r.nation.name} size={18} />
                    <span className="min-w-0 flex-1 truncate text-chalk-100">{r.nation.name}</span><span className="tnum text-chalk-300">{r.rating}</span>
                  </Link></li>
                ))}
              </ol>
            ) : <p className="text-sm text-chalk-400">Ratings appear after the first results sync.</p>)}
          </Section>
        </aside>
      </div>
    </div>
  );
}
