// A player's recent matches as compact rows (FotMob/ESPN style): date | v or @, crest and opponent | result | minutes,
// goals and assists | rating pill. Left-aligned so nothing floats in the middle of a wide row; the whole row links.
import { Link } from 'react-router-dom';
import { TeamLogo } from '../primitives';
import { RatingBadge } from '../Rating';

export interface PlayerMatchItem {
  key: string; href: string; date: string; home: boolean;
  opp: { name: string; logo?: string | null; seo?: string | null };
  us: number | null; them: number | null; comp?: string | null;
  minutes: number | null; goals?: number | null; assists?: number | null; rating?: number | null; started?: boolean | null;
}

const RESULT = { W: 'bg-win/15 text-win', L: 'bg-loss/15 text-loss', D: 'bg-draw/15 text-draw' } as const;

export function PlayerMatchList({ items, drawWord = 'D' }: { items: PlayerMatchItem[]; drawWord?: 'D' | 'T' }) {
  if (!items.length) return null;
  return (
    <ul className="card divide-y divide-field-700/70 overflow-hidden">
      {items.map((m) => {
        const r = m.us == null || m.them == null ? null : m.us > m.them ? 'W' : m.us < m.them ? 'L' : 'D';
        const played = (m.minutes ?? 0) > 0;
        return (
          <li key={m.key}>
            <Link to={m.href} className="grid grid-cols-[3rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 row-pad transition-colors duration-150 hover:bg-field-800 coarse:min-h-[52px] sm:grid-cols-[3.5rem_minmax(0,1fr)_auto_6.5rem_auto]">
              <span className="text-xs leading-tight tnum text-chalk-500">{new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-center text-2xs text-chalk-500">{m.home ? 'v' : '@'}</span>
                <TeamLogo src={m.opp.logo} seo={m.opp.seo} name={m.opp.name} size={22} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-chalk-100">{m.opp.name}</span>
                  {m.comp && <span className="block truncate text-2xs text-chalk-500">{m.comp}</span>}
                </span>
              </span>
              {r ? <span className={`rounded px-1.5 py-0.5 text-xs font-semibold tnum ${RESULT[r]}`} aria-label={`${r === 'W' ? 'Won' : r === 'L' ? 'Lost' : 'Drew'} ${m.us}-${m.them}`}>{r === 'D' ? drawWord : r} {m.us}-{m.them}</span> : <span className="text-xs text-chalk-500">–</span>}
              <span className="hidden text-right text-xs tnum text-chalk-400 sm:block">
                {played ? `${m.minutes}′` : 'bench'}
                {m.goals ? <b className="ml-1.5 font-semibold text-chalk-100">{m.goals}G</b> : null}
                {m.assists ? <b className="ml-1 font-semibold text-chalk-100">{m.assists}A</b> : null}
              </span>
              <span className="flex w-11 justify-end">{m.rating != null && m.rating > 0 ? <RatingBadge v={m.rating} size="sm" /> : <span className="text-2xs text-chalk-500 sm:hidden">{played ? `${m.minutes}′` : 'bench'}</span>}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
