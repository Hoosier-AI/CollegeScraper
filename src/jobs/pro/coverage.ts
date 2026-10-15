// What the provider covers for a competition season (pro_seasons.coverage): no job here, so pages can read it too.
/** Coverage flags of a competition season: does the provider have events, lineups and match stats for it? A season it
 *  says nothing about counts as yes (most do). */
export type DetailCoverage = { events: boolean; lineups: boolean; stats: boolean };
export const coverageOf = (c: { fixtures?: { events?: boolean; lineups?: boolean; statistics_fixtures?: boolean } } | null | undefined): DetailCoverage =>
  ({ events: c?.fixtures?.events !== false, lineups: c?.fixtures?.lineups !== false, stats: c?.fixtures?.statistics_fixtures !== false });
