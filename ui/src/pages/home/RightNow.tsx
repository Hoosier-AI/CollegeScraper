// What is happening now for the chosen gender: matches in play, the day's slate by division, the next kickoff,
// and how complete and fresh the data is.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { useHref, genderLabel } from '../../lib/filters';
import { todayEastern } from '../../lib/dates';
import { Skeleton } from '../../components/primitives';
import type { Scope } from './Panel';

interface Meta { currentSeason: number; last_completed_runs: Record<string, string> }
interface Status { season: number; programs: number; games: number; finals: number }

export function RightNow({ scope }: { scope: Scope }) {
  const href = useHref();
  const today = todayEastern();
  const meta = useQuery({ queryKey: ['v1meta'], queryFn: () => api<Meta>('/v1/meta') });
  const status = useQuery({ queryKey: ['v1status', scope.season], queryFn: () => api<Status>(`/v1/status${qs({ season: scope.season })}`) });
  const day = useQuery({
    queryKey: ['home-day', today, scope.gender],
    queryFn: () => api<any>(`/api/matches${qs({ date: today, gender: scope.gender })}`),
    refetchInterval: (x) => ((x.state.data?.live ?? 0) > 0 ? 30_000 : 120_000),
  });
  const games: any[] = day.data?.games ?? [];
  const byDiv = useMemo(() => ['d1', 'd2', 'd3'].map((d) => ({ d, n: games.filter((g) => g.division === d).length })), [games]);
  const next = useMemo(() => {
    const now = Date.now() / 1000;
    return games.filter((g) => g.status === 'scheduled' && !g.kickoff_tbd && !g.result_pending && g.start_epoch > now).sort((a, b) => a.start_epoch - b.start_epoch)[0] ?? null;
  }, [games]);
  const freshest = useMemo(() => Object.values(meta.data?.last_completed_runs ?? {}).filter(Boolean).sort().at(-1) ?? null, [meta.data]);
  const live = day.data?.live ?? 0;
  return (
    <aside aria-label="Right now" className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-chalk-100">Right now, {genderLabel(scope.gender)}</h2>
        {freshest && <span className="text-2xs text-chalk-500">updated {fmt.agoWords(freshest)}</span>}
      </div>
      {day.isPending ? <Skeleton className="mt-3 h-16" /> : (
        <>
          <Link to={href('/matches', { gender: scope.gender, division: null })} className="mt-3 flex items-center gap-3 rounded-lg p-1 -m-1 hover:bg-field-800/60">
            <span className={`display text-4xl tnum ${live ? 'text-win' : 'text-chalk-100'}`}>{live || games.length}</span>
            <span className="text-sm leading-tight text-chalk-300">
              {live ? <span className="inline-flex items-center gap-1.5 font-semibold text-win"><span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-win motion-reduce:animate-none" />live now</span> : 'matches today'}
              <span className="block text-xs text-chalk-500">{live ? `${games.length} today: ` : ''}{byDiv.map((x) => `${x.d.toUpperCase()} ${x.n}`).join(', ')}</span>
            </span>
          </Link>
          <div className="mt-3 border-t border-field-700 pt-3 text-sm">
            {next ? (
              <Link to={href(`/matches/${next.id}`)} className="block rounded -m-1 p-1 hover:bg-field-800/60">
                <span className="text-xs text-chalk-500">Next kickoff, {fmt.kickoff(next.start_epoch)}</span>
                <span className="block truncate text-chalk-100">{next.home.name} v {next.away.name}</span>
              </Link>
            ) : <span className="text-chalk-400">{games.length ? 'No more kickoffs today.' : 'No matches today.'}</span>}
          </div>
        </>
      )}
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-field-700 pt-3">
        {[['Programs', status.data?.programs], ['Games', status.data?.games], ['Results in', status.data?.finals]].map(([label, v]) => (
          <div key={label as string} className="min-w-0"><dt className="text-2xs text-chalk-500">{label}</dt><dd className="display text-lg tnum text-chalk-100">{v == null ? <Skeleton className="h-5 w-12" /> : fmt.num(v)}</dd></div>
        ))}
      </dl>
    </aside>
  );
}
