// The college team page's rail: where the team stands (live RPI, Plaibook Elo, its conference), who scores for it, and
// its news. Beside the tabs on wide screens, under them on narrow ones.

import { PostseasonCard } from '../../components/SimOdds';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { useFilters } from '../../lib/filters';
import { RailNews } from '../../components/news/News';
import { PlayerAvatar, RailCard, RailRow, TeamLogo } from '../../components/primitives';

type Href = (p: string, o?: Record<string, string | number | null | undefined>) => string;
interface Rpi { division: string; rank: number | null; rank_yesterday: number | null; official_rank: number | null; rpi: number; wp: number; owp: number; oowp: number; history: { day: string; rpi: number; rank: number | null }[] }
interface Elo { rating: number; rank: number | null; division: string | null; change_30d: number | null; history: { day: string; rating: number }[] }

export function TeamRail({ t, id, season, roster, href, news = true }: { t: any; id: string; season: number; roster: any[] | undefined; href: Href; news?: boolean }) {
  const { currentSeason } = useFilters();
  const rpi = useQuery({ queryKey: ['program-rpi', id, season], queryFn: () => api<{ rpi: Rpi | null }>(`/api/programs/${id}/rpi${qs({ season })}`), staleTime: 60_000 });
  const elo = useQuery({ queryKey: ['program-elo', id], queryFn: () => api<{ elo: Elo | null }>(`/api/programs/${id}/elo`), staleTime: 300_000, enabled: season === currentSeason });
  const rp = rpi.data?.rpi, el = season === currentSeason ? elo.data?.elo : null;
  const scorers = [...(roster ?? [])].filter((r) => (r.stats?.points ?? 0) > 0).sort((a, b) => (b.stats.points - a.stats.points) || (b.stats.goals - a.stats.goals)).slice(0, 5);
  // Three rows of the conference table around this team (the top three when it leads).
  const table: any[] = t.conferenceTable ?? [];
  const at = table.findIndex((r) => r.program_id === id);
  const around = at < 0 ? [] : table.slice(Math.max(0, Math.min(at - 1, table.length - 3)), Math.max(0, Math.min(at - 1, table.length - 3)) + 3);
  return (
    <>
      {season === currentSeason && <PostseasonCard program={id} season={season} />}
      {rp && (
        <RailCard title="Live RPI" to={href('/rankings', { tab: 'rpi', division: rp.division })} toLabel="Full table">
          <div className="flex items-end gap-3">
            <span className="display text-3xl leading-none text-chalk-100 tnum">{rp.rank ?? '–'}</span>
            <span className="pb-0.5 text-xs text-chalk-400">in {rp.division.toUpperCase()}, RPI {rp.rpi.toFixed(4)}</span>
            {rp.rank_yesterday != null && rp.rank != null && rp.rank_yesterday !== rp.rank && <span className={`ml-auto pb-0.5 text-xs ${rp.rank < rp.rank_yesterday ? 'text-win' : 'text-loss'}`}>{rp.rank < rp.rank_yesterday ? 'up' : 'down'} {Math.abs(rp.rank_yesterday - rp.rank)}</span>}
          </div>
          {rp.history.length > 1 && <div className="mt-2"><RankTrend points={rp.history} /></div>}
          <p className="mt-1 text-2xs text-chalk-500 tnum">Win % {rp.wp.toFixed(3)}, opponents' {rp.owp.toFixed(3)}, theirs {rp.oowp.toFixed(3)}{rp.official_rank != null ? `. NCAA's last list: ${rp.official_rank}` : ''}</p>
        </RailCard>
      )}
      {el && (
        <RailCard title="Plaibook Elo" to={href('/rankings', { tab: 'elo', division: el.division })} toLabel="Full ranking">
          <div className="flex items-end gap-3">
            <span className="display text-3xl leading-none text-chalk-100 tnum">{el.rank ?? '–'}</span>
            <span className="pb-0.5 text-xs text-chalk-400">in {String(el.division ?? '').toUpperCase()}, rating {Math.round(el.rating)}</span>
            {el.change_30d != null && el.change_30d !== 0 && <span className={`ml-auto pb-0.5 text-xs tnum ${el.change_30d > 0 ? 'text-win' : 'text-loss'}`}>{el.change_30d > 0 ? '+' : ''}{Math.round(el.change_30d)} in 30 days</span>}
          </div>
          {el.history.length > 1 && <div className="mt-2"><RatingTrend points={el.history} /></div>}
        </RailCard>
      )}
      {scorers.length > 0 && (
        <RailCard title="Top scorers" to={href(`/teams/${id}`, { tab: null })} toLabel="Roster">
          <ol className="space-y-0.5">
            {scorers.map((r, i) => (
              <RailRow key={r.player?.id ?? i} to={href(`/players/${r.player?.id}`)}
                left={<><span className="w-3 text-2xs text-chalk-500 tnum">{i + 1}</span><PlayerAvatar src={r.headshot_url ?? r.player?.headshot_url} name={r.player?.display_name} size={20} /><span className="truncate">{r.player?.display_name}</span></>}
                right={<span title={`${r.stats.goals ?? 0} goals, ${r.stats.assists ?? 0} assists`}>{r.stats.goals ?? 0}<span className="text-chalk-500">G</span> {r.stats.assists ?? 0}<span className="text-chalk-500">A</span></span>} />
            ))}
          </ol>
        </RailCard>
      )}
      {around.length > 0 && (
        <RailCard title={t.season?.college_conferences?.name ?? 'Conference'} to={href(`/conferences/${t.season?.conference_id}`)} toLabel="Table">
          <ol className="space-y-0.5">
            {around.map((r) => (
              <RailRow key={r.program_id} to={href(`/teams/${r.program_id}`)}
                left={<><span className="w-4 text-2xs text-chalk-500 tnum">{r.rank}</span><TeamLogo src={r.college_programs?.college_schools?.logo_svg_url} name={r.college_programs?.name} size={18} /><span className={`truncate ${r.program_id === id ? 'font-semibold text-pitch-300' : ''}`}>{r.college_programs?.name}</span></>}
                right={<>{fmt.rec(r.conf_w, r.conf_l, r.conf_t)}<span className="ml-2 inline-block w-10 text-right text-chalk-100">{r.conf_pts ?? '–'} <span className="text-2xs text-chalk-500">pts</span></span></>} />
            ))}
          </ol>
        </RailCard>
      )}
      {news && <RailNews q={{ program: id }} hide={`program:${id}`} to={href(`/teams/${id}`, { tab: 'news' })} />}
    </>
  );
}

/** A team's Plaibook Elo after each day it played this season. */
export function RatingTrend({ points }: { points: { day: string; rating: number }[] }) {
  const w = 280, h = 56, max = Math.max(...points.map((p) => p.rating)), min = Math.min(...points.map((p) => p.rating));
  const x = (i: number) => (i / (points.length - 1)) * (w - 8) + 4, y = (r: number) => (max === min ? h / 2 : 4 + ((max - r) / (max - min)) * (h - 8));
  const first = points[0]!, last = points[points.length - 1]!;
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" role="img" aria-label={`Elo rating from ${Math.round(first.rating)} on ${first.day} to ${Math.round(last.rating)} now`}>
        <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-pitch-400" points={points.map((p, i) => `${x(i)},${y(p.rating)}`).join(' ')} />
      </svg>
      <figcaption className="flex justify-between text-2xs text-chalk-500 tnum"><span>{first.day.slice(5)}: {Math.round(first.rating)}</span><span>high {Math.round(max)}</span><span>now {Math.round(last.rating)}</span></figcaption>
    </figure>
  );
}

/** A team's RPI rank day by day this season (higher on the chart is better). */
export function RankTrend({ points }: { points: { day: string; rank: number | null }[] }) {
  const pts = points.filter((p) => p.rank != null) as { day: string; rank: number }[];
  if (pts.length < 2) return null;
  const w = 280, h = 56, max = Math.max(...pts.map((p) => p.rank)), min = Math.min(...pts.map((p) => p.rank));
  const x = (i: number) => (i / (pts.length - 1)) * (w - 8) + 4, y = (r: number) => (max === min ? h / 2 : 4 + ((r - min) / (max - min)) * (h - 8));
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" role="img" aria-label={`RPI rank from ${pts[0]!.rank} on ${pts[0]!.day} to ${pts[pts.length - 1]!.rank} now`}>
        <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-pitch-400" points={pts.map((p, i) => `${x(i)},${y(p.rank)}`).join(' ')} />
      </svg>
      <figcaption className="flex justify-between text-2xs text-chalk-500"><span>{pts[0]!.day.slice(5)}: No. {pts[0]!.rank}</span><span>best No. {min}</span><span>now No. {pts[pts.length - 1]!.rank}</span></figcaption>
    </figure>
  );
}

