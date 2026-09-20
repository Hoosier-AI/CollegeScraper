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

/** Wall-clock parts in America/New_York: NCAA scoreboards and college_games.game_date are Eastern dates. */
export function eastern(d: Date = new Date()): { date: string; hour: number; minute: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = Number(get('hour')) % 24; // some ICU builds print midnight as "24"
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour, minute: Number(get('minute')), month: Number(get('month')) };
}
/** ISO date ± days, computed at UTC noon so daylight-saving changes cannot shift the day. */
export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
/** Eastern dates whose games may still be in play: today, plus yesterday until 02:00. */
export function liveDates(et = eastern()): string[] { return et.hour < 2 ? [shiftIso(et.date, -1), et.date] : [et.date]; }
/** Game hours: 11:00–02:00 Eastern, August to December. Defined in Eastern time so the November clock change is handled. */
export function inLiveWindow(et = eastern()): boolean { return (et.hour >= 11 || et.hour < 2) && et.month >= 8 && et.month <= 12; }
