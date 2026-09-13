import { stripDiacritics } from './names.js';

// Common AP-style abbreviations used by NCAA.com short names ("Central Conn. St.", "Fla. Atlantic").
const AP_ABBR: [string, string][] = [
  ['conn', 'connecticut'], ['fla', 'florida'], ['mich', 'michigan'], ['minn', 'minnesota'], ['wis', 'wisconsin'], ['tenn', 'tennessee'],
  ['ariz', 'arizona'], ['calif', 'california'], ['colo', 'colorado'], ['okla', 'oklahoma'], ['ore', 'oregon'], ['wash', 'washington'],
  ['mass', 'massachusetts'], ['miss', 'mississippi'], ['ill', 'illinois'], ['ind', 'indiana'], ['kan', 'kansas'], ['neb', 'nebraska'],
  ['ala', 'alabama'], ['ark', 'arkansas'], ['mont', 'montana'], ['nev', 'nevada'], ['penn', 'pennsylvania'], ['va', 'virginia'],
  ['intl', 'international'], ['tech', 'technology'], ['inst', 'institute'], ['so', 'southern'], ['no', 'northern'], ['cal', 'california'],
];

/** Aggressive team-name normaliser used to match names across sources. */
export function teamKey(raw: string | null | undefined): string {
  let s = stripDiacritics(String(raw ?? '')).toLowerCase();
  s = s.replace(/\(.*?\)/g, ' ');
  s = s.replace(/#\d+\s*/g, ' ');
  // "college" and "state" are significant (Boston College vs Boston U., NC State vs North Carolina).
  s = s.replace(/\b(university|univ|the|of|at|men'?s|women'?s|soccer)\b/g, ' ');
  s = s.replace(/\bu\b/g, ' ');
  s = s.replace(/\bst\.?\b/g, 'state');
  for (const [abbr, full] of AP_ABBR) s = s.replace(new RegExp(`\\b${abbr}\\.?\\b`, 'g'), full);
  s = s.replace(/\bmt\.?\b/g, 'mount');
  s = s.replace(/\bft\.?\b/g, 'fort');
  s = s.replace(/&/g, 'and');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
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
