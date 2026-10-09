// American Soccer Analysis (app.americansocceranalysis.com/api/v1): the US leagues it covers, mapped onto
// API-Football competition ids, and its season names. Free public API; their only ask is credit, which every page
// showing their numbers carries (see ASA_CREDIT).

export const ASA_BASE = 'https://app.americansocceranalysis.com/api/v1';
export const ASA_CREDIT = { name: 'American Soccer Analysis', url: 'https://www.americansocceranalysis.com' };

export interface AsaLeague { slug: string; league: number; first: number; name: string }

/** first: the first season ASA has games for. */
export const ASA_LEAGUES: AsaLeague[] = [
  { slug: 'mls', league: 253, first: 2013, name: 'MLS' },
  { slug: 'nwsl', league: 254, first: 2016, name: 'NWSL' },
  { slug: 'uslc', league: 255, first: 2017, name: 'USL Championship' },
  { slug: 'usl1', league: 489, first: 2019, name: 'USL League One' },
  { slug: 'mlsnp', league: 909, first: 2022, name: 'MLS Next Pro' },
  { slug: 'usls', league: 1130, first: 2024, name: 'USL Super League' },
];

export const asaLeagueFor = (league: number): AsaLeague | undefined => ASA_LEAGUES.find((l) => l.league === league);

/** ASA covers this league season (planner: API-Football's paged season totals are not needed for it). */
export const asaCovers = (league: number, season: number): boolean => { const l = asaLeagueFor(league); return !!l && season >= l.first; };

/**
 * Season name both ways. Calendar-year leagues use "2025"; the USL Super League runs August to June as "2025-26",
 * which API-Football files under its starting year.
 */
export const seasonOfName = (name: string): number | null => { const m = /^(\d{4})/.exec(String(name ?? '')); return m ? Number(m[1]) : null; };
export const nameOfSeason = (slug: string, season: number): string => (slug === 'usls' ? `${season}-${String((season + 1) % 100).padStart(2, '0')}` : String(season));
