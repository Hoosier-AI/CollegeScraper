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
// Regions that seldom meet: a side's rating is its own Elo plus a level for its confederation. A result between two
// confederations moves the winner's rating by the full K * G * (W - We) as above, a tenth of it through the level, so
// its whole confederation shares a little of what that result says about the region. Without the level, sides in a
// region that mostly played itself kept the 1500 they started from: Ghana stood first in the world in 1966, Mexico in
// 1965 and 1990, and today Oceania sat ~190 points, CONCACAF ~70 and Asia ~55 points above the published ratings.
// Measured against the published ratings (2026-10-13): each side's best world rank, log error 0.47 -> 0.25 over 92
// sides; today's ratings, average gap +-47 -> +-26 points over 205 sides; the order of today's top 50 unchanged.
//
// Ratings from different eras do not compare (the pool of sides changes), so a side's best is its best world rank,
// from month-end tables of the same ratings the charts show: see RankRules.

export const START = 1500;
export const HOME_EDGE = 100;
/** Matches before a side's rating moves the sides it plays. */
export const PROVISIONAL = 15;
/** The share of a result between two confederations that moves the confederation's level. */
export const CONFED_SHARE = 0.1;

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
/** One side's move in one match, with everything that explains it (the chart's "why"). */
export interface EloStep {
  date: string; nation: string; rating: number; delta: number; opponent: string; tournament: string;
  /** The score from this side's view. */ gf: number; ga: number;
  /** The opponent's rating before the match, this side's expected score (0..1), the match weight and the goal factor. */
  oppRating: number; expected: number; k: number; goalFactor: number;
  venue: 'home' | 'away' | 'neutral';
}
const scored = (matches: EloMatch[]) => [...matches].filter((m) => m.home_score != null && m.away_score != null).sort((a, b) => a.date.localeCompare(b.date));
const resultOf = (m: EloMatch) => { const d = m.home_score! - m.away_score!; return { diff: d, w: d > 0 ? 1 : d < 0 ? 0 : 0.5 }; };

/** Which sides a month-end world ranking table holds: FIFA members (`members`) with `minMatches`+ matches (where Elo
 *  ratings settle), a match in the last four years and `minInter`+ matches ever against other confederations, in a
 *  table of `minPool`+ such sides (so no 19th-century "world" of four). The table for the last month (or `asOf`'s) is
 *  today's world ranking. */
export interface RankRules { members: Set<string>; minMatches?: number; minInter?: number; minPool?: number; asOf?: string }
/** A side's best world rank and the first month it held it. */
export interface BestRank { rank: number; month: string }

/** Ratings after every match, in date order (the input order within a day). Matches without a score are skipped. With
 *  `confederations`, each side's rating carries its confederation's level; with `ranks`, the month-end world rank
 *  tables too: every side's rank history, its best rank, and today's rank (`current`). */
