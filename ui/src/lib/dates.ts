// Dates on the matches pages are Eastern calendar days, the way NCAA.com and every school schedule print them.
export const todayEastern = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const shiftIso = (iso: string, days: number): string => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const isIso = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
/** "Sat 20" / "Today" / "Tomorrow" / "Yesterday" for the date strip. */
export function dayChip(iso: string, today: string): { top: string; bottom: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  const diff = Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const top = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
  return { top, bottom: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) };
}
export const longDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
