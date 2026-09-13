/** Fall season key for a date: Jan–Jun belong to the previous fall season. */
export function seasonForDate(d: Date = new Date()): number {
  const y = d.getUTCFullYear();
  return d.getUTCMonth() + 1 >= 7 ? y : y - 1;
}
export function currentSeason(): number { return seasonForDate(); }

/** Aug 1 of season → Jan 31 of season+1 (inclusive) as ISO dates. */
export function seasonWindow(season: number): { from: string; to: string } {
  return { from: `${season}-08-01`, to: `${season + 1}-01-31` };
}
export function inSeason(isoDate: string, season: number): boolean {
  const { from, to } = seasonWindow(season);
  return isoDate >= from && isoDate <= to;
}
export function* eachDate(from: string, to: string): Generator<string> {
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) { yield d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); }
}
