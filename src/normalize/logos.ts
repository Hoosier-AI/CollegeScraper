/** NCAA.com publishes a crest for every school with a seo slug at a fixed address. */
export const ncaaLogoUrl = (seo: string | null | undefined): string | null => (seo && !seo.startsWith('x-') ? `https://www.ncaa.com/sites/default/files/images/logos/schools/bgl/${seo}.svg` : null);

/** A stored logo, else NCAA's by slug, else nothing. */
export const logoSrc = (src: string | null | undefined, seo?: string | null): string | null => src || ncaaLogoUrl(seo);

/** PrestoSports photos redirect to a CDN behind a bot challenge that refuses hotlinks; showing them yields broken images. */
export const hotlinkable = (url: string | null | undefined): boolean => !!url && !/prestosports\.com|\/sports\/[a-z]+\/\d{4}-\d{2}\/photos\//i.test(url);

/** Team category rows only (individual rows carry a player id or a three-part subject), best rank per label. */
export function teamCategories<T extends { label?: string | null; poll: string; rank: number; value: unknown; week_of: string; player_season_id?: string | null; subject_name?: string | null }>(rows: T[]): { category: string; rank: number; value: unknown; week_of: string }[] {
  const best = new Map<string, { category: string; rank: number; value: unknown; week_of: string }>();
  for (const r of rows) {
    if (!r.poll.startsWith('ncaa:') || r.player_season_id) continue;
    if (r.subject_name && r.subject_name.split('|').length > 2) continue;
    const category = r.label ?? r.poll;
    const cur = best.get(category);
    if (!cur || r.rank < cur.rank) best.set(category, { category, rank: r.rank, value: r.value, week_of: r.week_of });
  }
  return [...best.values()].sort((a, b) => a.rank - b.rank);
}
