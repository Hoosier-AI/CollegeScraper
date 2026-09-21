import { useEffect, useState } from 'react';

/** The current time, re-rendered every `ms`, for "updated 20 s ago" labels. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export const secondsAgo = (iso: string | null | undefined, now: number): number | null => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null);
export const agoShort = (iso: string | null | undefined, now: number): string => { const s = secondsAgo(iso, now); return s == null ? '' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
