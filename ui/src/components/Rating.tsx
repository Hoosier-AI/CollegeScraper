// A 0 to 10 match rating as a filled pill. One scale for every badge, chart dot and lineup token on the site:
// 9+ elite, 8+ great, 7+ good, 6.5+ fair, 6+ weak, below poor. The number is always printed, so colour is never the
// only cue. Colours are the `rate` tokens in tailwind.config.js; ratingHex is the same scale for SVG fills.
export type RatingBand = 'elite' | 'great' | 'good' | 'fair' | 'weak' | 'poor';

export const ratingBand = (v: number): RatingBand => (v >= 9 ? 'elite' : v >= 8 ? 'great' : v >= 7 ? 'good' : v >= 6.5 ? 'fair' : v >= 6 ? 'weak' : 'poor');

const BG: Record<RatingBand, string> = { elite: 'bg-rate-elite', great: 'bg-rate-great', good: 'bg-rate-good', fair: 'bg-rate-fair', weak: 'bg-rate-weak', poor: 'bg-rate-poor' };
const HEX: Record<RatingBand, string> = { elite: '#38BDF8', great: '#2DD4BF', good: '#86EFAC', fair: '#FBBF24', weak: '#FB923C', poor: '#F87171' };

export const ratingClass = (v: number) => `${BG[ratingBand(v)]} text-field-950`;
export const ratingHex = (v: number) => HEX[ratingBand(v)];

const SIZE = {
  xs: 'min-w-[2rem] px-1 text-2xs leading-4 rounded',
  sm: 'min-w-[2.25rem] px-1.5 py-px text-xs rounded',
  md: 'min-w-[2.75rem] px-2 py-0.5 text-sm rounded-md',
  lg: 'min-w-[3.25rem] px-2 py-0.5 text-lg rounded-md',
  xl: 'min-w-[4.5rem] px-3 py-1 text-3xl rounded-lg display',
} as const;

export function RatingBadge({ v, size = 'sm', className = '', label }: { v: number | null | undefined; size?: keyof typeof SIZE; className?: string; label?: string }) {
  if (v == null || !(v > 0)) return null;
  return (
    <span className={`inline-flex items-center justify-center font-semibold tnum ${SIZE[size]} ${ratingClass(v)} ${className}`} aria-label={`${label ?? 'rating'} ${v.toFixed(1)}`} title={label}>
      {v.toFixed(size === 'xl' ? 2 : 1)}
    </span>
  );
}

export const RatingPill = RatingBadge;
