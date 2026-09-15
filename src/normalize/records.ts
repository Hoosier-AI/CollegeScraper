// Result and record helpers shared by the schedule parsers and the standings verification.

export interface ResultLike { status: 'W' | 'L' | 'T'; teamScore: number; opponentScore: number }

/** Schedules print "L 3-2" as often as "L 2-3": the W/L status decides which score is the team's. */
export function normalizeResult<T extends ResultLike | null>(r: T): T {
  if (!r) return r;
  if ((r.status === 'W' && r.teamScore < r.opponentScore) || (r.status === 'L' && r.teamScore > r.opponentScore)) {
    return { ...r, teamScore: r.opponentScore, opponentScore: r.teamScore };
  }
  return r;
}

export interface GameResult { date: string; gf: number; ga: number; conf: boolean }
export interface Wlt { w: number; l: number; t: number }

export function recordOf(games: GameResult[]): Wlt {
  const r = { w: 0, l: 0, t: 0 };
  for (const g of games) { if (g.gf > g.ga) r.w++; else if (g.gf < g.ga) r.l++; else r.t++; }
  return r;
}

export const wltString = (r: { w: number | null; l: number | null; t: number | null }) => `${r.w ?? 0}-${r.l ?? 0}-${r.t ?? 0}`;

/**
 * Compare our games with an official W-L-T. 'lag' = the official table counts fewer games and our earliest games
 * reproduce it exactly (the table was not updated after the latest games); otherwise 'mismatch'.
 */
export function compareRecord(games: GameResult[], official: { w: number | null; l: number | null; t: number | null }, confOnly: boolean): { status: 'ok' | 'lag' | 'mismatch'; ours: Wlt } {
  const list = games.filter((g) => !confOnly || g.conf).sort((a, b) => a.date.localeCompare(b.date));
  const ours = recordOf(list);
  const off = { w: official.w ?? 0, l: official.l ?? 0, t: official.t ?? 0 };
  if (wltString(ours) === wltString(off)) return { status: 'ok', ours };
  const n = off.w + off.l + off.t;
  if (n < list.length && wltString(recordOf(list.slice(0, n))) === wltString(off)) return { status: 'lag', ours };
  return { status: 'mismatch', ours };
}
