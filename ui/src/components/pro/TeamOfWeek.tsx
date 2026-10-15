// Team of the week on a competition page: a round's best-rated XI in a 4-3-3 (API-Football's match ratings, 45 minutes
// or more), on a pitch with each club's crest, the player of the round, and the list with ratings and the match each
// came from. A round picker goes back through the season. Competitions without ratings never show the tab.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { proPath, type ProTeamRef } from '../../lib/pro';
import { EmptyState, ErrorBox, PlayerAvatar, Select, Skeleton, TeamLogo } from '../primitives';
import { XIPitch, type ProLine } from './MatchParts';

export interface TotwLine { player_id: number | null; name: string; display: string; slug: string | null; photo: string | null; pos: 'G' | 'D' | 'M' | 'F'; rating: number; minutes: number; goals: number; assists: number; best: boolean; grid: string; fixture_slug: string; team: ProTeamRef | null }
export interface Totw { round: string | null; rounds: { round: string; first_at: string; last_at: string; matches: number }[]; xi: TotwLine[] }

export const totwUrl = (league: number, season: number, round?: string | null) => `/api/pro/leagues/${league}/team-of-week${qs({ season, round: round || undefined })}`;
const POS: Record<string, string> = { G: 'Goalkeeper', D: 'Defender', M: 'Midfielder', F: 'Forward' };
const roundName = (r: string) => r.replace(/^Regular Season\s*-\s*/i, 'Round ');

export function TeamOfWeek({ league, season, round, onRound }: { league: number; season: number; round: string; onRound: (r: string) => void }) {
  const q = useQuery({ queryKey: ['totw', league, season, round], queryFn: () => api<Totw>(totwUrl(league, season, round)), staleTime: 300_000 });
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-96" />;
  const d = q.data!;
  if (!d.round || !d.xi.length) return <EmptyState title="No team of the week" body="It needs player ratings, which this competition's matches do not have." />;
  const lines: ProLine[] = d.xi.map((x, i) => ({ slot: i, player_id: x.player_id, name: x.name, display: x.display, slug: x.slug, photo: x.photo, number: null, pos: x.pos, grid: x.grid, starter: true, captain: false, minutes: x.minutes, rating: x.rating, goals: x.goals, assists: x.assists, yellow: null, red: null, saves: null, conceded: null, shots: null, shots_on: null, passes: null, key_passes: null, tackles: null }));
  const crests = new Map(d.xi.map((x, i) => [i, x.team?.logo ?? null]));
  const best = d.xi.find((x) => x.best);
  const meta = d.rounds.find((r) => r.round === d.round);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-chalk-300">The best-rated XI of {roundName(d.round)}{meta ? `, ${meta.matches} matches` : ''}, in a 4-3-3: ratings from the match data, 45 minutes or more.</p>
        {d.rounds.length > 1 && <Select aria-label="Round" className="h-9 max-w-[220px] text-sm" value={d.round} onChange={onRound} options={d.rounds.map((r) => ({ value: r.round, label: roundName(r.round) }))} />}
      </div>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <XIPitch lines={lines} crests={crests} label={`Team of the week, ${roundName(d.round)}: ${d.xi.map((x) => `${x.display} (${x.rating.toFixed(1)})`).join(', ')}`} />
        <div className="space-y-3">
          {best && (
            <div className="flex items-center gap-3 rounded-lg bg-pitch-400/10 p-3 ring-1 ring-inset ring-pitch-400/30">
              <PlayerAvatar src={best.photo} name={best.display} size={48} crest={best.team?.logo} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-2xs font-medium text-pitch-300"><Star size={12} aria-hidden />Player of the round</p>
                <p className="truncate font-semibold text-chalk-100">{best.slug ? <Link to={proPath.player(best.slug)} className="hover:text-pitch-300">{best.display}</Link> : best.display}</p>
                <p className="truncate text-xs text-chalk-400">{[best.team?.name, best.goals ? `${best.goals} goal${best.goals > 1 ? 's' : ''}` : null, best.assists ? `${best.assists} assist${best.assists > 1 ? 's' : ''}` : null].filter(Boolean).join(', ')}</p>
              </div>
              <span className="display text-2xl text-chalk-100 tnum">{best.rating.toFixed(1)}</span>
            </div>
          )}
          <ul className="frame divide-y divide-field-700 text-sm">
            {d.xi.map((x) => (
              <li key={`${x.player_id}-${x.fixture_slug}`} className="flex items-center gap-2.5 px-3 py-2">
                <span className="w-6 shrink-0 text-2xs font-semibold text-chalk-500" title={POS[x.pos]}>{x.pos}</span>
                {x.team && <TeamLogo src={x.team.logo} name={x.team.name} size={18} />}
                <span className="min-w-0 flex-1 truncate">
                  {x.slug ? <Link to={proPath.player(x.slug)} className="font-medium text-chalk-100 hover:text-pitch-300">{x.display}</Link> : <span className="font-medium text-chalk-100">{x.display}</span>}
                  <span className="text-xs text-chalk-500"> {[x.goals ? `${x.goals}G` : null, x.assists ? `${x.assists}A` : null].filter(Boolean).join(' ')}</span>
                </span>
                <Link to={proPath.match(x.fixture_slug)} className="shrink-0 text-xs text-chalk-400 hover:text-pitch-300">Match</Link>
                <span className="w-9 shrink-0 text-right font-semibold text-chalk-100 tnum">{x.rating.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
