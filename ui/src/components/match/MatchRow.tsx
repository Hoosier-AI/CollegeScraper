// One match in a list: the moment (minute, kickoff or FT) on the left, both sides stacked, the score on the right.
import { Link } from 'react-router-dom';
import { networkShort, type Broadcast } from '../../lib/tv';
import { fmt } from '../../lib/api';
import { useHref } from '../../lib/filters';
import { TeamLogo } from '../primitives';
import { ScoreRow } from './ScoreRow';
import type { MatchWeather } from './Weather';
import { liveClock } from '../../lib/liveClock';

export interface MatchLike {
  id: string; status: string; start_epoch: number | null; game_date: string; conference_game: boolean; tournament: string | null; neutral_site: boolean; forfeit: boolean; overtime: boolean; shootout: boolean; division: string | null;
  /** Tournament games: the round ("Semifinal") and who went through a level game on penalties. */
  tournament_round?: string | null; shootout_winner?: string | null; postseason?: boolean;
  home: { program_id: string | null; name: string | null; short_name?: string | null; seo?: string | null; logo: string | null; rank: number | null; score: number | null; seed?: number | null; conference?: { short: string | null; name: string } | null };
  away: { program_id: string | null; name: string | null; short_name?: string | null; seo?: string | null; logo: string | null; rank: number | null; score: number | null; seed?: number | null; conference?: { short: string | null; name: string } | null };
  live: { period: string | null; clock: string | null } | null;
  /** Its day is over (or kickoff was hours ago) and no result has come in. */
  result_pending?: boolean;
  venue?: { name: string | null; city: string | null } | null;
  weather?: MatchWeather | null;
  /** Where it is shown and the school's watch link (src/normalize/networks.ts). */
  broadcast?: Broadcast | null;
}

/** The minute being played ("86′", "Half time"), for places with room for one word. */
export function liveMinute(live: { period: string | null; clock: string | null } | null): string {
  return liveClock(live).minute;
}

export function MatchRow({ g, showDate, dense }: { g: MatchLike; showDate?: boolean; dense?: boolean }) {
  const href = useHref();
  const live = g.status === 'live';
  const final = g.status === 'final';
  const hs = g.home.score, as = g.away.score;
  // A level knockout game: the side that went through on penalties is the winner.
  const pkHome = final && hs === as && !!g.shootout_winner && g.shootout_winner === g.home.program_id;
  const pkAway = final && hs === as && !!g.shootout_winner && g.shootout_winner === g.away.program_id;
  const homeWin = (final && hs != null && as != null && hs > as) || pkHome, awayWin = (final && hs != null && as != null && as > hs) || pkAway;
  const pending = !!g.result_pending;
  const clock = liveClock(g.live);
  const when = live ? clock.minute : final ? 'FT' : pending ? 'No result' : g.status === 'scheduled' ? (fmt.kickoff(g.start_epoch) ?? 'TBD') : g.status === 'postponed' ? 'PPD' : g.status === 'cancelled' ? 'CANC' : g.status;
  const tag = g.tournament ? (g.tournament_round ? `${g.tournament}, ${g.tournament_round.toLowerCase()}` : g.tournament) : (g.conference_game ? (g.home.conference?.short ?? g.home.conference?.name ?? 'Conference') : null);
  const side = (x: MatchLike['home'], won: boolean) => ({ name: x.short_name ?? x.name ?? 'TBD', logo: x.logo, seo: x.seo, score: x.score, rank: x.rank, seed: x.seed, won });
  const how = final ? (g.forfeit ? 'forfeit' : g.shootout ? 'pens' : g.overtime ? 'extra time' : null) : null;
  const meta = dense ? null : [!final && g.broadcast?.network ? networkShort(g.broadcast.network) : null, tag, g.neutral_site ? 'neutral site' : null].filter(Boolean).join(' · ');
  return (
    <ScoreRow to={href(`/matches/${g.id}`)} label={`${g.home.name ?? 'TBD'} ${hs ?? ''} ${g.away.name ?? 'TBD'} ${as ?? ''}, ${live ? clock.long : when}`}
      when={when} date={showDate && !live ? fmt.day(g.game_date) : null} live={live} played={live || final} home={side(g.home, homeWin)} away={side(g.away, awayWin)}
      sub={live ? clock.detail : how} meta={meta || null} title={pending ? 'The result has not been reported yet' : g.status === 'scheduled' ? fmt.kickoffEt(g.start_epoch) ?? undefined : undefined} />
  );
}

/** A match in a page's rail: the two sides on two lines (away over home, as college lists them), the score or the
 *  kickoff on the right. Narrow enough for a 20rem column. */
export function RailMatch({ g, href }: { g: MatchLike; href: string }) {
  const done = g.status === 'final' || g.status === 'live';
  const side = (x: MatchLike['home'], other: MatchLike['home']) => (
    <span className="flex min-w-0 items-center gap-2">
      <TeamLogo src={x.logo} seo={x.seo} name={x.name} size={18} />
      {x.rank != null && <span className="text-2xs text-chalk-500 tnum">{x.rank}</span>}
      <span className={`truncate ${done && (x.score ?? 0) > (other.score ?? 0) ? 'font-semibold text-chalk-100' : 'text-chalk-200'}`}>{x.short_name ?? x.name ?? 'TBD'}</span>
      {done && <span className="ml-auto pl-2 tnum text-chalk-100">{x.score ?? '–'}</span>}
    </span>
  );
  const when = g.start_epoch ? new Date(g.start_epoch * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : new Date(`${g.game_date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <Link to={href} className="grid grid-cols-[1fr_auto] items-center gap-x-3 px-3 py-2 text-sm hover:bg-field-800">
      <span className="min-w-0 space-y-1">{side(g.away, g.home)}{side(g.home, g.away)}</span>
      {!done && <span className="text-right text-2xs text-chalk-400">{when}</span>}
      {g.status === 'live' && <span className="text-right text-2xs font-semibold text-win">Live</span>}
    </Link>
  );
}
