// Pure: the rest of a college season played many times over (Opta-supercomputer style), for each team's chances of
// winning its conference, taking the automatic bid, making the NCAA tournament and being seeded.
//   - every remaining game is drawn from Plaibook Elo's win/draw/loss chances (home edge, the stored draw model);
//   - the conference table is points (3/1/0) from conference games, then goal difference, then a coin;
//   - the conference tournament is approximated as a four-team knockout of the table's top four (formats differ and
//     we do not hold them); a level knockout goes to penalties, a coin. Its winner takes the automatic bid;
//   - the season's RPI is recomputed with the simulated results; the best RPIs not already in fill the at-large
//     places; the top `seeds` RPIs in the field are the seeds.
// Plus what needs no simulation: points now, the most a team can still reach, clinched, eliminated, magic number.
import { computeRpi, RPI_DEFAULT, type RpiGame } from './rpi.js';
import { expected, predict, type DrawModel } from '../sources/intl/elo.js';

export interface SimTeam { id: string; rating: number; conf: string | null }
export interface PlayedGame extends RpiGame { conf: boolean }
export interface SimGame { home: string; away: string; neutral: boolean; conf: boolean }
export interface SimInput {
  teams: SimTeam[];
  played: PlayedGame[];
  remaining: SimGame[];
  /** Conferences whose champion takes an automatic bid. */
  autoConfs: Set<string>;
  /** Tournament field size (null: conference odds only, as for D2 and D3). */
  field: number | null;
  seeds: number;
  sims: number;
  draw: DrawModel;
  homeEdge: number;
  rng?: () => number;
}
export interface SimOdds {
  team: string; conf: string | null;
  reg_title: number; auto_bid: number; bid: number | null; seed: number | null; avg_rank: number | null; avg_points: number;
  points_now: number; max_points: number; left: number; clinched: boolean; eliminated: boolean; magic: number | null;
}

/** A seeded random number generator (mulberry32), so a run can be repeated. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Row { pts: number; gd: number }

/** Points, goal difference and conference games left, from the conference games played so far. */
export function confTables(teams: SimTeam[], played: PlayedGame[], remaining: SimGame[]) {
  const confOf = new Map(teams.map((t) => [t.id, t.conf]));
  const row = new Map<string, Row>(teams.map((t) => [t.id, { pts: 0, gd: 0 }]));
  const left = new Map<string, number>(teams.map((t) => [t.id, 0]));
  const same = (a: string, b: string) => { const c = confOf.get(a); return c != null && c === confOf.get(b); };
  for (const g of played) {
    if (!g.conf || !same(g.home, g.away)) continue;
    const h = row.get(g.home)!, a = row.get(g.away)!;
    h.gd += g.hs - g.as; a.gd += g.as - g.hs;
    if (g.hs > g.as) h.pts += 3; else if (g.hs < g.as) a.pts += 3; else { h.pts += 1; a.pts += 1; }
  }
  for (const g of remaining) if (g.conf && same(g.home, g.away)) { left.set(g.home, left.get(g.home)! + 1); left.set(g.away, left.get(g.away)! + 1); }
  return { row, left, same };
}

/** Clinched (the title is theirs, at least shared), eliminated (cannot reach the leader's points), and the leader's
 *  magic number: points it still needs to be sure of at least a share whatever the others do. */
export function magicNumbers(teams: SimTeam[], row: Map<string, Row>, left: Map<string, number>) {
  const out = new Map<string, { points_now: number; max_points: number; left: number; clinched: boolean; eliminated: boolean; magic: number | null }>();
  const byConf = new Map<string, SimTeam[]>();
  for (const t of teams) if (t.conf) byConf.set(t.conf, [...(byConf.get(t.conf) ?? []), t]);
  for (const t of teams) {
    const pts = row.get(t.id)!.pts, l = left.get(t.id)!, max = pts + 3 * l;
    const others = (t.conf ? byConf.get(t.conf)! : []).filter((o) => o.id !== t.id);
    const othersMax = Math.max(0, ...others.map((o) => row.get(o.id)!.pts + 3 * left.get(o.id)!));
    const othersNow = Math.max(0, ...others.map((o) => row.get(o.id)!.pts));
    const leader = others.every((o) => row.get(o.id)!.pts <= pts);
    const clinched = others.length > 0 && pts >= othersMax;
    out.set(t.id, { points_now: pts, max_points: max, left: l, clinched, eliminated: others.length > 0 && max < othersNow, magic: leader && !clinched ? othersMax - pts : null });
  }
  return out;
}

