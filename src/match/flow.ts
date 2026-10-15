// How a match went, minute by minute, from data we already hold (no tracking data):
//  - win probability: the pre-match chances (Plaibook Elo) turned into each side's goal rate, then at every minute the
//    chance of each result from the goals still to come (Poisson) given the score and red cards so far;
//  - attack momentum: each side's attacking actions a minute (shots, shots on target, corners, goals; or xG where the
//    match has shot-level xG), smoothed so a spell of pressure reads as one swell, home above the line, away below;
//  - xG race: each side's running expected goals (only where shots carry xG: American Soccer Analysis' leagues).

export interface Probs { h: number; d: number; a: number }
export interface FlowEvent { m: number; side: 'home' | 'away'; type: 'goal' | 'red' }
export interface Action { m: number; side: 'home' | 'away'; w: number }

const fact = (() => { const f = [1]; for (let i = 1; i <= 20; i++) f.push(f[i - 1]! * i); return f; })();
const pois = (k: number, l: number) => (l <= 0 ? (k === 0 ? 1 : 0) : Math.exp(-l) * l ** k / fact[k]!);

/** The chance of each result from here, given the home side leads by `diff` and each side's expected goals still to come. */
export function outcome(lh: number, la: number, diff: number): Probs {
  let h = 0, d = 0, a = 0;
  const N = 12;
  const ph = Array.from({ length: N + 1 }, (_, i) => pois(i, lh)), pa = Array.from({ length: N + 1 }, (_, j) => pois(j, la));
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = ph[i]! * pa[j]!, f = diff + i - j;
    if (f > 0) h += p; else if (f < 0) a += p; else d += p;
  }
  const t = h + d + a || 1;
  return { h: h / t, d: d / t, a: a / t };
}

/** Each side's expected goals over a whole match: the split of `total` whose home-minus-away chance matches the
 *  pre-match chances (the draw then follows from the Poisson model). */
export function fitRates(pre: Probs, total: number): { lh: number; la: number } {
  const target = pre.h - pre.a;
  let lo = -total * 0.95, hi = total * 0.95;
  for (let k = 0; k < 40; k++) {
    const s = (lo + hi) / 2;
    const o = outcome((total + s) / 2, (total - s) / 2, 0);
    if (o.h - o.a < target) lo = s; else hi = s;
  }
  const s = (lo + hi) / 2;
  return { lh: (total + s) / 2, la: (total - s) / 2 };
}

/** A red card's effect on the rest of the match: the side down a player scores about a quarter less, the other more. */
const RED_FOR = 0.75, RED_AGAINST = 1.2;

/** Win probability at each minute from 0 to `until`. A goal or red card in minute m counts from m on. */
export function winProbCurve(o: { lh: number; la: number; length?: number; events: FlowEvent[]; until: number }): (Probs & { m: number })[] {
  const length = o.length ?? 90;
  const out: (Probs & { m: number })[] = [];
  const evs = [...o.events].sort((x, y) => x.m - y.m);
  for (let m = 0; m <= o.until; m++) {
    let diff = 0, hr = 0, ar = 0;
    for (const e of evs) {
      if (e.m > m) break;
      if (e.type === 'goal') diff += e.side === 'home' ? 1 : -1;
      else if (e.side === 'home') hr++; else ar++;
    }
    const left = Math.max(0, (length - m) / length);
    const lh = o.lh * left * RED_FOR ** hr * RED_AGAINST ** ar, la = o.la * left * RED_FOR ** ar * RED_AGAINST ** hr;
    const p = m >= length ? { h: diff > 0 ? 1 : 0, d: diff === 0 ? 1 : 0, a: diff < 0 ? 1 : 0 } : outcome(lh, la, diff);
    out.push({ m, h: round3(p.h), d: round3(p.d), a: round3(p.a) });
  }
  return out;
}

/** Attack momentum at each minute, -1 (all away) to 1 (all home): actions a minute, decayed by half every
 *  `halfLife` minutes, as (home - away) / (home + away + 1) so a quiet spell sits near the line. */
export function momentum(actions: Action[], until: number, halfLife = 3): { m: number; v: number }[] {
  const decay = 0.5 ** (1 / halfLife);
  const hBy = new Map<number, number>(), aBy = new Map<number, number>();
  for (const x of actions) { const m = Math.max(0, Math.round(x.m)); const t = x.side === 'home' ? hBy : aBy; t.set(m, (t.get(m) ?? 0) + x.w); }
  let H = 0, A = 0;
  const out: { m: number; v: number }[] = [];
  for (let m = 0; m <= until; m++) {
    H = H * decay + (hBy.get(m) ?? 0); A = A * decay + (aBy.get(m) ?? 0);
    out.push({ m, v: round3((H - A) / (H + A + 1)) });
  }
  return out;
}

/** Running xG for each side at each minute. */
export function xgRace(shots: { m: number; side: 'home' | 'away'; xg: number }[], until: number): { m: number; h: number; a: number }[] {
  const out: { m: number; h: number; a: number }[] = [];
  let h = 0, a = 0;
  const sorted = [...shots].sort((x, y) => x.m - y.m);
  let i = 0;
  for (let m = 0; m <= until; m++) {
    while (i < sorted.length && sorted[i]!.m <= m) { const s = sorted[i++]!; if (s.side === 'home') h += s.xg; else a += s.xg; }
    out.push({ m, h: round3(h), a: round3(a) });
  }
  return out;
}

/** College play-by-play weights: a shot 1, a goal 2, a corner 0.6; a save by one side is a shot on target by the
 *  other, worth 0.5 more to the shooting side. */
export const COLLEGE_WEIGHTS: Record<string, number> = { shot: 1, goal: 2, pk: 2, corner: 0.6 };

const round3 = (v: number) => Math.round(v * 1000) / 1000;
