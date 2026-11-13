// The attribute pentagon: five areas of a player's game, each the mean of his per-90 percentiles against the same
// position in the league season (pro_player_percentiles). No new data: a summary of the bars beside it. Shown only
// when at least three areas have numbers (a keeper's saves alone are not a pentagon). `b` overlays a second player.
import { useId } from 'react';

export interface PctInput { stat: string; pct: number }
export interface Attribute { key: string; label: string; value: number | null }

const AREAS: { key: string; label: string; stats: string[] }[] = [
  { key: 'att', label: 'Attacking', stats: ['goals', 'shots', 'shots_on'] },
  { key: 'cre', label: 'Creating', stats: ['assists', 'key_passes'] },
  { key: 'tec', label: 'Technique', stats: ['dribbles_won', 'pass_accuracy', 'passes'] },
  { key: 'def', label: 'Defending', stats: ['tackles', 'interceptions'] },
  { key: 'due', label: 'Duels', stats: ['duels_won'] },
];

export function attributesFrom(rows: PctInput[]): Attribute[] {
  const by = new Map(rows.map((r) => [r.stat, r.pct]));
  return AREAS.map((a) => {
    const vals = a.stats.map((s) => by.get(s)).filter((v): v is number => v != null);
    return { key: a.key, label: a.label, value: vals.length ? Math.round((vals.reduce((n, v) => n + v, 0) / vals.length) * 100) : null };
  });
}

export const hasPentagon = (attrs: Attribute[]) => attrs.filter((a) => a.value != null).length >= 3;

export function AttributePentagon({ a, b, aName, bName, size = 300 }: { a: Attribute[]; b?: Attribute[]; aName?: string; bName?: string; size?: number }) {
  const gid = useId();
  if (!hasPentagon(a)) return null;
  const S = size, C = S / 2, R = C - 64;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / a.length;
  const pt = (i: number, f: number) => [C + R * f * Math.cos(ang(i)), C + R * f * Math.sin(ang(i))] as const;
  const poly = (attrs: Attribute[]) => attrs.map((x, i) => pt(i, Math.max(0.04, (x.value ?? 0) / 100)).map((n) => n.toFixed(1)).join(',')).join(' ');
  const summary = a.map((x) => `${x.label} ${x.value ?? 'no data'}`).join(', ');
  return (
    <figure className="min-w-0">
      <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto block w-full max-w-[20rem]" role="img" aria-label={`${aName ?? 'Player'} by area, percentile: ${summary}${b ? `. ${bName ?? 'Other'}: ${b.map((x) => `${x.label} ${x.value ?? 'no data'}`).join(', ')}` : ''}`}>
        <defs>
          <radialGradient id={gid}><stop offset="0%" stopColor="#2DD4BF" stopOpacity={0.15} /><stop offset="100%" stopColor="#2DD4BF" stopOpacity={0.45} /></radialGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={a.map((_, i) => pt(i, f).join(',')).join(' ')} className={`fill-none ${f === 0.5 ? 'stroke-field-600' : 'stroke-field-700'}`} strokeWidth={1} strokeDasharray={f === 0.5 ? '3 3' : undefined} />)}
        {a.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={C} y1={C} x2={x} y2={y} className="stroke-field-700" strokeWidth={1} />; })}
        {b && hasPentagon(b) && <polygon points={poly(b)} className="fill-away/20 stroke-away" strokeWidth={2} strokeLinejoin="round" />}
        <polygon points={poly(a)} fill={`url(#${gid})`} className="stroke-pitch-300" strokeWidth={2} strokeLinejoin="round" />
        {a.map((x, i) => { const [px, py] = pt(i, Math.max(0.04, (x.value ?? 0) / 100)); return x.value != null ? <circle key={x.key} cx={px} cy={py} r={3.5} className="fill-pitch-300 stroke-field-900" strokeWidth={1.5} /> : null; })}
        {a.map((x, i) => {
          const [lx, ly] = pt(i, 1.2);
          const anchor = Math.abs(lx - C) < 8 ? 'middle' : lx > C ? 'start' : 'end';
          const dx = 0;
          return (
            <g key={x.key}>
              <text x={lx + dx} y={ly - 2} textAnchor={anchor} className="fill-chalk-300" style={{ fontSize: 12 }}>{x.label}</text>
              <text x={lx + dx} y={ly + 13} textAnchor={anchor} className={x.value == null ? 'fill-chalk-500' : 'fill-chalk-100'} style={{ fontSize: 13, fontWeight: 600 }}>
                {x.value ?? '–'}{b && hasPentagon(b) ? <tspan className="fill-away"> {b[i]?.value ?? '–'}</tspan> : null}
              </text>
            </g>
          );
        })}
      </svg>
      {b && (
        <figcaption className="mt-1 flex justify-center gap-4 text-2xs text-chalk-400">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-pitch-300" />{aName}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-away" />{bName}</span>
        </figcaption>
      )}
    </figure>
  );
}
