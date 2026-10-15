// Two teams side by side: this season a game, each figure with a bar for its percentile in the team's own division
// or competition (the better of the two in bold), Plaibook Elo (and RPI for college), and their last meetings.
import type { ReactNode } from 'react';
import { fmt } from '../lib/api';

export interface CompareRow { key: string; label: string; better: 'high' | 'low'; d: number; a: number | null; b: number | null; pa: number | null; pb: number | null }

const val = (v: number | null, d: number, key: string) => (v == null ? '–' : key === 'possession' ? `${v.toFixed(1)}%` : fmt.num(v, d));

export function TeamCompareRows({ rows, peerNote }: { rows: CompareRow[]; peerNote: string }) {
  return (
    <div className="frame divide-y divide-field-800">
      {rows.map((r) => {
        const aBetter = r.a != null && r.b != null && (r.better === 'high' ? r.a > r.b : r.a < r.b);
        const bBetter = r.a != null && r.b != null && (r.better === 'high' ? r.b > r.a : r.b < r.a);
        const bar = (p: number | null, side: 'a' | 'b') => (
          <span className="h-1.5 flex-1 overflow-hidden rounded bg-field-800" aria-hidden>
            {p != null && <span className={`block h-full ${side === 'a' ? 'ml-auto bg-pitch-400' : 'bg-[#7DD3FC]'}`} style={{ width: `${Math.max(3, p * 100)}%` }} />}
          </span>
        );
        return (
          <div key={r.key} className="px-3 py-2" aria-label={`${r.label}: ${val(r.a, r.d, r.key)} against ${val(r.b, r.d, r.key)}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={`w-20 tnum ${aBetter ? 'font-semibold text-chalk-100' : 'text-chalk-300'}`}>{val(r.a, r.d, r.key)}</span>
              <span className="text-center text-xs text-chalk-400">{r.label}</span>
              <span className={`w-20 text-right tnum ${bBetter ? 'font-semibold text-chalk-100' : 'text-chalk-300'}`}>{val(r.b, r.d, r.key)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              {bar(r.pa, 'a')}<span className="w-px self-stretch bg-field-700" aria-hidden />{bar(r.pb, 'b')}
            </div>
          </div>
        );
      })}
      <p className="px-3 py-2 text-2xs text-chalk-500">Bars: each team's percentile in {peerNote} (longer is better, for goals against too).</p>
    </div>
  );
}

export function TeamCompareHead({ a, b }: { a: ReactNode; b: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{a}{b}</div>;
}
