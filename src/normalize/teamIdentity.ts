import { stripDiacritics } from './names.js';

// Common AP-style abbreviations used by NCAA.com short names ("Central Conn. St.", "Fla. Atlantic").
const AP_ABBR: [string, string][] = [
  ['conn', 'connecticut'], ['fla', 'florida'], ['mich', 'michigan'], ['minn', 'minnesota'], ['wis', 'wisconsin'], ['tenn', 'tennessee'],
  ['ariz', 'arizona'], ['calif', 'california'], ['colo', 'colorado'], ['okla', 'oklahoma'], ['ore', 'oregon'], ['wash', 'washington'],
  ['mass', 'massachusetts'], ['miss', 'mississippi'], ['ill', 'illinois'], ['ind', 'indiana'], ['kan', 'kansas'], ['neb', 'nebraska'],
  ['ala', 'alabama'], ['ark', 'arkansas'], ['mont', 'montana'], ['nev', 'nevada'], ['penn', 'pennsylvania'], ['va', 'virginia'],
  ['intl', 'international'], ['tech', 'technology'], ['inst', 'institute'], ['so', 'southern'], ['no', 'northern'], ['cal', 'california'],
  ['mo', 'missouri'], ['tex', 'texas'], ['ga', 'georgia'], ['la', 'louisiana'], ['md', 'maryland'], ['del', 'delaware'], ['wyo', 'wyoming'],
  ['ky', 'kentucky'], ['vt', 'vermont'], ['nm', 'new mexico'], ['nj', 'new jersey'], ['me', 'maine'], ['col', 'college'], ['univ', 'university'],
];

/** Aggressive team-name normaliser used to match names across sources. */
export function teamKey(raw: string | null | undefined): string {
  let s = stripDiacritics(String(raw ?? '')).toLowerCase();
  s = s.replace(/['\u2018\u2019`]/g, '');   // Hawai‘i → hawaii, St. John's → st johns
  s = s.replace(/\(.*?\)/g, ' ');
  s = s.replace(/#\d+\s*/g, ' ');
  // "college" and "state" are significant (Boston College vs Boston U., NC State vs North Carolina).
  s = s.replace(/\b(university|univ|the|of|at|men'?s|women'?s|soccer)\b/g, ' ');
  s = s.replace(/\bu\b/g, ' ');
  // Dotted state initialisms ("N.C. State", "S.C. Upstate", "W.Va. Wesleyan", "N.J. City").
  s = s.replace(/\bn\.c\.?(?=\s|$)/g, 'north carolina').replace(/\bs\.c\.?(?=\s|$)/g, 'south carolina').replace(/\bw\.va\.?(?=\s|$)/g, 'west virginia').replace(/\bn\.j\.?(?=\s|$)/g, 'new jersey');
  s = s.replace(/\bst\.?\b/g, 'state');
  for (const [abbr, full] of AP_ABBR) s = s.replace(new RegExp(`\\b${abbr}\\.?\\b`, 'g'), full);
  s = s.replace(/\bmt\.?\b/g, 'mount');
  s = s.replace(/\bft\.?\b/g, 'fort');
  s = s.replace(/&/g, 'and');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  // "Cal State Bakersfield" / "California State Bakersfield" / "CSU Bakersfield" are the same school.
  s = s.replace(/\bcalifornia state\b/g, 'csu');
  // "University of California, Irvine" → "uc irvine".
  s = s.replace(/\bcalifornia (irvine|davis|riverside|santa barbara|santa cruz|san diego|los angeles|berkeley|merced)\b/g, 'uc $1');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Initialism of a long institutional name: "University of North Carolina Greensboro" → "uncg",
 * "Houston Christian University" → "hcu", "University of Missouri-Kansas City" → "umkc". Null when fewer
 * than three letters would result (too ambiguous).
 */
export function nameInitials(raw: string | null | undefined): string | null {
  const words = stripDiacritics(String(raw ?? '')).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[-–/]/g, ' ').replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean).filter((w) => !['of', 'the', 'at', 'and', 'in', 'for'].includes(w));
  const letters = words.map((w) => w[0]!).join('');
  return letters.length >= 3 && letters.length <= 6 ? letters : null;
}

/** Turn a display name into an NCAA-style seo slug guess ("North Carolina" → "north-carolina"). */
export function seoGuess(raw: string): string {
  return teamKey(raw).replace(/\s+/g, '-');
}

/** "https://goduke.com/" → "goduke.com" */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).host.replace(/^www\./, ''); } catch { return null; }
}