export function simulate(input: SimInput): SimOdds[] {
  const rng = input.rng ?? Math.random;
  const rating = new Map(input.teams.map((t) => [t.id, t.rating]));
  const pool = new Set(input.teams.map((t) => t.id));
  const { row: base, left, same } = confTables(input.teams, input.played, input.remaining);
  const magic = magicNumbers(input.teams, base, left);
  const confs = new Map<string, string[]>();
  for (const t of input.teams) if (t.conf) confs.set(t.conf, [...(confs.get(t.conf) ?? []), t.id]);
  // Chances for each remaining game once (they do not change between runs).
  const chance = (h: string, a: string, neutral: boolean) => predict(expected((rating.get(h) ?? 1500) + (neutral ? 0 : input.homeEdge) - (rating.get(a) ?? 1500)), input.draw);
  const pre = input.remaining.map((g) => ({ g, p: chance(g.home, g.away, g.neutral) }));
  const tally = new Map(input.teams.map((t) => [t.id, { reg: 0, auto: 0, bid: 0, seed: 0, rank: 0, pts: 0 }]));
  const playedPool = input.played.filter((g) => pool.has(g.home) && pool.has(g.away));

  for (let s = 0; s < input.sims; s++) {
    const row = new Map([...base].map(([k, v]) => [k, { pts: v.pts, gd: v.gd }]));
    const games: RpiGame[] = [...playedPool];
    for (const { g, p } of pre) {
      const r = rng();
      const res = r < p.win ? 1 : r < p.win + p.draw ? 0 : -1;
      const margin = res === 0 ? 0 : rng() < 0.6 ? 1 : 2;
      games.push({ home: g.home, away: g.away, hs: res > 0 ? margin : 0, as: res < 0 ? margin : 0, neutral: g.neutral });
      if (g.conf && same(g.home, g.away)) {
        const h = row.get(g.home)!, a = row.get(g.away)!;
        if (res > 0) { h.pts += 3; h.gd += margin; a.gd -= margin; } else if (res < 0) { a.pts += 3; a.gd += margin; h.gd -= margin; } else { h.pts += 1; a.pts += 1; }
      }
    }
    // Conference tables, champions and the knockout for the automatic bid.
    const autos = new Set<string>();
    for (const [conf, ids] of confs) {
      const order = [...ids].map((id) => ({ id, r: row.get(id)!, coin: rng() })).sort((x, y) => y.r.pts - x.r.pts || y.r.gd - x.r.gd || x.coin - y.coin).map((x) => x.id);
      tally.get(order[0]!)!.reg += 1;
      for (const id of ids) tally.get(id)!.pts += row.get(id)!.pts;
      if (!input.autoConfs.has(conf)) continue;
      const knock = (h: string, a: string) => {
        const p = chance(h, a, false), r = rng();
        const won = r < p.win ? h : r < p.win + p.draw ? (rng() < 0.5 ? h : a) : a;
        games.push({ home: h, away: a, hs: won === h && r < p.win ? 1 : 0, as: won === a && r >= p.win + p.draw ? 1 : 0, neutral: false });
        return won;
      };
      const top = order.slice(0, 4);
      const champ = top.length >= 4 ? knock(knock(top[0]!, top[3]!), knock(top[1]!, top[2]!)) : top.length >= 2 ? knock(top[0]!, top[1]!) : top[0]!;
      autos.add(champ);
      tally.get(champ)!.auto += 1;
    }
    if (input.field == null) continue;
    const rpi = [...computeRpi(games, pool, RPI_DEFAULT).values()].sort((a, b) => b.rpi - a.rpi);
    rpi.forEach((r, i) => { const t = tally.get(r.team); if (t) t.rank += i + 1; });
    const field = new Set(autos);
    for (const r of rpi) { if (field.size >= input.field) break; field.add(r.team); }
    let seeded = 0;
    for (const r of rpi) { if (seeded >= input.seeds) break; if (field.has(r.team)) { tally.get(r.team)!.seed += 1; seeded++; } }
    for (const id of field) { const t = tally.get(id); if (t) t.bid += 1; }
  }
  const n = input.sims;
  return input.teams.map((t) => {
    const x = tally.get(t.id)!, m = magic.get(t.id)!;
    return {
      team: t.id, conf: t.conf,
      reg_title: round(x.reg / n), auto_bid: round(x.auto / n), bid: input.field == null ? null : round(x.bid / n), seed: input.field == null ? null : round(x.seed / n),
      avg_rank: input.field == null ? null : Math.round((x.rank / n) * 10) / 10, avg_points: Math.round((x.pts / n) * 10) / 10, ...m,
    };
  });
}

const round = (v: number) => Math.round(v * 1000) / 1000;
