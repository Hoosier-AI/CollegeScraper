// Americans abroad: one American's line in a club match outside the US (the home page strip and /pro/abroad).
import { Link } from 'react-router-dom';
import { proPath, type ProMatch } from '../../lib/pro';
import { PlayerAvatar, TeamLogo } from '../primitives';

export interface AbroadLine {
  player: { id: number; name: string; slug: string; photo: string | null; position: string | null };
  match: ProMatch; team_id: number; minutes: number; goals: number; assists: number; rating: number | null; starter: boolean;
}
export interface AbroadUpcoming { match: ProMatch; team_id: number; players: { id: number; name: string; slug: string; photo: string | null }[] }
export interface AbroadData { at: string | null; lines: AbroadLine[]; upcoming: AbroadUpcoming[] }

const ratingTone = (v: number) => (v >= 8 ? 'bg-win/20 text-win' : v >= 7 ? 'bg-pitch-400/15 text-pitch-300' : v >= 6.3 ? 'bg-note/15 text-note' : 'bg-loss/15 text-loss');
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** The player, his club and the match: minutes, goals, assists and rating against whom, with the score. */
export function AbroadCard({ l }: { l: AbroadLine }) {
  const home = l.match.home.id === l.team_id;
  const club = home ? l.match.home : l.match.away, opp = home ? l.match.away : l.match.home;
  const us = club.score ?? 0, them = opp.score ?? 0;
  const res = us > them ? 'W' : us < them ? 'L' : 'D';
  const contribution = [l.goals ? `${l.goals} ${l.goals === 1 ? 'goal' : 'goals'}` : '', l.assists ? `${l.assists} ${l.assists === 1 ? 'assist' : 'assists'}` : ''].filter(Boolean).join(', ');
  return (
    <li className="frame flex items-center gap-3 p-2.5">
      <PlayerAvatar src={l.player.photo} name={l.player.name} size={40} />
      <div className="min-w-0 flex-1">
        <Link to={proPath.player(l.player.slug)} className="block truncate text-sm font-medium text-chalk-100 hover:text-pitch-300">{l.player.name}</Link>
        <span className="flex items-center gap-1.5 text-xs text-chalk-400">
          <TeamLogo src={club.logo} name={club.name} size={14} /><span className="truncate">{club.name}</span>
        </span>
        <Link to={proPath.match(l.match.slug)} className="mt-0.5 block truncate text-2xs text-chalk-500 hover:text-chalk-300">
          <span className={res === 'W' ? 'text-win' : res === 'L' ? 'text-loss' : 'text-draw'}>{res} {us}–{them}</span> {home ? 'v' : 'at'} {opp.name}, {shortDate(l.match.kickoff)}
        </Link>
      </div>
      <div className="shrink-0 text-right">
        {contribution ? <span className="block text-xs font-semibold text-chalk-100">{contribution}</span> : <span className="block text-xs text-chalk-400">{l.minutes}′</span>}
        {contribution && <span className="block text-2xs text-chalk-500 tnum">{l.minutes}′</span>}
        {l.rating != null && <span className={`mt-0.5 inline-block rounded px-1 text-2xs font-semibold tnum ${ratingTone(l.rating)}`}>{l.rating.toFixed(1)}</span>}
      </div>
    </li>
  );
}
