// One pro match in a list: the moment on the left (minute, FT, kickoff), both clubs stacked, the score on the right.
// Same layout as the college MatchRow so the two halves of the site read alike.
import { Link } from 'react-router-dom';
import { Badge, TeamLogo } from '../primitives';
import { proPath, proWhen, type ProMatch } from '../../lib/pro';

function Side({ s, winner, loser }: { s: ProMatch['home']; winner: boolean; loser: boolean }) {
  return (
    <span className={`flex min-w-0 items-center gap-2 ${loser ? 'text-chalk-400' : 'text-chalk-100'}`}>
      <TeamLogo src={s.logo} name={s.name} size={22} />
      <span className={`truncate ${winner ? 'font-semibold' : 'font-medium'}`}>{s.name}</span>
    </span>
  );
}

export function ProMatchRow({ m, showDate, showLeague }: { m: ProMatch; showDate?: boolean; showLeague?: boolean }) {
  const live = m.status === 'live', final = m.status === 'final';
  const homeWin = final && m.winner === 'home', awayWin = final && m.winner === 'away';
  const when = proWhen(m);
  const pens = final && m.pen[0] != null && m.pen[1] != null;
  return (
    <Link to={proPath.match(m.slug)} className="flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-field-800 coarse:min-h-[64px]"
      aria-label={`${m.home.name} ${m.home.score ?? ''} ${m.away.name} ${m.away.score ?? ''}, ${when}`}>
      <span className={`w-14 shrink-0 text-center text-xs tnum ${live ? 'font-semibold text-win' : 'text-chalk-500'}`}>
        {live && <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-win align-middle motion-reduce:animate-none" />}
        {showDate && !live && <span className="block text-2xs">{new Date(m.kickoff).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
        <span className="block">{when}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <Side s={m.home} winner={homeWin} loser={awayWin} />
        <Side s={m.away} winner={awayWin} loser={homeWin} />
      </span>
      {showLeague && <span className="hidden max-w-[10rem] shrink-0 truncate text-right text-2xs text-chalk-500 sm:block">{m.league.name}{m.round ? ` · ${m.round}` : ''}</span>}
      <span className="flex shrink-0 flex-col items-end gap-1 text-sm tnum">
        {live || final ? <>
          <span className={homeWin ? 'font-semibold text-chalk-100' : awayWin ? 'text-chalk-400' : 'text-chalk-100'}>{m.home.score ?? '–'}{pens && <span className="ml-1 text-2xs text-chalk-500">({m.pen[0]})</span>}</span>
          <span className={awayWin ? 'font-semibold text-chalk-100' : homeWin ? 'text-chalk-400' : 'text-chalk-100'}>{m.away.score ?? '–'}{pens && <span className="ml-1 text-2xs text-chalk-500">({m.pen[1]})</span>}</span>
        </> : <span className="text-chalk-500">–</span>}
      </span>
      {final && m.status_short === 'AET' && <Badge className="hidden sm:inline-flex">AET</Badge>}
    </Link>
  );
}

export function LeagueHeading({ league, right }: { league: ProMatch['league']; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-2xs font-medium text-chalk-400">
      <TeamLogo src={league.logo} name={league.name} size={16} chip={false} fallback="blank" />
      <Link to={proPath.league(league.slug)} className="truncate hover:text-chalk-100">{league.country && league.country !== 'World' ? `${league.country}: ` : ''}{league.name}</Link>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}
