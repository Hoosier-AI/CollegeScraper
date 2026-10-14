// Pure: the Rating Percentage Index, the NCAA's selection metric, from results.
//   RPI = 0.25 * WP + 0.50 * OWP + 0.25 * OOWP
//   WP   the team's winning percentage, ties worth `tie` of a win; wins and losses can be weighted by venue (a road win
//        counts more, a home win less, as the NCAA does in some sports)
//   OWP  for each game, the opponent's winning percentage without its games against this team (unweighted), averaged
//        over the team's games (an opponent met twice counts twice)
//   OOWP for each game, the opponent's OWP, averaged the same way
// Only games between teams of the pool count (the NCAA's D1 RPI leaves out games against non-Division I opponents).
// The settings were chosen by matching NCAA.com's published D1 order (RPI_DEFAULT).

export interface RpiGame { home: string; away: string; hs: number; as: number; neutral: boolean }
/** tie: a tie's worth in the team's own WP; tieOpp: in its opponents' (OWP, OOWP), when different. */
export interface RpiOptions { tie: number; tieOpp?: number; homeWin: number; roadWin: number; homeLoss: number; roadLoss: number }
// Chosen 2026-10-14 against NCAA.com's D1 order through Oct. 13 (every team matched): a tie worth a third of a win in
// the team's own WP and half in its opponents', no venue weights. Spearman 0.9967 women (top 25 off by 1.0 place on
// average), 0.9922 men; venue weights and other tie values all matched worse.
export const RPI_DEFAULT: RpiOptions = { tie: 1 / 3, tieOpp: 0.5, homeWin: 1, roadWin: 1, homeLoss: 1, roadLoss: 1 };
export interface RpiRow { team: string; w: number; l: number; t: number; wp: number; owp: number; oowp: number; rpi: number }

interface Line { opp: string; result: 'W' | 'L' | 'T'; venue: 'home' | 'road' | 'neutral' }

export function computeRpi(games: RpiGame[], pool: Set<string>, o: RpiOptions = RPI_DEFAULT): Map<string, RpiRow> {
  const lines = new Map<string, Line[]>();
  const add = (t: string, l: Line) => { const a = lines.get(t); if (a) a.push(l); else lines.set(t, [l]); };
  for (const g of games) {
    if (!pool.has(g.home) || !pool.has(g.away) || g.home === g.away) continue;
    const hr: Line['result'] = g.hs > g.as ? 'W' : g.hs < g.as ? 'L' : 'T';
    const ar: Line['result'] = hr === 'W' ? 'L' : hr === 'L' ? 'W' : 'T';
    add(g.home, { opp: g.away, result: hr, venue: g.neutral ? 'neutral' : 'home' });
    add(g.away, { opp: g.home, result: ar, venue: g.neutral ? 'neutral' : 'road' });
  }
  // Weighted WP (the team's own) and plain WP without one opponent (for OWP).
  const wp = new Map<string, number>();
  for (const [t, ls] of lines) {
    let w = 0, n = 0;
    for (const l of ls) {
      const wt = l.result === 'W' ? (l.venue === 'home' ? o.homeWin : l.venue === 'road' ? o.roadWin : 1) : l.result === 'L' ? (l.venue === 'home' ? o.homeLoss : l.venue === 'road' ? o.roadLoss : 1) : 1;
      if (l.result === 'W') w += wt; if (l.result === 'T') w += o.tie * wt;
      n += wt;
    }
    wp.set(t, n ? w / n : 0);
  }
  const wpWithout = (t: string, opp: string) => {
    let w = 0, n = 0;
    for (const l of lines.get(t) ?? []) { if (l.opp === opp) continue; n += 1; if (l.result === 'W') w += 1; else if (l.result === 'T') w += o.tieOpp ?? o.tie; }
    return n ? w / n : null;
  };
  const owp = new Map<string, number>();
  for (const [t, ls] of lines) {
    const vals = ls.map((l) => wpWithout(l.opp, t)).filter((v): v is number => v != null);
    owp.set(t, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  }
  const out = new Map<string, RpiRow>();
  for (const [t, ls] of lines) {
    const oowp = ls.reduce((a, l) => a + (owp.get(l.opp) ?? 0), 0) / ls.length;
    const w = ls.filter((l) => l.result === 'W').length, l = ls.filter((x) => x.result === 'L').length;
    const row = { team: t, w, l, t: ls.length - w - l, wp: wp.get(t)!, owp: owp.get(t)!, oowp, rpi: 0 };
    row.rpi = 0.25 * row.wp + 0.5 * row.owp + 0.25 * row.oowp;
    out.set(t, row);
  }
  return out;
}

/** Spearman rank correlation between two orders of the same items (1 is identical). */
export function spearman(a: string[], b: string[]): number {
  const common = a.filter((x) => b.includes(x));
  const n = common.length; if (n < 2) return 0;
  const ra = new Map(common.map((x, i) => [x, i])), rb = new Map(b.filter((x) => ra.has(x)).map((x, i) => [x, i]));
  let d2 = 0; for (const x of common) d2 += (ra.get(x)! - rb.get(x)!) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}
