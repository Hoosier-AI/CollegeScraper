// A small line of a rating over recent months (the rankings table), coloured by which way it went.
export function Sparkline({ points, label, width = 84, height = 22 }: { points: { m: string; r: number }[]; label: string; width?: number; height?: number }) {
  if (points.length < 2) return <span className="text-2xs text-chalk-500">–</span>;
  const lo = Math.min(...points.map((p) => p.r)), hi = Math.max(...points.map((p) => p.r));
  const x = (i: number) => 1 + (i / (points.length - 1)) * (width - 2);
  const y = (v: number) => height - 2 - ((v - lo) / Math.max(1, hi - lo)) * (height - 4);
  const first = points[0]!.r, last = points[points.length - 1]!.r;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${label}: ${first} to ${last} over the last two years`} className="inline-block align-middle">
      <path d={points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(' ')} className={`fill-none ${last > first ? 'stroke-win' : last < first ? 'stroke-loss' : 'stroke-chalk-400'}`} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r={2} className={last > first ? 'fill-win' : last < first ? 'fill-loss' : 'fill-chalk-400'} />
    </svg>
  );
}
