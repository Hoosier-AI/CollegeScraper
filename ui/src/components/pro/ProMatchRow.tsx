// One pro match in a list. Wider screens: one line, time | home | score | away (| competition), the score the thing to
// read. Phones: both clubs stacked with the score on the right.
import { Link } from 'react-router-dom';
import { TeamLogo } from '../primitives';
import { ScoreRow } from '../match/ScoreRow';
import { proPath, proWhen, type ProMatch } from '../../lib/pro';

/** `compact` is kept for callers; the row is one line at every width now. */
export function ProMatchRow({ m, showDate, showLeague }: { m: ProMatch; showDate?: boolean; showLeague?: boolean; compact?: boolean }) {
  const live = m.status === 'live', final = m.status === 'final';
  const when = proWhen(m);
  const pens = final && m.pen[0] != null && m.pen[1] != null;
  return (
    <ScoreRow to={proPath.match(m.slug, m.league.scope)} label={`${m.home.name} ${m.home.score ?? ''} ${m.away.name} ${m.away.score ?? ''}, ${when}`}
      when={when} date={showDate && !live ? new Date(m.kickoff).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null} live={live} played={live || final}
      home={{ name: m.home.name, logo: m.home.logo, score: m.home.score, won: final && m.winner === 'home' }} away={{ name: m.away.name, logo: m.away.logo, score: m.away.score, won: final && m.winner === 'away' }}
      sub={pens ? `pens ${m.pen[0]}-${m.pen[1]}` : null}
      meta={showLeague ? `${m.league.name}${m.round ? `, ${m.round.replace(/^Regular Season - /, 'round ')}` : ''}` : null} />
  );
}

export function LeagueHeading({ league, right }: { league: ProMatch['league']; right?: React.ReactNode }) {
  return (
    <div className="band font-medium text-chalk-200">
      <TeamLogo src={league.logo} name={league.name} size={18} />
      <Link to={proPath.league(league.slug, null, null, league.scope)} title={`${league.country && league.country !== 'World' ? `${league.country}: ` : ''}${league.name}`} className="min-w-0 flex-1 truncate hover:text-chalk-100 coarse:py-2">{league.country && league.country !== 'World' ? `${league.country}: ` : ''}{league.name}</Link>
      {right && <span className="shrink-0">{right}</span>}
    </div>
  );
}
