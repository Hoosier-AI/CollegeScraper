// One match in a list: the moment (minute, kickoff or FT) on the left, both sides stacked, the score on the right.
import { Link } from 'react-router-dom';
import { fmt } from '../../lib/api';
import { useHref } from '../../lib/filters';
import { Badge, TeamLogo } from '../primitives';

export interface MatchLike {
  id: string; status: string; start_epoch: number | null; game_date: string; conference_game: boolean; tournament: string | null; neutral_site: boolean; forfeit: boolean; overtime: boolean; shootout: boolean; division: string | null;
  home: { program_id: string | null; name: string | null; short_name?: string | null; seo?: string | null; logo: string | null; rank: number | null; score: number | null; conference?: { short: string | null; name: string } | null };
  away: { program_id: string | null; name: string | null; short_name?: string | null; seo?: string | null; logo: string | null; rank: number | null; score: number | null; conference?: { short: string | null; name: string } | null };
  live: { period: string | null; clock: string | null } | null;
  /** Its day is over (or kickoff was hours ago) and no result has come in. */
  result_pending?: boolean;
}

/** "63′ 2H", "HT", "OT 4′" from NCAA's period + clock strings. */
export function liveMinute(live: { period: string | null; clock: string | null } | null): string {
  if (!live) return 'Live';
  const p = (live.period ?? '').toUpperCase();
  if (/HALF ?TIME|^HALF$/.test(p)) return 'HT';
  const m = live.clock?.match(/^(\d+):(\d\d)$/);
  const minute = m ? `${Number(m[1]) + (Number(m[2]) > 0 ? 1 : 0)}′` : '';
  const half = /1ST/.test(p) ? '1H' : /2ND/.test(p) ? '2H' : /OT/.test(p) ? p.replace(/\s+/g, '') : p ? p.slice(0, 3) : '';
  return [minute, half].filter(Boolean).join(' ') || 'Live';
}

function Side({ s, winner, loser }: { s: MatchLike['home']; winner: boolean; loser: boolean }) {
  return (
    <span className={`flex min-w-0 items-center gap-2 ${loser ? 'text-chalk-400' : 'text-chalk-100'}`}>
      <TeamLogo src={s.logo} seo={s.seo} name={s.name} size={22} />
      {s.rank && <span className="shrink-0 text-2xs text-chalk-500 tnum">No. {s.rank}</span>}
      <span className={`truncate ${winner ? 'font-semibold' : 'font-medium'}`}>{s.name ?? 'TBD'}</span>
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
  const when = live ? liveMinute(g.live) : final ? 'FT' : pending ? 'No result' : g.status === 'scheduled' ? (fmt.kickoff(g.start_epoch) ?? 'TBD') : g.status === 'postponed' ? 'PPD' : g.status === 'cancelled' ? 'CANC' : g.status;
  const tag = g.tournament ?? (g.conference_game ? (g.home.conference?.short ?? g.home.conference?.name ?? 'Conference') : null);
  return (
    <Link to={href(`/matches/${g.id}`)} className={`flex items-center gap-3 px-3 transition-colors duration-150 hover:bg-field-800 coarse:min-h-[64px] ${dense ? 'py-1.5' : 'py-2.5'}`} aria-label={`${g.home.name ?? 'TBD'} ${hs ?? ''} ${g.away.name ?? 'TBD'} ${as ?? ''}, ${when}`}>
      <span className={`w-14 shrink-0 text-center text-xs tnum ${live ? 'font-semibold text-win' : pending ? 'text-note' : 'text-chalk-500'}`} title={pending ? 'The result has not been reported yet' : g.status === 'scheduled' ? fmt.kickoffEt(g.start_epoch) ?? undefined : undefined}>
        {live && <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-win align-middle motion-reduce:animate-none" />}
        {showDate && !live ? <span className="block text-2xs">{fmt.day(g.game_date)}</span> : null}
        <span className="block">{when}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <Side s={g.home} winner={homeWin} loser={awayWin} />
        <Side s={g.away} winner={awayWin} loser={homeWin} />
      </span>
      {tag && <span className="hidden shrink-0 text-2xs text-chalk-500 sm:block">{tag}{g.neutral_site ? ', neutral' : ''}</span>}
      <span className="flex shrink-0 flex-col items-end gap-1 text-sm tnum">
        {live || final ? <>
          <span className={homeWin ? 'font-semibold text-chalk-100' : awayWin ? 'text-chalk-400' : 'text-chalk-100'}>{hs ?? '–'}</span>
          <span className={awayWin ? 'font-semibold text-chalk-100' : homeWin ? 'text-chalk-400' : 'text-chalk-100'}>{as ?? '–'}</span>
        </> : <span className="text-chalk-500">–</span>}
      </span>
      {final && (g.forfeit || g.shootout || g.overtime) && <Badge className="hidden sm:inline-flex">{g.forfeit ? 'Forfeit' : g.shootout ? 'PK' : 'OT'}</Badge>}
    </Link>
  );
}
