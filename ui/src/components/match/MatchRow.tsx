// One match in a list: the moment (minute, kickoff or FT) on the left, both sides stacked, the score on the right.
import { Link } from 'react-router-dom';
import { fmt } from '../../lib/api';
import { useHref } from '../../lib/filters';
import { Badge, TeamLogo } from '../primitives';
import { WeatherMini, type MatchWeather } from './Weather';
import { liveClock } from '../../lib/liveClock';

export interface MatchLike {
  id: string; status: string; start_epoch: number | null; game_date: string; conference_game: boolean; tournament: string | null; neutral_site: boolean; forfeit: boolean; overtime: boolean; shootout: boolean; division: string | null;
  home: { program_id: string | null; name: string | null; short_name?: string | null; seo?: string | null; logo: string | null; rank: number | null; score: number | null; conference?: { short: string | null; name: string } | null };
  away: { program_id: string | null; name: string | null; short_name?: string | null; seo?: string | null; logo: string | null; rank: number | null; score: number | null; conference?: { short: string | null; name: string } | null };
  live: { period: string | null; clock: string | null } | null;
  /** Its day is over (or kickoff was hours ago) and no result has come in. */
  result_pending?: boolean;
  venue?: { name: string | null; city: string | null } | null;
  weather?: MatchWeather | null;
}

/** The minute being played ("86′", "Half time"), for places with room for one word. */
export function liveMinute(live: { period: string | null; clock: string | null } | null): string {
  return liveClock(live).minute;
}

function Side({ s, winner, loser, home }: { s: MatchLike['home']; winner: boolean; loser: boolean; home?: boolean }) {
  return (
    <span className={`flex min-w-0 items-center gap-2 ${loser ? 'text-chalk-400' : 'text-chalk-100'}`}>
      <TeamLogo src={s.logo} seo={s.seo} name={s.name} size={20} />
      {s.rank && <span className="shrink-0 text-2xs text-chalk-500 tnum">No. {s.rank}</span>}
      <span className={`truncate ${winner ? 'font-semibold' : 'font-medium'}`}>{s.name ?? 'TBD'}</span>
      {home && <span className="shrink-0 text-2xs text-chalk-500">home</span>}
    </span>
  );
}

export function MatchRow({ g, showDate, dense }: { g: MatchLike; showDate?: boolean; dense?: boolean }) {
  const href = useHref();
  const live = g.status === 'live';
  const final = g.status === 'final';
  const hs = g.home.score, as = g.away.score;
  const homeWin = final && hs != null && as != null && hs > as, awayWin = final && hs != null && as != null && as > hs;
  const pending = !!g.result_pending;
  const clock = liveClock(g.live);
  const when = live ? clock.minute : final ? 'FT' : pending ? 'No result' : g.status === 'scheduled' ? (fmt.kickoff(g.start_epoch) ?? 'TBD') : g.status === 'postponed' ? 'PPD' : g.status === 'cancelled' ? 'CANC' : g.status;
  const tag = g.tournament ?? (g.conference_game ? (g.home.conference?.short ?? g.home.conference?.name ?? 'Conference') : null);
  return (
    <Link to={href(`/matches/${g.id}`)} className={`flex items-center gap-3 px-3 transition-colors duration-150 hover:bg-field-800 coarse:min-h-[60px] ${dense ? 'py-1.5' : 'py-2'}`} aria-label={`${g.home.name ?? 'TBD'} ${hs ?? ''} ${g.away.name ?? 'TBD'} ${as ?? ''}, ${live ? clock.long : when}`}>
      <span className={`w-[4.5rem] shrink-0 text-center text-xs tnum ${live ? 'font-semibold text-win' : pending ? 'text-note' : 'text-chalk-500'}`} title={live ? clock.long : pending ? 'The result has not been reported yet' : g.status === 'scheduled' ? fmt.kickoffEt(g.start_epoch) ?? undefined : undefined}>
        {showDate && !live ? <span className="block text-2xs">{fmt.day(g.game_date)}</span> : null}
        <span className="flex items-center justify-center gap-1 whitespace-nowrap">
          {live && <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-win motion-reduce:animate-none" />}
          {when}
        </span>
        {/* Live: how much of the match is left, in words ("5 min left", "Added time"). */}
        {live && clock.detail && <span className="block whitespace-nowrap text-2xs font-normal text-win/80">{clock.detail}</span>}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <Side s={g.home} winner={homeWin} loser={awayWin} home={!g.neutral_site} />
        <Side s={g.away} winner={awayWin} loser={homeWin} />
      </span>
      <span className="hidden shrink-0 flex-col items-end gap-0.5 text-right text-2xs text-chalk-500 sm:flex">
        {tag && <span>{tag}{g.neutral_site ? ', neutral' : ''}</span>}
        {!tag && g.neutral_site && <span>Neutral site</span>}
        {(g.venue?.city || (g.weather && !final)) && <span className="inline-flex items-center gap-2">{g.venue?.city && <span>{g.venue.city}</span>}{g.weather && !final && !live && <WeatherMini w={g.weather} />}</span>}
      </span>
      <span className="flex w-5 shrink-0 flex-col items-end gap-0.5 text-sm tnum">
        {live || final ? <>
          <span className={homeWin ? 'font-semibold text-chalk-100' : awayWin ? 'text-chalk-400' : 'text-chalk-100'}>{hs ?? '–'}</span>
          <span className={awayWin ? 'font-semibold text-chalk-100' : homeWin ? 'text-chalk-400' : 'text-chalk-100'}>{as ?? '–'}</span>
        </> : <span className="text-chalk-500">–</span>}
      </span>
      {final && (g.forfeit || g.shootout || g.overtime) && <Badge className="hidden sm:inline-flex">{g.forfeit ? 'Forfeit' : g.shootout ? 'PK' : 'OT'}</Badge>}
    </Link>
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
