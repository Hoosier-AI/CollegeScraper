// Match a school-site box score / schedule entry to the canonical game row (date + program pair).
export interface GameKey { date: string; homeProgramId: string; awayProgramId: string }

/** Games on neighbouring days (time zones, late kickoffs) still match when the pair of programs is the same. */
export function dateCandidates(isoDate: string): string[] {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  const prev = new Date(d); prev.setUTCDate(d.getUTCDate() - 1);
  const next = new Date(d); next.setUTCDate(d.getUTCDate() + 1);
  return [fmt(d), fmt(prev), fmt(next)];
}

export interface ExistingGame { id: string; game_date: string; home_program_id: string | null; away_program_id: string | null; home_score: number | null; away_score: number | null; ncaa_contest_id: number | null }

/** Find an existing game for two programs around a date; prefers exact date, then ±1 day. */
export function findGame<T extends ExistingGame>(games: T[], date: string, a: string, b: string): T | null {
  const dates = dateCandidates(date);
  for (const d of dates) {
    const hit = games.find((g) => g.game_date === d && ((g.home_program_id === a && g.away_program_id === b) || (g.home_program_id === b && g.away_program_id === a)));
    if (hit) return hit;
  }
  return null;
}
