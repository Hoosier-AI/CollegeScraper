// Pure: Plaibook Elo for national teams, worked out from every result since 1872 with the World Football Elo method
// (the published formula; our own numbers, never called FIFA's or eloratings.net's):
//   new = old + K * G * (W - We)       We = 1 / (10^(-dr/400) + 1), dr = rating difference (+100 for the home side
//                                      unless neutral)
//   K   = 60 World Cup (and the Olympics 1908-1980), 50 continental championships and the Confederations Cup, 40
//         qualifiers and nations leagues, 30 other tournaments, 20 friendlies
//   G   = 1 (win by 0-1 goals), 1.5 (by 2), (11 + n) / 8 (by 3+)
//   W   = 1 win, 0.5 draw (a shoot-out is a draw), 0 loss
// Every side starts at 1500 and is provisional for its first PROVISIONAL matches: only its own rating moves against
// an established side. Without that, each of the ~300 sides that joined after 1872 (most far weaker than 1500) handed
// the points it lost on the way down to the established sides, and every rating crept upward decade after decade:
// Spain stood 65 points above the published ratings, Hungary's 1954 side 250 below its peak, and every nation's
// "best" fell in the 2020s (2026-10-13). With it, today's ratings are within about 25 points of the published ones.
//
// Ratings from different eras do not compare (the pool of sides changes), so a side's best is its best world rank:
// see bestRanks.

export const START = 1500;
export const HOME_EDGE = 100;
/** Matches before a side's rating moves the sides it plays. */
export const PROVISIONAL = 15;

