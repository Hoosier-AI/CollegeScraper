// Small pure helpers shared by head.ts, body.ts, routes.ts and sitemaps.ts.
import type { Gender, TeamRef } from './types.js';

export const DEFAULT_PUBLIC_URL = 'https://plaibook-college-scraper.onrender.com';
export const SITE_NAME = 'Plaibook Stats';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG = /^[a-z0-9][a-z0-9-]{0,160}$/;

/** HTML text and attribute escaping. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "https://host/" -> "https://host". */
export const trimBase = (base: string | undefined | null): string => String(base || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');

export const genderSegment = (g: Gender): 'men' | 'women' => (g === 'w' ? 'women' : 'men');
export const genderFromSegment = (s: string): Gender | null => (s === 'men' ? 'm' : s === 'women' ? 'w' : null);
/** "Men's" / "Women's". */
export const genderWord = (g: Gender): string => (g === 'w' ? "Women's" : "Men's");
export const genderLower = (g: Gender): string => (g === 'w' ? "women's" : "men's");

const DIVISIONS: Record<string, string> = { d1: 'Division I', d2: 'Division II', d3: 'Division III' };
export const divisionLabel = (d: string | null | undefined): string => (d ? DIVISIONS[d] ?? d.toUpperCase() : '');

/** A season only travels in a URL when it is not the current one (canonical rule). */
export const seasonQuery = (season: number | null | undefined, current: number): string => (season && season !== current ? `?season=${season}` : '');

export const teamPath = (t: Pick<TeamRef, 'school_seo' | 'gender'>, season?: number | null, current?: number): string =>
  `/teams/${encodeURIComponent(t.school_seo)}/${genderSegment(t.gender)}${current != null ? seasonQuery(season, current) : ''}`;
export const playerPath = (slug: string): string => `/players/${encodeURIComponent(slug)}`;
export const matchPath = (slug: string): string => `/matches/${encodeURIComponent(slug)}`;
export const conferencePath = (seo: string, season?: number | null, current?: number): string =>
  `/conferences/${encodeURIComponent(seo)}${current != null ? seasonQuery(season, current) : ''}`;

/** A valid season from a query-string value, else null. */
export function parseSeason(v: unknown): number | null {
  const n = Number(v);
  return typeof v === 'string' && /^\d{4}$/.test(v) && n > 1990 && n < 2100 ? n : null;
}

export const rec = (w: number | null | undefined, l: number | null | undefined, t: number | null | undefined): string => `${w ?? 0}-${l ?? 0}-${t ?? 0}`;

/** Cut at a word boundary so meta descriptions stay under what search results show. */
export function clip(s: string, max = 158): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const i = cut.lastIndexOf(' ');
  return `${(i > max * 0.6 ? cut.slice(0, i) : cut).replace(/[,;:\s]+$/, '')}…`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-12" -> "Sep 12, 2026". */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

/** Class year from the roster: the printed value, else 1-5 as Fr/So/Jr/Sr/Gr. */
export function classLabel(raw: string | null | undefined, year: number | null | undefined, redshirt?: boolean | null): string | null {
  const base = raw?.trim() || (year ? ['Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.'][year - 1] ?? null : null);
  if (!base) return null;
  return redshirt && !/^r/i.test(base) ? `R-${base}` : base;
}

/** Safe inside <script type="application/ld+json">. */
export const jsonLdText = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
