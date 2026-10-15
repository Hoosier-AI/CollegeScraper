// No player pages for anyone under 18 (privacy policy, /privacy#athletes). A known birth date less than 18 years ago:
// the profile becomes a short notice, the page is kept out of search engines, the sitemap and site search.
// No birth date on file: we cannot tell, so the page shows as usual.
export function isMinor(birthDate: string | null | undefined, now = new Date()): boolean {
  if (!birthDate) return false;
  const b = new Date(`${String(birthDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return false;
  const adult = new Date(Date.UTC(b.getUTCFullYear() + 18, b.getUTCMonth(), b.getUTCDate()));
  return adult.getTime() > now.getTime();
}
