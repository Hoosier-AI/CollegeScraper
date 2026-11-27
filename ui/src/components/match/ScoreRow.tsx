// One match on one line, everywhere on the site: home on the left, the score or the kickoff in the middle, away on
// the right. College, pro and international lists all draw this row (MatchRow and ProMatchRow map their data to it).
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TeamLogo } from '../primitives';

export interface RowSide { name: string; logo?: string | null; seo?: string | null; score: number | null; rank?: number | null; seed?: number | null; won?: boolean }

const CREST = 25;

function Name({ s, lost, end }: { s: RowSide; lost: boolean; end?: boolean }) {
  const mark = s.seed != null ? `(${s.seed})` : s.rank ? String(s.rank) : null;
  return (
    <span className={`flex min-w-0 items-baseline gap-1.5 ${end ? 'justify-end text-right' : ''} ${lost ? 'text-chalk-500' : 'text-chalk-100'}`}>
      {mark && !end && <span className="shrink-0 text-2xs text-chalk-500 tnum">{mark}</span>}
      <span className={`truncate ${s.won ? 'font-semibold' : ''}`}>{s.name}</span>
      {mark && end && <span className="shrink-0 text-2xs text-chalk-500 tnum">{mark}</span>}
    </span>
  );
}

export function ScoreRow({ to, label, when, date, live, played, home, away, sub, meta, title }: {
  to: string; label: string; /** The minute, FT, a kickoff time or why there is no score. */ when: string; /** A day above the time, where the list spans days. */ date?: string | null;
  live: boolean; /** Live or finished: there is a score to show. */ played: boolean; home: RowSide; away: RowSide;
  /** Under the score: "pens 4-3", "aet", "5 min left". */ sub?: ReactNode; /** A quiet line under the row: the competition, the channel. */ meta?: ReactNode; title?: string;
}) {
  return (
    <Link to={to} aria-label={label} title={title} className="block px-3.5 py-0.5 text-sm transition-colors duration-150 hover:bg-field-800/70 active:bg-field-800">
      <span className="grid min-h-[34px] grid-cols-[minmax(0,1fr)_auto_4.5rem_auto_minmax(0,1fr)] items-center gap-x-2">
        <Name s={home} lost={!!away.won} end />
        <TeamLogo src={home.logo} seo={home.seo} name={home.name} size={CREST} />
        <span className="whitespace-nowrap text-center leading-tight">
          {played ? (
            <>
              <span className="display block text-base tnum text-chalk-100">{home.score ?? '–'} - {away.score ?? '–'}</span>
              <span className={`block text-2xs ${live ? 'font-semibold text-live' : 'text-chalk-500'}`}>{live && <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-live align-middle motion-reduce:animate-none" />}{when}</span>
            </>
          ) : (
            <>
              {date && <span className="block text-2xs text-chalk-500">{date}</span>}
              <span className="block text-xs text-chalk-300 tnum">{when}</span>
            </>
          )}
          {sub && <span className="block text-2xs text-chalk-500">{sub}</span>}
        </span>
        <TeamLogo src={away.logo} seo={away.seo} name={away.name} size={CREST} />
        <Name s={away} lost={!!home.won} />
      </span>
      {meta && <span className="block truncate pb-0.5 text-center text-2xs text-chalk-500">{meta}</span>}
    </Link>
  );
}
