// A school's pro alumni, one line per player. A player can hold more than one link to the same school (the college
// written two ways, "Indiana" and "Indiana University", both resolving to it), which listed him twice on the team page.

export interface Alumnus { id: number; college_years: number[]; minutes_recent: number }

/** One entry per player: the first kept, its college years widened to cover every link's. Most recent minutes first. */
export function mergeAlumni<T extends Alumnus>(players: T[]): T[] {
  const byId = new Map<number, T>();
  for (const p of players) {
    const seen = byId.get(p.id);
    if (!seen) { byId.set(p.id, { ...p, college_years: [...p.college_years] }); continue; }
    const years = [...seen.college_years, ...p.college_years].filter((y) => y != null);
    seen.college_years = years.length ? [Math.min(...years), Math.max(...years)] : [];
  }
  return [...byId.values()].sort((a, b) => b.minutes_recent - a.minutes_recent);
}
