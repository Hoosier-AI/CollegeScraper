// A college player's recent games at a glance, oldest on the left: a bar for the minutes played (full height is 90),
// a mark above it for each goal and assist, the team's result under it. College has no match ratings, so this is the
// form line. Each column opens the match.
import { Link } from 'react-router-dom';

export interface FormGame { href: string; date: string; opponent: string; result: 'W' | 'L' | 'T' | null; minutes: number | null; goals: number; assists: number; started: boolean }

const TONE = { W: 'text-win', L: 'text-loss', T: 'text-draw' } as const;
const H = 64;

export function GameForm({ games, caption }: { games: FormGame[]; caption: string }) {
  if (games.length < 3) return null;
  const g = games.reduce((n, x) => n + x.goals, 0), a = games.reduce((n, x) => n + x.assists, 0);
  const mins = games.filter((x) => x.minutes != null);
  return (
    <figure className="frame p-3">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-chalk-400">
        <span>{caption}</span>
        <span className="flex flex-wrap gap-3">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pitch-400" />Goal</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-note" />Assist</span>
          <span className="tnum">{g} G, {a} A{mins.length ? `, ${Math.round(mins.reduce((n, x) => n + (x.minutes ?? 0), 0) / mins.length)} min a game` : ''}</span>
        </span>
      </figcaption>
      <ol className="flex items-end gap-1 overflow-x-auto pb-1" aria-label={`${caption}: ${games.map((x) => `${x.date} ${x.opponent}, ${x.minutes ?? 'unknown'} minutes, ${x.goals} goals, ${x.assists} assists`).join('; ')}`}>
        {games.map((x, i) => {
          const h = x.minutes == null ? 6 : Math.max(3, Math.min(1, x.minutes / 90) * H);
          return (
            <li key={i} className="flex min-w-[1.75rem] flex-1 flex-col items-center">
              <Link to={x.href} title={`${x.date}, ${x.opponent}: ${x.minutes ?? '?'} min${x.started ? ', started' : ''}, ${x.goals} G, ${x.assists} A`}
                className="flex w-full flex-col items-center gap-1 rounded px-0.5 pb-1 pt-1 hover:bg-field-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pitch-400">
                <span className="flex min-h-[0.875rem] flex-wrap justify-center gap-0.5" aria-hidden>
                  {Array.from({ length: Math.min(4, x.goals) }, (_, k) => <span key={`g${k}`} className="h-2 w-2 rounded-full bg-pitch-400" />)}
                  {Array.from({ length: Math.min(4, x.assists) }, (_, k) => <span key={`a${k}`} className="h-2 w-2 rounded-full bg-note" />)}
                </span>
                <span className="flex w-full max-w-[1.5rem] items-end rounded-sm bg-field-800" style={{ height: `${H}px` }}>
                  <span className={`w-full rounded-sm ${x.minutes == null ? 'bg-field-600' : x.started ? 'bg-chalk-400' : 'bg-chalk-500/60'}`} style={{ height: `${h}px` }} />
                </span>
                <span className={`text-2xs font-semibold ${x.result ? TONE[x.result] : 'text-chalk-500'}`}>{x.result ?? '–'}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-2xs text-chalk-500">Bar height is minutes played (full is 90); lighter bars came off the bench.</p>
    </figure>
  );
}
