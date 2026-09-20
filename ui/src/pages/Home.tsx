// The front door: find a team. Everything shown here comes from the same /v1 routes anyone can call.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api, fmt, qs } from '../lib/api';
import { SearchBox } from '../components/SearchBox';
import { Skeleton, TeamLogo } from '../components/primitives';
import { MatchRow } from '../components/match/MatchRow';
import { todayEastern, longDay } from '../lib/dates';

interface Meta { seasons: number[]; currentSeason: number; conferences: { id: string }[]; last_completed_runs: Record<string, string>; limits?: { anon_per_min: number; key_per_min: number } }
interface Status { season: number; programs: number; games: number; finals: number }

export default function Home() {
  const meta = useQuery({ queryKey: ['v1meta'], queryFn: () => api<Meta>('/v1/meta') });
  const season = meta.data?.currentSeason;
  const status = useQuery({ queryKey: ['v1status', season], queryFn: () => api<Status>(`/v1/status${qs({ season })}`), enabled: !!season });
  const freshest = useMemo(() => Object.values(meta.data?.last_completed_runs ?? {}).filter(Boolean).sort().at(-1) ?? null, [meta.data]);
  return (
    <div className="space-y-12 pb-4">
      <section className="max-w-2xl pt-6 sm:pt-14">
        <h1 className="display text-4xl leading-none text-chalk-100 sm:text-[3.75rem] sm:leading-none">Every NCAA soccer team, checked twice.</h1>
        <p className="mt-4 max-w-xl text-base text-chalk-300 sm:text-lg">Rosters, results, season stats, official conference tables and the coaches' poll for Division I, II and III, men's and women's, compared against each school's own numbers and NCAA.com.</p>
        <div className="mt-6"><SearchBox size="lg" placeholder="Find a team or player" examples={['Stanford', 'Duke', 'Messiah', 'Wake Forest']} /></div>
        <p className="mt-3 text-sm text-chalk-500">
          {status.data && season ? <>{fmt.num(status.data.programs)} programs and {fmt.num(status.data.games)} games this season{freshest ? `, updated ${fmt.agoWords(freshest)}` : ''}.</> : <Skeleton className="inline-block h-4 w-72 align-middle" />}
        </p>
      </section>

      <TodayModule />

      <section className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div>
          <h2 className="text-base font-semibold text-chalk-100">This week's poll</h2>
          <p className="mb-3 text-sm text-chalk-400">The latest United Soccer Coaches top five, Division I. <Link className="text-pitch-400 hover:text-pitch-300" to="/rankings">Every division and week</Link></p>
          <div className="grid gap-4 sm:grid-cols-2">
            <PollTop gender="m" season={season} />
            <PollTop gender="w" season={season} />
          </div>
        </div>
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-chalk-100">Find your division</h2>
            <p className="mb-3 text-sm text-chalk-400">Teams, standings and leaders by division.</p>
            <div className="grid grid-cols-2 gap-2">
              {(['m', 'w'] as const).map((g) => (
                <div key={g} className="frame p-3">
                  <div className="mb-2 text-xs font-medium text-chalk-500">{g === 'm' ? "Men's" : "Women's"}</div>
                  <div className="flex flex-col gap-1">
                    {['d1', 'd2', 'd3'].map((d) => <Link key={d} className="chip justify-between" to={`/teams?gender=${g}&division=${d}`}>Division {d === 'd1' ? 'I' : d === 'd2' ? 'II' : 'III'}<span className="text-chalk-500">teams</span></Link>)}
                    <Link className="chip justify-between" to={`/rankings?gender=${g}`}>Standings</Link>
                    <Link className="chip justify-between" to={`/rankings?gender=${g}&view=leaders`}>Leaders</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="frame p-4 text-sm text-chalk-300">
            <h2 className="text-base font-semibold text-chalk-100">How the numbers are checked</h2>
            <p className="mt-2 leading-relaxed">Each school's athletics site supplies rosters, schedules and box scores; NCAA.com is stored alongside as a second source for every game. Conference tables are read from the conference's own page and compared, row by row, with the record computed from stored results. Where they disagree, the page says so.</p>
            <p className="mt-2 leading-relaxed">The same data is available as a <Link className="text-pitch-400 hover:text-pitch-300" to="/docs">read API with no key required</Link>{meta.data?.limits ? ` (${meta.data.limits.anon_per_min} requests a minute)` : ''}.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function PollTop({ gender, season }: { gender: 'm' | 'w'; season: number | undefined }) {
  const q = useQuery({ queryKey: ['home-poll', gender, season], queryFn: () => api<any>(`/api/rankings${qs({ season, gender, division: 'd1' })}`), enabled: !!season });
  const rows: any[] = (q.data?.rows ?? []).filter((r: any) => !String(r.label ?? '').endsWith('(RV)')).slice(0, 5);
  const week = q.data?.weeks?.find((w: any) => w.week_of === q.data?.week);
  return (
    <div className="frame">
      <div className="flex items-baseline justify-between px-3 py-2"><span className="text-sm font-medium text-chalk-100">{gender === 'm' ? "Men's" : "Women's"}</span>{week && <span className="text-xs text-chalk-500">{week.label}, {fmt.day(week.week_of)}</span>}</div>
      {q.isPending && <div className="space-y-2 px-3 pb-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-5" />)}</div>}
      {q.data && !rows.length && <p className="px-3 pb-3 text-sm text-chalk-500">No poll yet this season.</p>}
      <ol className="divide-y divide-field-700">
        {rows.map((r) => {
          const d = r.previous_rank != null ? r.previous_rank - r.rank : null;
          return (
            <li key={r.id}>
              <Link to={r.college_programs ? `/teams/${r.college_programs.id}?season=${season}&gender=${gender}` : '/rankings'} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-field-800">
                <span className="display w-5 text-right text-lg text-chalk-100 tnum">{r.rank}</span>
                <TeamLogo src={r.college_programs?.college_schools?.logo_svg_url} name={r.college_programs?.name} size={22} />
                <span className="flex-1 truncate font-medium text-chalk-100">{r.college_programs?.name ?? r.subject_name}</span>
                <span className="text-xs text-chalk-400 tnum">{r.record}</span>
                <span className="w-8 text-right text-xs tnum">{d == null ? <span className="text-note">new</span> : d > 0 ? <span className="inline-flex items-center text-win"><ArrowUp size={12} />{d}</span> : d < 0 ? <span className="inline-flex items-center text-loss"><ArrowDown size={12} />{-d}</span> : <span className="text-chalk-500">–</span>}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Today's matches at a glance: live ones first, then the next kickoffs. */
function TodayModule() {
  const today = todayEastern();
  const q = useQuery({ queryKey: ['home-today', today], queryFn: () => api<any>(`/api/matches${qs({ date: today, division: 'd1' })}`), refetchInterval: (x) => ((x.state.data?.live ?? 0) > 0 ? 60_000 : false) });
  const games: any[] = q.data?.games ?? [];
  const shown = [...games.filter((g) => g.status === 'live'), ...games.filter((g) => g.status === 'scheduled'), ...games.filter((g) => g.status === 'final')].slice(0, 6);
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-chalk-100">Today, Division I</h2>
        <Link className="text-sm text-pitch-400 hover:text-pitch-300" to="/matches">All matches</Link>
      </div>
      <p className="mb-3 text-sm text-chalk-400">{q.data ? (games.length ? `${games.length} matches on ${longDay(today)}${q.data.live ? `, ${q.data.live} live now` : ''}.` : `No Division I matches on ${longDay(today)}.`) : <Skeleton className="inline-block h-4 w-64 align-middle" />}</p>
      {shown.length > 0 && <div className="frame divide-y divide-field-700">{shown.map((g) => <MatchRow key={g.id} g={g} dense />)}</div>}
    </section>
  );
}
