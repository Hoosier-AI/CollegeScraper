// The college player page's rail: the latest game, where the player sits in the division (percentiles, national ranks)
// and the news. Beside the tabs on wide screens, under them on narrow ones.
import { Link } from 'react-router-dom';
import { fmt, resultOf } from '../../lib/api';
import { RailNews } from '../news/News';
import { RailCard, RailRow, ResultBadge } from '../primitives';

type Href = (p: string, o?: Record<string, string | number | null | undefined>) => string;

const FIELD: [string, string][] = [['pct_points_p90', 'Points per 90'], ['pct_goals_p90', 'Goals per 90'], ['pct_assists_p90', 'Assists per 90'], ['pct_shots_p90', 'Shots per 90']];
const KEEPER: [string, string][] = [['pct_save_pct', 'Save %'], ['pct_gaa', 'Goals against avg']];
const tone = (p: number) => (p >= 0.8 ? 'bg-win' : p >= 0.5 ? 'bg-pitch-400' : p >= 0.25 ? 'bg-note' : 'bg-loss');

export function PlayerRail({ id, latest, gameLog, keeper, own, href, news = true }: {
  id: string; latest: any; gameLog: any[]; keeper: boolean; own: (r: any) => string | undefined; href: Href; news?: boolean;
}) {
  const st = latest?.stats;
  const last = gameLog.find((r) => r.game?.status === 'final' && r.participated !== false);
  const pct = (keeper ? KEEPER : FIELD).filter(([k]) => st?.[k] != null);
  const ranks: any[] = latest?.ranks ?? [];
  return (
    <>
      {last && (() => {
        const g = last.game, home = g.home_program_id === own(last);
        const us = home ? g.home_score : g.away_score, them = home ? g.away_score : g.home_score;
        const bits = [last.goals ? `${last.goals} goal${last.goals > 1 ? 's' : ''}` : null, last.assists ? `${last.assists} assist${last.assists > 1 ? 's' : ''}` : null, keeper && last.saves ? `${last.saves} saves` : null].filter(Boolean);
        return (
          <RailCard title="Latest game" to={href(`/players/${id}`, { tab: 'matches' })} toLabel="Game log">
            <Link to={href(`/matches/${g.id}`)} className="-mx-1.5 flex items-center gap-3 rounded px-1.5 py-1 hover:bg-field-800">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-chalk-100">{home ? 'vs' : 'at'} {(home ? g.away_name : g.home_name) ?? '?'}</span>
                <span className="block text-2xs text-chalk-500">{fmt.day(g.game_date)}</span>
              </span>
              <ResultBadge result={resultOf(us, them)} us={us} them={them} />
            </Link>
            <p className="mt-1.5 text-chalk-300">{[bits.join(', ') || (last.starter ? 'Started' : 'Came on'), last.minutes != null ? `${last.minutes} min` : null].filter(Boolean).join(', ')}</p>
          </RailCard>
        );
      })()}
      {pct.length > 0 && (
        <RailCard title="In the division" to={`/compare?a=${id}`} toLabel="Compare">
          <ul className="space-y-1.5">
            {pct.map(([k, label]) => {
              const v = Number(st[k]);
              return (
                <li key={k} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2" aria-label={`${label}: ${fmt.pctile(v)} percentile`}>
                  <span className="truncate text-chalk-300">{label}</span>
                  <span className="h-2 overflow-hidden rounded bg-field-700" aria-hidden><span className={`block h-full ${tone(v)}`} style={{ width: `${Math.max(3, Math.round(v * 100))}%` }} /></span>
                  <span className="text-right text-xs tnum text-chalk-200">{fmt.pctile(v)}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-2xs text-chalk-500">Percentile within the division, {latest.season}.</p>
        </RailCard>
      )}
      {ranks.length > 0 && (
        <RailCard title={`National ranks, ${latest.season}`}>
          <ol className="space-y-0.5">
            {[...ranks].sort((a, b) => a.rank - b.rank).slice(0, 8).map((r) => (
              <RailRow key={r.category} left={<><span className="w-9 shrink-0 font-semibold text-chalk-100 tnum">{fmt.ordinal(r.rank)}</span><span className="truncate">{r.category}</span></>} right={r.value} />
            ))}
          </ol>
          <p className="mt-1.5 text-2xs text-chalk-500">NCAA.com's statistical rankings.</p>
        </RailCard>
      )}
      {news && <RailNews q={{ player: id }} hide={`college_player:${id}`} to={href(`/players/${id}`, { tab: 'news' })} />}
    </>
  );
}
