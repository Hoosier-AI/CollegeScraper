// Small pure helpers shared by the Sidearm parsers. No network, no model changes.
import type { Gender } from '../../../model.js';
import { stripDiacritics } from '../../../normalize/names.js';

export type Dict = Record<string, unknown>;

export function isObj(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function obj(v: unknown): Dict {
  return isObj(v) ? v : {};
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Trimmed string or null (empty strings and non-strings become null). */
export function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s : null;
}

export function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return /^(true|1|y|yes)$/i.test(v.trim());
  if (typeof v === 'number') return v !== 0;
  return false;
}

export function sidearmSportSlug(gender: Gender): string {
  return gender === 'w' ? 'womens-soccer' : 'mens-soccer';
}

/** Resolve a site-relative path against the base URL; absolute URLs pass through. */
export function absUrl(baseUrl: string, path: string | null | undefined): string | null {
  if (!path) return null;
  const p = path.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('//')) return `https:${p}`;
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${p.startsWith('/') ? '' : '/'}${p}`;
}

/** Sidearm-style slug: "Leonardo D'Ambrosio" → "leonardo-dambrosio". */
export function slugify(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "11/30/2025" or "2025-11-30T16:00:00" → "2025-11-30" (null if unparseable). */
export function isoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return null;
}

/** "2025-11-05T19:00:00" → "19:00"; null when no wall-clock time is present. */
export function isoTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** "4 p.m.", "7:30 PM", "Noon", "TBA" → "16:00" / "19:30" / "12:00" / null. */
export function clockFromDisplayTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || /tba|tbd/.test(s)) return null;
  if (/^noon/.test(s)) return '12:00';
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ?? '00';
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "Nov 30(Sun)" / "Nov 30" / "November 30, 2025" with a fall season → ISO date. Jan–Jul roll into season+1. */
export function dateFromMonthDay(raw: string | null | undefined, season: number): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:\D.*?(\d{4}))?/);
  if (!m) return null;
  const month = MONTHS[m[1]!.slice(0, 4).toLowerCase()] ?? MONTHS[m[1]!.slice(0, 3).toLowerCase()];
  if (!month) return null;
  const year = m[3] ? Number(m[3]) : month >= 8 ? season : season + 1;
  return `${year}-${String(month).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}

/** Fall season window: Aug 1 of `season` through Jan 31 of `season+1` (inclusive, ISO date strings). */
export function seasonWindow(season: number): { start: string; end: string } {
  return { start: `${season}-08-01`, end: `${season + 1}-01-31` };
}

export function inSeason(isoDay: string | null, season: number): boolean {
  if (!isoDay) return false;
  const { start, end } = seasonWindow(season);
  return isoDay >= start && isoDay <= end;
}

/** Fetcher errors carry `.status`; treat 404/410 as "not there". */
export function isNotFound(err: unknown): boolean {
  const s = (err as { status?: unknown } | null)?.status;
  return s === 404 || s === 410;
}

/** Collapse whitespace; null when empty. */
export function collapse(s: string | null | undefined): string | null {
  const t = (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

/** Strip a leading "#14 " rank prefix from a team name. */
export function stripRank(name: string): string {
  // "vs #6 Georgetown", "at Wake Forest", "@ UNC", "vs. Elon" → team name only.
  const cleaned = String(name ?? '').replace(/^\s*(?:vs\.?|at|@|versus)\s+/i, '').trim();
  return stripRankInner(cleaned);
}
function stripRankInner(name: string): string {
  return name.replace(/^\s*(?:#|no\.?\s*)\d+\s+/i, '').trim();
}

/** Last-resort stable key for a player row: "last|first|jersey" lowercased ASCII. */
export function nameJerseyKey(lastName: string, firstName: string, jersey: number | string | null): string {
  const n = (x: string) => stripDiacritics(x).toLowerCase().replace(/[^a-z0-9' -]/g, '').trim();
  return `${n(lastName)}|${n(firstName)}|${jersey == null ? '' : String(jersey)}`;
}
