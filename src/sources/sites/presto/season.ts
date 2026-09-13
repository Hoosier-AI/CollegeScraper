import type { Gender } from '../../../model.js';

/** Fall season 2025 → "2025-26". Two-digit suffix is zero padded ("2099-00"). */
export function prestoSeasonSlug(season: number): string {
  const next = (season + 1) % 100;
  return `${season}-${String(next).padStart(2, '0')}`;
}

/** Presto sport codes for soccer. */
export function prestoSportSlug(gender: Gender): string {
  return gender === 'w' ? 'wsoc' : 'msoc';
}