export function runElo(matches: EloMatch[], o: { provisional?: number; confederations?: Map<string, string>; share?: number; ranks?: RankRules } = {}): {
  steps: EloStep[]; ratings: Map<string, number>; played: Map<string, { n: number; last: string }>;
  best: Map<string, BestRank>; history: Map<string, { m: string; r: number }[]>; current: Map<string, number>; levels: Map<string, number>;
} {
  const provisional = o.provisional ?? PROVISIONAL, share = o.share ?? CONFED_SHARE, confs = o.confederations ?? new Map<string, string>();
  const team = new Map<string, number>(), levels = new Map<string, number>(), inter = new Map<string, number>();
  const rating = (t: string) => (team.get(t) ?? START) + (levels.get(confs.get(t) ?? '') ?? 0);
  const played = new Map<string, { n: number; last: string }>();
  const steps: EloStep[] = [];
  const best = new Map<string, BestRank>(), history = new Map<string, { m: string; r: number }[]>(), current = new Map<string, number>();
  const rules = o.ranks;
  const table = (month: string) => {
    if (!rules) return;
    const since4 = `${Number(month.slice(0, 4)) - 4}${month.slice(4)}`;
    const pool = [...team.keys()].filter((t) => rules.members.has(t) && (played.get(t)?.n ?? 0) >= (rules.minMatches ?? 30) && (played.get(t)?.last ?? '') >= since4 && (inter.get(t) ?? 0) >= (rules.minInter ?? 3))
      .map((t) => [t, rating(t)] as const).sort((a, b) => b[1] - a[1]);
    if (pool.length < (rules.minPool ?? 20)) return;
    pool.forEach(([t], i) => {
      const b = best.get(t);
      if (!b || i + 1 < b.rank) best.set(t, { rank: i + 1, month });
      const h = history.get(t) ?? []; h.push({ m: month, r: i + 1 }); history.set(t, h);
    });
  };
  let month = '';
  for (const m of scored(matches)) {
    const mm = m.date.slice(0, 7);
    if (mm !== month) { if (month) table(month); month = mm; }
    const rh = rating(m.home), ra = rating(m.away);
    const dr = rh + (m.neutral ? 0 : HOME_EDGE) - ra;
    const { diff, w } = resultOf(m);
    const k = kFactor(m.tournament, m.date), g = goalFactor(diff), we = expected(dr);
    const change = k * g * (w - we);
    // A provisional side's results move only its own rating against an established side.
    const ph = (played.get(m.home)?.n ?? 0) < provisional, pa = (played.get(m.away)?.n ?? 0) < provisional;
    const dh = pa && !ph ? 0 : change, da = ph && !pa ? 0 : -change;
    // Between two established sides of different confederations, a share of the move goes through the levels.
    const ch = confs.get(m.home), ca = confs.get(m.away), across = !!ch && !!ca && ch !== ca;
    const viaLevel = across && !ph && !pa ? share : 0;
    team.set(m.home, (team.get(m.home) ?? START) + dh * (1 - viaLevel)); team.set(m.away, (team.get(m.away) ?? START) + da * (1 - viaLevel));
    if (viaLevel) { levels.set(ch!, (levels.get(ch!) ?? 0) + viaLevel * dh); levels.set(ca!, (levels.get(ca!) ?? 0) + viaLevel * da); }
    if (across) for (const side of [m.home, m.away]) inter.set(side, (inter.get(side) ?? 0) + 1);
    for (const side of [m.home, m.away]) { const p = played.get(side) ?? { n: 0, last: m.date }; p.n += 1; p.last = m.date; played.set(side, p); }
    const common = { date: m.date, tournament: m.tournament, k, goalFactor: g };
    steps.push({ ...common, nation: m.home, rating: rh + dh, delta: dh, opponent: m.away, gf: m.home_score!, ga: m.away_score!, oppRating: ra, expected: we, venue: m.neutral ? 'neutral' : 'home' });
    steps.push({ ...common, nation: m.away, rating: ra + da, delta: da, opponent: m.home, gf: m.away_score!, ga: m.home_score!, oppRating: rh, expected: 1 - we, venue: m.neutral ? 'neutral' : 'away' });
  }
  if (month) table(month);
  // Today's table: the month of `asOf` (when later than the last result), whose last row per side is its rank now.
  const now = (o.ranks?.asOf ?? '').slice(0, 7);
  if (rules && now > month) table(now);
  const lastMonth = now > month ? now : month;
  for (const [t, h] of history) { const l = h[h.length - 1]!; if (l.m === lastMonth) current.set(t, l.r); }
  const ratings = new Map([...team.keys()].map((t) => [t, rating(t)]));
  return { steps, ratings, played, best, history, current, levels };
}

/** FIFA members among the results: every side that has played the World Cup or its qualifiers. */
export const worldCupSides = (matches: { home: string; away: string; tournament: string }[]) =>
  new Set(matches.filter((m) => /world cup/i.test(m.tournament)).flatMap((m) => [m.home, m.away]));

// ---------- confederations ----------
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

// ---------- win, draw, win ----------
/** How often a match is drawn, by how even it was expected to be: ten buckets of |expected − 0.5|, from every result
 *  (an even match is drawn about a quarter of the time, a mismatch seldom). */
export type DrawModel = number[];
/** Where the intl-elo job keeps each game's draw model (college_kv). */
export const DRAW_MODEL_KEY = (gender: 'm' | 'w') => `intl:elo:draw:${gender}`;
const bucketOf = (we: number) => Math.min(9, Math.floor(Math.abs(we - 0.5) * 20));

export function drawModel(steps: EloStep[]): DrawModel {
  const draws = new Array(10).fill(0), all = new Array(10).fill(0);
  // runElo writes each match as two steps, the home (first-listed) side first: count each match once.
  for (let i = 0; i < steps.length; i += 2) {
    const s = steps[i]!, b = bucketOf(s.expected);
    all[b] += 1; if (s.gf === s.ga) draws[b] += 1;
  }
  return all.map((n, i) => (n >= 30 ? Math.round((draws[i] / n) * 1000) / 1000 : [0.27, 0.26, 0.24, 0.22, 0.2, 0.17, 0.14, 0.11, 0.08, 0.05][i]!));
}

/** Win, draw and loss chances for a side whose expected score is `we` (they add up to 1). */
export function predict(we: number, model: DrawModel): { win: number; draw: number; loss: number } {
  const draw = Math.min(model[bucketOf(we)] ?? 0.2, 2 * Math.min(we, 1 - we));
  const win = Math.max(0, we - draw / 2), loss = Math.max(0, 1 - we - draw / 2);
  const total = win + draw + loss;
  return { win: win / total, draw: draw / total, loss: loss / total };
}
