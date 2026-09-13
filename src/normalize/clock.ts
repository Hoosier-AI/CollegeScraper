/** "45:00", "88:23", "1:02:15", "00:00:00" → seconds since kickoff (null if unparseable). */
export function clockToSeconds(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  if (m[3] !== undefined) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "90:00" → 90 (whole minutes, rounding up partial minutes). */
export function minutesFromClock(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const sec = clockToSeconds(s);
  if (sec == null) return null;
  return Math.round(sec / 60);
}
