// A 0 to 10 match rating as a coloured pill (FotMob style): 8+ excellent, 7+ good, 6.3+ average, below poor. The
// number is always printed, so colour is never the only cue.
export const ratingClass = (v: number) => (v >= 8 ? 'bg-win text-field-950' : v >= 7 ? 'bg-pitch-400 text-field-950' : v >= 6.3 ? 'bg-note text-field-950' : 'bg-loss text-field-950');

export function RatingBadge({ v, size = 'sm', className = '' }: { v: number | null | undefined; size?: 'xs' | 'sm' | 'lg'; className?: string }) {
  if (v == null || !(v > 0)) return null;
  const s = size === 'lg' ? 'px-2 py-0.5 text-base' : size === 'xs' ? 'px-1 text-[10px] leading-4' : 'px-1.5 py-px text-xs';
  return <span className={`inline-block rounded font-semibold tnum ${s} ${ratingClass(v)} ${className}`} aria-label={`rating ${v.toFixed(1)}`}>{v.toFixed(1)}</span>;
}
