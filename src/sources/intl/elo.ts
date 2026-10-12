// Pure: Plaibook Elo for national teams, worked out from every result since 1872 with the World Football Elo method
// (the published formula; our own numbers, never called FIFA's or eloratings.net's):
//   new = old + K * G * (W - We)       We = 1 / (10^(-dr/400) + 1), dr = rating difference (+100 for the home side
//                                      unless neutral)
//   K   = 60 World Cup, 50 continental championships and the Confederations Cup, 40 qualifiers and nations leagues,
//         30 other tournaments, 20 friendlies
//   G   = 1 (win by 0-1 goals), 1.5 (by 2), (11 + n) / 8 (by 3+)
//   W   = 1 win, 0.5 draw (a shoot-out is a draw), 0 loss
// Every side starts at 1500.

export const START = 1500;
export const HOME_EDGE = 100;

const CONTINENTAL = /^(UEFA Euro|Copa América|African Cup of Nations|AFC Asian Cup|Gold Cup|CONCACAF Championship|Oceania Nations Cup|Confederations Cup)$/;

export function kFactor(tournament: string): number {
  if (tournament === 'FIFA World Cup' || tournament === "FIFA Women's World Cup") return 60;
  if (CONTINENTAL.test(tournament)) return 50;
  if (/qualification|nations league/i.test(tournament)) return 40;
  if (/^friendly$/i.test(tournament)) return 20;
  return 30;
}

export function goalFactor(diff: number): number {
  const n = Math.abs(diff);
  return n <= 1 ? 1 : n === 2 ? 1.5 : (11 + n) / 8;
}

export const expected = (dr: number) => 1 / (10 ** (-dr / 400) + 1);

export interface EloMatch { date: string; home: string; away: string; home_score: number | null; away_score: number | null; tournament: string; neutral: boolean | null }
export interface EloStep { date: string; nation: string; rating: number; delta: number; opponent: string; tournament: string }

/** Ratings after every match, in date order (the input order within a day). Matches without a score are skipped. */
export function runElo(matches: EloMatch[]): { steps: EloStep[]; ratings: Map<string, number>; played: Map<string, { n: number; last: string }> } {
  const ratings = new Map<string, number>();
  const played = new Map<string, { n: number; last: string }>();
  const steps: EloStep[] = [];
  const sorted = [...matches].filter((m) => m.home_score != null && m.away_score != null).sort((a, b) => a.date.localeCompare(b.date));
  for (const m of sorted) {
    const rh = ratings.get(m.home) ?? START, ra = ratings.get(m.away) ?? START;
    const dr = rh + (m.neutral ? 0 : HOME_EDGE) - ra;
    const we = expected(dr);
    const diff = m.home_score! - m.away_score!;
    const w = diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
    const change = kFactor(m.tournament) * goalFactor(diff) * (w - we);
    ratings.set(m.home, rh + change); ratings.set(m.away, ra - change);
    for (const side of [m.home, m.away]) { const p = played.get(side) ?? { n: 0, last: m.date }; p.n += 1; p.last = m.date; played.set(side, p); }
    steps.push({ date: m.date, nation: m.home, rating: rh + change, delta: change, opponent: m.away, tournament: m.tournament });
    steps.push({ date: m.date, nation: m.away, rating: ra - change, delta: -change, opponent: m.home, tournament: m.tournament });
  }
  return { steps, ratings, played };
}
