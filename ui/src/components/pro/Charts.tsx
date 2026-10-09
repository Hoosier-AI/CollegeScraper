// Small SVG charts for the pro pages (no chart library): bars by season, a form line of match ratings and a percentile
// wheel. Each is readable without colour (labels and values) and has an aria-label summing it up.
import { Link } from 'react-router-dom';

/** Two stacked series per column (goals and assists by season). */
export function SeasonBars({ rows, a, b, caption }: { rows: { label: string; a: number; b: number }[]; a: string; b: string; caption: string }) {
  if (!rows.length || !rows.some((r) => r.a || r.b)) return null;
  const max = Math.max(1, ...rows.map((r) => r.a + r.b));
  const H = 120;
  return (
    <figure className="frame p-3">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-chalk-400">
        <span>{caption}</span>
        <span className="flex gap-3"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-pitch-400" />{a}</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-note" />{b}</span></span>
      </figcaption>
      <div className="flex items-end gap-1.5 overflow-x-auto pb-1" role="img" aria-label={`${caption}: ${rows.map((r) => `${r.label} ${r.a} ${a.toLowerCase()}, ${r.b} ${b.toLowerCase()}`).join('; ')}`}>
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-[2.25rem] flex-1 flex-col items-center gap-1">
            <span className="text-2xs tnum text-chalk-300">{r.a + r.b || ''}</span>
            <div className="flex w-full max-w-[2.5rem] flex-col-reverse overflow-hidden rounded-t" style={{ height: `${H}px` }}>
              <span className="w-full bg-pitch-400" style={{ height: `${(r.a / max) * H}px` }} title={`${r.a} ${a.toLowerCase()}`} />
              <span className="w-full bg-note" style={{ height: `${(r.b / max) * H}px` }} title={`${r.b} ${b.toLowerCase()}`} />
            </div>
            <span className="text-2xs tnum text-chalk-500">{r.label}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

const ratingTone = (v: number) => (v >= 8 ? 'fill-win' : v >= 7 ? 'fill-pitch-400' : v >= 6.3 ? 'fill-note' : 'fill-loss');

/** Match ratings over the last matches, oldest on the left; the dashed line is the average. */
export function FormLine({ points, caption }: { points: { label: string; value: number; href?: string; title: string }[]; caption: string }) {
  if (points.length < 3) return null;
  const W = 600, H = 150, PAD = 22, lo = 5, hi = 10;
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - PAD - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - PAD * 2);
  const avg = points.reduce((n, p) => n + p.value, 0) / points.length;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <figure className="frame p-3">
      <figcaption className="mb-1 flex justify-between text-xs text-chalk-400"><span>{caption}</span><span className="tnum">average {avg.toFixed(2)}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${caption}: ${points.map((p) => `${p.label} ${p.value.toFixed(1)}`).join(', ')}`}>
        {[6, 7, 8, 9].map((g) => <g key={g}><line x1={PAD} x2={W - PAD} y1={y(g)} y2={y(g)} className="stroke-field-700" strokeWidth={1} /><text x={4} y={y(g) + 4} className="fill-chalk-500 text-[10px]">{g}</text></g>)}
        <line x1={PAD} x2={W - PAD} y1={y(avg)} y2={y(avg)} className="stroke-chalk-500" strokeDasharray="4 4" strokeWidth={1} />
        <path d={path} className="fill-none stroke-pitch-300" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => {
          const dot = <circle cx={x(i)} cy={y(p.value)} r={5} className={`${ratingTone(p.value)} stroke-field-900`} strokeWidth={2}><title>{p.title}</title></circle>;
          return p.href ? <Link key={i} to={p.href}>{dot}</Link> : <g key={i}>{dot}</g>;
        })}
      </svg>
    </figure>
  );
}

const SLICE_GROUP: Record<string, 'attack' | 'possession' | 'defence'> = {
  goals: 'attack', shots: 'attack', shots_on: 'attack', assists: 'attack', key_passes: 'possession', passes: 'possession', pass_accuracy: 'possession',
  dribbles_won: 'possession', tackles: 'defence', interceptions: 'defence', duels_won: 'defence', saves: 'defence', rating: 'possession',
};
const GROUP_FILL = { attack: 'fill-pitch-400', possession: 'fill-note', defence: 'fill-[#7DD3FC]' } as const;

/** A percentile wheel: one slice per stat, its length the percentile against the same position. */
export function PercentileWheel({ rows, labels, caption }: { rows: { stat: string; pct: number; value: number }[]; labels: Record<string, string>; caption: string }) {
  if (rows.length < 3) return null;
  const S = 320, C = S / 2, R0 = 26, R = C - 44;
  const n = rows.length, step = (Math.PI * 2) / n;
  const arc = (r0: number, r1: number, a0: number, a1: number) => {
    const p = (r: number, a: number) => `${(C + r * Math.sin(a)).toFixed(2)},${(C - r * Math.cos(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
  };
  return (
    <figure className="frame p-3">
      <figcaption className="mb-1 text-xs text-chalk-400">{caption}</figcaption>
      <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto w-full max-w-[22rem]" role="img" aria-label={`${caption}: ${rows.map((r) => `${labels[r.stat] ?? r.stat} ${Math.round(r.pct * 100)}`).join(', ')}`}>
        {[0.25, 0.5, 0.75, 1].map((f) => <circle key={f} cx={C} cy={C} r={R0 + (R - R0) * f} className="fill-none stroke-field-700" strokeWidth={1} />)}
        {rows.map((r, i) => {
          const a0 = i * step + 0.02, a1 = (i + 1) * step - 0.02, mid = (a0 + a1) / 2;
          const len = R0 + (R - R0) * Math.max(0.04, r.pct);
          const lx = C + (R + 22) * Math.sin(mid), ly = C - (R + 22) * Math.cos(mid);
          const group = SLICE_GROUP[r.stat] ?? 'possession';
          return (
            <g key={r.stat}>
              <path d={arc(R0, R, a0, a1)} className="fill-field-800" />
              <path d={arc(R0, len, a0, a1)} className={GROUP_FILL[group]} fillOpacity={0.9}><title>{`${labels[r.stat] ?? r.stat}: ${Math.round(r.pct * 100)}th percentile (${r.value})`}</title></path>
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-chalk-300 text-[9px]">{(labels[r.stat] ?? r.stat).replace(' completed', '')}</text>
              <text x={C + (len - 9) * Math.sin(mid)} y={C - (len - 9) * Math.cos(mid)} textAnchor="middle" dominantBaseline="middle" className="fill-field-950 text-[9px] font-semibold">{len - R0 > 18 ? Math.round(r.pct * 100) : ''}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-center gap-4 text-2xs text-chalk-400">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-pitch-400" />Attacking</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-note" />Possession</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#7DD3FC]" />Defending</span>
      </div>
    </figure>
  );
}
