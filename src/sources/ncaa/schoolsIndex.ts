// https://www.ncaa.com/json/schools → [{tid, slug, name, long_name}] (every NCAA member school).
import { z } from 'zod';

export const SCHOOLS_URL = 'https://www.ncaa.com/json/schools';

const SchoolRow = z.object({
  tid: z.union([z.string(), z.number()]).transform((v) => String(v)),
  slug: z.string(),
  name: z.string().nullable(),
  long_name: z.string().optional().nullable(),
}).passthrough();

export const SchoolsIndexSchema = z.array(SchoolRow);

export interface SchoolIndexEntry {
  /** NCAA school id ("803"). Distinct from the GraphQL contest teamId. */
  tid: string;
  /** NCAA seo slug ("duke") — the key used everywhere else on ncaa.com. */
  seo: string;
  name: string;
  longName: string | null;
}

export function parseSchoolsIndex(json: unknown): SchoolIndexEntry[] {
  const rows = SchoolsIndexSchema.parse(typeof json === 'string' ? JSON.parse(json) : json);
  const out: SchoolIndexEntry[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const seo = r.slug.trim();
    if (!seo || seen.has(seo)) continue;
    seen.add(seo);
    out.push({ tid: r.tid, seo, name: (r.name ?? seo).trim(), longName: r.long_name?.trim() || null });
  }
  return out;
}
