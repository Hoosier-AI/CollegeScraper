const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function cleanName(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').replace(/[‘’]/g, "'").trim();
}

/** Split a display name into first/last. Handles "Last, First", "First Last", suffixes, and hyphenated/multi-word last names. */
export function splitName(raw: string): { firstName: string; lastName: string; suffix: string | null } {
  const s = cleanName(raw);
  let first = '', last = '', suffix: string | null = null;
  if (s.includes(',')) {
    const [l, f] = s.split(',', 2);
    last = cleanName(l); first = cleanName(f);
  } else {
    const parts = s.split(' ');
    if (parts.length === 1) return { firstName: '', lastName: s, suffix: null };
    if (parts.length >= 3 && SUFFIXES.has(parts[parts.length - 1]!.toLowerCase())) {
      suffix = parts.pop()!;
    }
    first = parts[0]!;
    last = parts.slice(1).join(' ');
  }
  const fparts = first.split(' ');
  if (fparts.length > 1 && SUFFIXES.has(fparts[fparts.length - 1]!.toLowerCase())) { suffix = fparts.pop()!; first = fparts.join(' '); }
  return { firstName: first, lastName: last, suffix };
}

/** Normalised identity token: lowercase ASCII letters only, "last|first". */
export function nameKey(firstName: string, lastName: string): string {
  const n = (x: string) => stripDiacritics(x).toLowerCase().replace(/[^a-z]/g, '');
  return `${n(lastName)}|${n(firstName)}`;
}

export function nameKeyFromDisplay(raw: string): string {
  const { firstName, lastName } = splitName(raw);
  return nameKey(firstName, lastName);
}

export function displayName(firstName: string, lastName: string): string {
  return cleanName(`${firstName} ${lastName}`);
}

/** Loose match helper: last name equal and first name equal or initial match. */
export function looseNameMatch(a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }): boolean {
  const n = (x: string) => stripDiacritics(x).toLowerCase().replace(/[^a-z]/g, '');
  if (n(a.lastName) !== n(b.lastName)) return false;
  const fa = n(a.firstName), fb = n(b.firstName);
  if (!fa || !fb) return true;
  return fa === fb || fa[0] === fb[0];
}

/** A stat crew's placeholder instead of a person — a team or bench card, "#0", "TM", "Team" — reads as no player. */
export function personOrNull(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!/[a-z]/i.test(s)) return null;
  if (/^(the )?(team|tm|bench|coach(es)?|staff|unknown)$/i.test(s)) return null;
  return s;
}
