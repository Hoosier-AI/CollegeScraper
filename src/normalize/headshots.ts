// Player photo URLs as the school sites publish them: some are placeholders, some are mangled, and PrestoSports'
// cannot be shown from another site at all. One cleaner at write time and one check at render time.

const PLACEHOLDER = /spacer\.gif|default[-_]?headshot|no[-_]?photo|silhouette|\/images\/setup\/|\/images\/logos\/|\.gif(\?|$)/i;

/** The URL to store, or null for placeholders and junk. Fixes the stray space and doubled slash some Sidearm tenants emit. */
export function cleanHeadshotUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.replace(/\s+/g, '');
  u = u.replace(/^(https?:\/\/[^/]+)\/{2,}/, '$1/');
  if (!/^https?:\/\/[^/]+\/.+/.test(u) || PLACEHOLDER.test(u)) return null;
  try { return new URL(u).toString(); } catch { return null; }
}

/** PrestoSports photos (any `/sports/…` path on a Presto tenant, or the CDN itself) sit behind a bot challenge that refuses hotlinks. */
export const hotlinkable = (url: string | null | undefined): boolean => !!url && !PLACEHOLDER.test(url) && !/prestosports\.com|^https?:\/\/[^/]+\/sports\//i.test(url);
