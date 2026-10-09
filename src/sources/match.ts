// Pure: matching another source's people, clubs and games onto API-Football's. API-Football keeps full legal names
// ("Cristian Camilo Arango Duque"), other sources the common one ("Cristian Arango"), so names compare by tokens.
import { stripDiacritics } from '../normalize/names.js';

const tokens = (s: string | null | undefined): string[] =>
  stripDiacritics(String(s ?? '')).toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter((t) => t.length > 0);

export interface ProPerson { first_name: string | null; last_name: string | null; display_name: string | null; name?: string | null }

/**
 * How well a common name fits a provider person, 0 to 1.
 * 1: every token of the common name is in the provider's names. 0.9: the surname is one of the provider's surnames
 * and the first name or its initial agrees. 0: anything else (a nickname alone, a different surname).
 */
export function personScore(common: string, p: ProPerson): number {
  const c = tokens(common);
  if (!c.length) return 0;
  const first = tokens(p.first_name), last = tokens(p.last_name);
  const all = new Set([...first, ...last, ...tokens(p.display_name)]);
  if (c.length > 1 && c.every((t) => all.has(t))) return 1;
  const cLast = c[c.length - 1]!, cFirst = c[0]!;
  const surnames = new Set([...last, ...tokens(p.display_name).slice(1)]);
  if (c.length > 1 && surnames.has(cLast)) {
    const f = first[0] ?? tokens(p.display_name)[0] ?? '';
    // Same surname and first initial (Mike / Michael, "J." / John): callers only ask among people already narrowed to
    // the same birth date or the same club and season, and two equally good fits stay unmatched.
    if (first.includes(cFirst) || (f && f[0] === cFirst[0])) return 0.9;
  }
  // One-word names (Brazilian style): the whole of the provider's display name.
  if (c.length === 1 && tokens(p.display_name).join(' ') === cFirst) return 0.9;
  return 0;
}

const CLUB_NOISE = new Set(['fc', 'sc', 'cf', 'afc', 'the', 'club', 'de', 'soccer', 'football', 'w', 'women', 'nwsl']);
const clubTokens = (s: string): string[] => tokens(s).filter((t) => !CLUB_NOISE.has(t));

/** Club names: 1 for the same words (noise like FC, SC and a trailing W aside), down to 0 for nothing shared. */
export function clubScore(a: string, b: string): number {
  const x = new Set(clubTokens(a)), y = new Set(clubTokens(b));
  if (!x.size || !y.size) return 0;
  const inter = [...x].filter((t) => y.has(t)).length;
  if (inter === x.size && inter === y.size) return 1;
  if (inter === Math.min(x.size, y.size)) return 0.85;
  return inter / new Set([...x, ...y]).size;
}

/**
 * The single best candidate when it clearly beats the rest: at least `min`, and ahead of the runner-up. Null when
 * nothing fits or two fit equally well (a human decides those).
 */
export function bestOf<T>(cands: T[], score: (c: T) => number, min: number): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null, second = 0;
  for (const c of cands) {
    const s = score(c);
    if (!best || s > best.score) { second = best?.score ?? 0; best = { item: c, score: s }; } else if (s > second) second = s;
  }
  return best && best.score >= min && best.score > second ? best : null;
}

/** Kickoffs within `hours` of each other (sources round or shift kickoff times a little). */
export const nearKickoff = (a: string, b: string, hours = 36): boolean => Math.abs(Date.parse(a) - Date.parse(b)) <= hours * 3600_000;
