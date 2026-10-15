// The first things a coach looks for on a player page, right under the name: position, salary (MLS players, from the
// MLS Players Association releases) and the two result stats, PPG (his team's points per game he played: 3 for a win,
// 1 for a tie) and PPS (the same over his starts of 45+ minutes).
import type { ReactNode } from 'react';

const POSITION: Record<string, string> = { GK: 'Goalkeeper', G: 'Goalkeeper', D: 'Defender', DF: 'Defender', M: 'Midfielder', MF: 'Midfielder', F: 'Forward', FW: 'Forward', Attacker: 'Forward' };
export const positionWord = (p: string | null | undefined) => (p ? POSITION[p] ?? p : null);

export interface Salary { season: number; guaranteed: number | null; base: number | null; release_date: string }
const usd = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M` : `$${Math.round(n / 1000)}K`);
const avg = (pts: number | null | undefined, n: number | null | undefined) => (pts != null && n ? (pts / n).toFixed(2) : null);

function Fact({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg px-3 py-2 ${accent ? 'bg-pitch-400/10 ring-1 ring-inset ring-pitch-400/30' : 'bg-field-950/50'}`}>
      <div className="text-2xs text-chalk-400">{label}</div>
      <div className="display truncate text-xl leading-tight text-chalk-100 tnum sm:text-2xl">{value}</div>
      {sub != null && <div className="truncate text-2xs text-chalk-400">{sub}</div>}
    </div>
  );
}

/** apps/pts: result points over appearances; starts/startPts: over starts of 45+ minutes. Five of each before a
 *  number shows (fewer is noise); the count is always shown. */
export function KeyFacts({ position, salary, salaryNote, apps, pts, starts, startPts, season, other }: { position: string | null | undefined; salary?: Salary | null; salaryNote?: string | null; apps?: number | null; pts?: number | null; starts?: number | null; startPts?: number | null; season?: number | null;
  /** In place of salary (college players have none): another fact, such as class. */ other?: { label: string; value: ReactNode; sub?: ReactNode } }) {
  const ppg = (apps ?? 0) >= 5 ? avg(pts, apps) : null, pps = (starts ?? 0) >= 5 ? avg(startPts, starts) : null;
  return (
    <section aria-label="Key facts" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Fact label="Position" value={positionWord(position) ?? '–'} />
      <Fact label="Points per game" value={ppg ?? '–'} sub={apps ? `${season ? `${season}, ` : ''}${apps} ${apps === 1 ? 'game' : 'games'}${ppg ? '' : ' (5+ to show)'}` : 'no games yet'} accent />
      <Fact label="Points per start" value={pps ?? '–'} sub={starts ? `${starts} ${starts === 1 ? 'start' : 'starts'} of 45+ min${pps ? '' : ' (5+ to show)'}` : 'no starts of 45+ min'} accent />
      {other ? <Fact label={other.label} value={other.value} sub={other.sub} /> : salary ? <Fact label={`${salary.season} guaranteed pay`} value={salary.guaranteed != null ? usd(salary.guaranteed) : '–'} sub={salary.base != null ? `Base ${usd(salary.base)}, as of ${salary.release_date.slice(0, 7)}` : `As of ${salary.release_date.slice(0, 7)}`} />
        : <Fact label="Salary" value="Not published" sub={<span title={salaryNote ?? undefined}>{salaryNote ?? 'Only MLS publishes player salaries'}</span>} />}
    </section>
  );
}