// Tournament names as martj42 and API-Football write them ("UEFA Euro" / "Euro Championship", "World Cup - Women").
const WORLD_CUP = /^(FIFA )?(Women's )?World Cup( - Women)?$/i;
const CONTINENTAL = /^(UEFA Euro|Euro Championship|UEFA Championship - Women|Copa Am[eé]rica( Femenina)?|African Cup of Nations|Africa Cup of Nations( - Women)?|(AFC )?Asian Cup( Women)?|(CONCACAF )?Gold Cup( - Women)?|CONCACAF Championship|Oceania Nations Cup|OFC Nations Cup|Confederations Cup)$/i;

export function kFactor(tournament: string, date?: string): number {
  if (WORLD_CUP.test(tournament)) return 60;
  // The Olympic tournament was the world championship before the World Cup, and senior until 1980.
  if (/^Olympic Games$/i.test(tournament) && (!date || date <= '1980-12-31')) return 60;
  if (CONTINENTAL.test(tournament)) return 50;
  if (/qualification|nations league/i.test(tournament)) return 40;
  if (/^friendl(y|ies)( women)?$/i.test(tournament)) return 20;
  return 30;
}

export function goalFactor(diff: number): number {
  const n = Math.abs(diff);
  return n <= 1 ? 1 : n === 2 ? 1.5 : (11 + n) / 8;
}

export const expected = (dr: number) => 1 / (10 ** (-dr / 400) + 1);

export interface EloMatch { date: string; home: string; away: string; home_score: number | null; away_score: number | null; tournament: string; neutral: boolean | null }
export interface EloStep { date: string; nation: string; rating: number; delta: number; opponent: string; tournament: string }
const scored = (matches: EloMatch[]) => [...matches].filter((m) => m.home_score != null && m.away_score != null).sort((a, b) => a.date.localeCompare(b.date));
const resultOf = (m: EloMatch) => { const d = m.home_score! - m.away_score!; return { diff: d, w: d > 0 ? 1 : d < 0 ? 0 : 0.5 }; };

/** Ratings after every match, in date order (the input order within a day). Matches without a score are skipped. */
export function runElo(matches: EloMatch[], o: { provisional?: number } = {}): { steps: EloStep[]; ratings: Map<string, number>; played: Map<string, { n: number; last: string }> } {
  const provisional = o.provisional ?? PROVISIONAL;
  const ratings = new Map<string, number>();
  const played = new Map<string, { n: number; last: string }>();
  const steps: EloStep[] = [];
  for (const m of scored(matches)) {
    const rh = ratings.get(m.home) ?? START, ra = ratings.get(m.away) ?? START;
    const dr = rh + (m.neutral ? 0 : HOME_EDGE) - ra;
    const { diff, w } = resultOf(m);
    const change = kFactor(m.tournament, m.date) * goalFactor(diff) * (w - expected(dr));
    // A provisional side's results move only its own rating against an established side.
    const ph = (played.get(m.home)?.n ?? 0) < provisional, pa = (played.get(m.away)?.n ?? 0) < provisional;
    const dh = pa && !ph ? 0 : change, da = ph && !pa ? 0 : -change;
    ratings.set(m.home, rh + dh); ratings.set(m.away, ra + da);
    for (const side of [m.home, m.away]) { const p = played.get(side) ?? { n: 0, last: m.date }; p.n += 1; p.last = m.date; played.set(side, p); }
    steps.push({ date: m.date, nation: m.home, rating: rh + dh, delta: dh, opponent: m.away, tournament: m.tournament });
    steps.push({ date: m.date, nation: m.away, rating: ra + da, delta: da, opponent: m.home, tournament: m.tournament });
  }
  return { steps, ratings, played };
}

/** FIFA members among the results: every side that has played the World Cup or its qualifiers. */
export const worldCupSides = (matches: { home: string; away: string; tournament: string }[]) =>
  new Set(matches.filter((m) => /world cup/i.test(m.tournament)).flatMap((m) => [m.home, m.away]));

// ---------- best world rank ----------
/** A side's best world rank: the month, and its lead over the next side then (ties go to the most dominant spell). */
export interface BestRank { rank: number; month: string; margin: number }

/** Each side's confederation, from the continental competitions it has played (the most often). */
const CONTINENT: [RegExp, string][] = [
  [/UEFA|\bEuro\b|European/i, 'UEFA'], [/Copa Am|CONMEBOL|South American/i, 'CONMEBOL'],
  [/Gold Cup|CONCACAF|CFU|UNCAF|CCCF|NAFC|Caribbean/i, 'CONCACAF'], [/African|Africa|\bCAF\b|COSAFA|CECAFA|WAFU|UDEAC|Amílcar/i, 'CAF'],
  [/\bAFC\b|Asian|Gulf|SAFF|AFF|EAFF|WAFF|Arab/i, 'AFC'], [/Oceania|OFC|Pacific|Melanesia|Polynesia/i, 'OFC'],
];
export function confederationsFrom(matches: { home: string; away: string; tournament: string }[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const m of matches) {
    const c = CONTINENT.find(([re]) => re.test(m.tournament))?.[1];
    if (!c) continue;
    for (const t of [m.home, m.away]) { const v = votes.get(t) ?? new Map<string, number>(); v.set(c, (v.get(c) ?? 0) + 1); votes.set(t, v); }
  }
  return new Map([...votes].map(([t, v]) => [t, [...v].sort((a, b) => b[1] - a[1])[0]![0]]));
}

/**
 * Best world ranks from month-end tables. Before the 1970s the regions seldom met, and each started from the same 1500,
 * so a strong side in a weak region ranked among the world's best (Costa Rica first in 1965). The tables add a level
 * per confederation that only results between confederations move (a quarter of each such result), and rank only
 * sides whose place is earned against the world: 30+ matches (where Elo ratings settle), a match in the last four
 * years, 5+ matches against other confederations in the last eight, in a table of 20+ such sides. The ratings shown
 * stay the plain Elo above (the published method); this only decides the best rank (2026-10-13).
 */
export function bestRanks(matches: EloMatch[], o: { members: Set<string>; confederations: Map<string, string>; lambda?: number; minMatches?: number; minInter?: number; minPool?: number }): Map<string, BestRank> {
  const lambda = o.lambda ?? 0.25, minMatches = o.minMatches ?? 30, minInter = o.minInter ?? 5, minPool = o.minPool ?? 20;
  const team = new Map<string, number>(), level = new Map<string, number>(), n = new Map<string, number>(), last = new Map<string, string>(), inter = new Map<string, string[]>();
  const rating = (t: string) => (team.get(t) ?? START) + (level.get(o.confederations.get(t) ?? '') ?? 0);
  const best = new Map<string, BestRank>();
  const table = (month: string) => {
    const y = Number(month.slice(0, 4));
    const since4 = `${y - 4}${month.slice(4)}`, since8 = `${y - 8}${month.slice(4)}`;
    const pool = [...team.keys()].filter((t) => o.members.has(t) && (n.get(t) ?? 0) >= minMatches && (last.get(t) ?? '') >= since4 && (inter.get(t) ?? []).filter((d) => d >= since8).length >= minInter)
      .map((t) => [t, rating(t)] as const).sort((a, b) => b[1] - a[1]);
    if (pool.length < minPool) return;
    pool.forEach(([t, r], i) => {
      const margin = r - (pool[i + 1]?.[1] ?? r);
      const b = best.get(t);
      if (!b || i + 1 < b.rank || (i + 1 === b.rank && margin > b.margin)) best.set(t, { rank: i + 1, month, margin });
    });
  };
  let month = '';
  for (const m of scored(matches)) {
    const mm = m.date.slice(0, 7);
    if (mm !== month) { if (month) table(month); month = mm; }
    const { diff, w } = resultOf(m);
    const change = kFactor(m.tournament, m.date) * goalFactor(diff) * (w - expected(rating(m.home) + (m.neutral ? 0 : HOME_EDGE) - rating(m.away)));
    const ph = (n.get(m.home) ?? 0) < PROVISIONAL, pa = (n.get(m.away) ?? 0) < PROVISIONAL;
    team.set(m.home, (team.get(m.home) ?? START) + (pa && !ph ? 0 : change));
    team.set(m.away, (team.get(m.away) ?? START) - (ph && !pa ? 0 : change));
    const ch = o.confederations.get(m.home), ca = o.confederations.get(m.away);
    if (ch && ca && ch !== ca) {
      if (!ph && !pa) { level.set(ch, (level.get(ch) ?? 0) + lambda * change); level.set(ca, (level.get(ca) ?? 0) - lambda * change); }
      for (const t of [m.home, m.away]) inter.set(t, [...(inter.get(t) ?? []), m.date]);
    }
    for (const t of [m.home, m.away]) { n.set(t, (n.get(t) ?? 0) + 1); last.set(t, m.date); }
  }
  if (month) table(month);
  return best;
}
