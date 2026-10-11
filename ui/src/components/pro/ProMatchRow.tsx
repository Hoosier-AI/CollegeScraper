// One pro match in a list. Wider screens: one line, time | home | score | away (| competition), the score the thing to
// read. Phones: both clubs stacked with the score on the right.
import { Link } from 'react-router-dom';
import { TeamLogo } from '../primitives';
import { proPath, proWhen, type ProMatch } from '../../lib/pro';

function Side({ s, winner, loser }: { s: ProMatch['home']; winner: boolean; loser: boolean }) {
  return (
    <span className={`flex min-w-0 items-center gap-2 ${loser ? 'text-chalk-400' : 'text-chalk-100'}`}>
      <TeamLogo src={s.logo} name={s.name} size={22} />
      <span className={`truncate ${winner ? 'font-semibold' : 'font-medium'}`}>{s.name}</span>
    </span>
  );
}

/** compact: the stacked layout at every width (side columns). */
export function ProMatchRow({ m, showDate, showLeague, compact }: { m: ProMatch; showDate?: boolean; showLeague?: boolean; compact?: boolean }) {
  const live = m.status === 'live', final = m.status === 'final';
  const homeWin = final && m.winner === 'home', awayWin = final && m.winner === 'away';
  const when = proWhen(m);
  const pens = final && m.pen[0] != null && m.pen[1] != null;
  const played = live || final;
  // One line: the live dot beside the minute, a kickoff time without wrapping.
  const time = (
    <span className={`shrink-0 whitespace-nowrap text-center text-xs tnum ${live ? 'font-semibold text-win' : 'text-chalk-500'}`}>
      {showDate && !live && <span className="block text-2xs">{new Date(m.kickoff).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
      <span className="inline-flex items-center gap-1">
        {live && <span aria-hidden className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-win motion-reduce:animate-none" />}
        {when}
      </span>
    </span>
  );
  const goals = (side: 'home' | 'away') => {
    const won = side === 'home' ? homeWin : awayWin, lost = side === 'home' ? awayWin : homeWin;
    return <span className={won ? 'text-chalk-100' : lost ? 'text-chalk-500' : live ? 'text-win' : 'text-chalk-100'}>{m[side].score ?? '–'}</span>;
  };
  return (
    <Link to={proPath.match(m.slug)} className="block transition-colors duration-150 hover:bg-field-800"
      aria-label={`${m.home.name} ${m.home.score ?? ''} ${m.away.name} ${m.away.score ?? ''}, ${when}`}>
      {/* Phones: both clubs stacked, the score on the right. */}
      <span className={`flex items-center gap-3 px-3 py-2 coarse:min-h-[56px] ${compact ? '' : 'sm:hidden'}`}>
        <span className="w-14">{time}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <Side s={m.home} winner={homeWin} loser={awayWin} />
          <Side s={m.away} winner={awayWin} loser={homeWin} />
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-sm font-semibold tnum">
          {played ? <>{goals('home')}{goals('away')}</> : <span className="font-normal text-chalk-500">–</span>}
        </span>
      </span>
      {/* Wider screens: one line, home | score | away, the score the thing to read. */}
      <span className={`hidden items-center gap-3 px-3 py-1.5 text-sm ${compact ? '' : 'sm:grid'} ${showLeague ? 'grid-cols-[4.25rem_minmax(0,1fr)_4.5rem_minmax(0,1fr)_minmax(0,9rem)]' : 'grid-cols-[4.25rem_minmax(0,1fr)_4.5rem_minmax(0,1fr)]'}`}>
        {time}
        <span className={`flex min-w-0 items-center justify-end gap-2 text-right ${awayWin ? 'text-chalk-400' : 'text-chalk-100'}`}>
          <span className={`truncate ${homeWin ? 'font-semibold' : 'font-medium'}`}>{m.home.name}</span>
          <TeamLogo src={m.home.logo} name={m.home.name} size={20} />
        </span>
        <span className={`display rounded px-1.5 py-0.5 text-center text-base tnum ${played ? 'bg-field-950/60' : 'text-xs font-normal text-chalk-500'}`}>
          {played ? <>{goals('home')}<span className="mx-1 text-chalk-500">–</span>{goals('away')}</> : 'v'}
          {pens && <span className="block text-2xs font-normal text-chalk-500">pens {m.pen[0]}–{m.pen[1]}</span>}
          {final && m.status_short === 'AET' && !pens && <span className="block text-2xs font-normal text-chalk-500">aet</span>}
        </span>
        <span className={`flex min-w-0 items-center gap-2 ${homeWin ? 'text-chalk-400' : 'text-chalk-100'}`}>
          <TeamLogo src={m.away.logo} name={m.away.name} size={20} />
          <span className={`truncate ${awayWin ? 'font-semibold' : 'font-medium'}`}>{m.away.name}</span>
        </span>
        {showLeague && <span className="truncate text-right text-2xs text-chalk-500">{m.league.name}{m.round ? `, ${m.round.replace(/^Regular Season - /, 'round ')}` : ''}</span>}
      </span>
    </Link>
  );
}

export function LeagueHeading({ league, right }: { league: ProMatch['league']; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-2xs font-medium text-chalk-400">
      <TeamLogo src={league.logo} name={league.name} size={16} chip={false} />
      <Link to={proPath.league(league.slug)} title={`${league.country && league.country !== 'World' ? `${league.country}: ` : ''}${league.name}`} className="min-w-0 flex-1 truncate hover:text-chalk-100 coarse:py-2">{league.country && league.country !== 'World' ? `${league.country}: ` : ''}{league.name}</Link>
      {right && <span className="shrink-0">{right}</span>}
    </div>
  );
}
