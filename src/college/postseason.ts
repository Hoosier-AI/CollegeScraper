// Pure: which games are conference-tournament games. No source tags them reliably: NCAA.com marks only its own
// championship (isChampionship), school box scores rarely set isAPostseasonGame, and schedules put the tournament
// text on placeholder rows ("B1G Championship Match"). So the tournament is found from the games themselves:
//   - a conference tournament is the run of same-conference games after the regular season, played as a knockout:
//     a team that loses plays no more conference games, a level game goes to penalties and only one side plays on,
//     nobody plays twice in a day;
//   - its games form one connected tree of at least three games that ends in a single final (unless still being
//     played). Stray same-conference games in that window (a wrong membership, a makeup game) are left out;
//   - the start date D is a date from which the later games pass those checks. Where several dates pass, the one
//     where every team has played its official conference games (the conference's own table) wins, then the latest
//     one where every team has played the same number (schedules are balanced), then the earliest.
// Rounds count forward through the tree (a bye enters a round late), or follow the dates when the two agree on the
// number of rounds; a finished tournament's last game is the Final. A level game's winner is the side that played on,
// or for a final the box score's shootout winner. Seeds come from the regular-season table where the places are not tied.

export interface PsGame {
  id: string;
  date: string;
  home: string;
  away: string;
  hs: number | null;
  as: number | null;
  status: string;
  shootout: boolean;
  neutral: boolean;
  /** Who won the shootout of a level game, from the box score's shootout goals (null when unknown). */
  pkWinner?: string | null;
}

export interface TournamentGame {
  id: string;
  round: number;
  label: string;
  homeSeed: number | null;
  awaySeed: number | null;
  /** The side that went through when the game was level (the one that played on). */
  shootoutWinner: string | null;
}

export interface ConferenceTournament {
  start: string;
  games: TournamentGame[];
  /** Number of rounds (the Final is this round). */
  rounds: number;
  teams: string[];
  champion: string | null;
  complete: boolean;
  /** How the start was chosen: the official table, a balanced schedule, or the tree alone. */
  how: 'official' | 'balanced' | 'structure';
  /** The final, when it was level and nobody played on: its winner needs the shootout from the box score. */
  finalShootout: string | null;
}

export const played = (g: Pick<PsGame, 'status' | 'hs' | 'as'>) => g.status === 'final' && g.hs != null && g.as != null;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
const minusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 86400_000).toISOString().slice(0, 10);

function indexByTeam(games: PsGame[]) {
  const byTeam = new Map<string, PsGame[]>();
  for (const g of games) for (const t of [g.home, g.away]) byTeam.set(t, [...(byTeam.get(t) ?? []), g]);
  const playsAfter = (t: string, g: PsGame) => { const l = byTeam.get(t)!; return l.indexOf(g) < l.length - 1; };
  const prevOf = (t: string, g: PsGame) => { const l = byTeam.get(t)!; const i = l.indexOf(g); return i > 0 ? l[i - 1]! : null; };
  return { byTeam, playsAfter, prevOf };
}

/** Winner of a played game: the higher score, or, when level, the side that played on, else (a final) the shootout
 *  winner from the box score. Who played on comes first: box-score shootout tallies are sometimes wrong (2026 OVC men,
 *  Western Illinois "won" 8-5 on the box score while Houston Christian played the semifinal). */
function winnerOf(g: PsGame, playsAfter: (t: string, g: PsGame) => boolean): string | null {
  if (!played(g)) return null;
  if (g.hs! > g.as!) return g.home;
  if (g.as! > g.hs!) return g.away;
  const h = playsAfter(g.home, g), a = playsAfter(g.away, g);
  if (h !== a) return h ? g.home : g.away;
  return g.pkWinner === g.home || g.pkWinner === g.away ? g.pkWinner : null;
}

/** Knockout rules over a date-ordered set: a loser never plays again, a level game sends on at most one side,
 *  nobody plays twice in a day. `links` counts winners who played on; `ends` counts played games nobody played on from. */
export function knockout(games: PsGame[]): { ok: boolean; links: number; ends: number; reason?: string } {
  const { byTeam, playsAfter } = indexByTeam(games);
  for (const list of byTeam.values()) {
    const days = new Set<string>();
    for (const g of list) { if (days.has(g.date)) return { ok: false, links: 0, ends: 0, reason: 'twice in a day' }; days.add(g.date); }
  }
  let links = 0, ends = 0;
  for (const g of games) {
    if (!played(g)) continue;
    const hAfter = playsAfter(g.home, g), aAfter = playsAfter(g.away, g);
    if (g.hs !== g.as) {
      if (g.hs! > g.as! ? aAfter : hAfter) return { ok: false, links, ends, reason: 'loser played on' };
      if (g.hs! > g.as! ? hAfter : aAfter) links++; else ends++;
    } else {
      if (hAfter && aAfter) return { ok: false, links, ends, reason: 'both sides of a level game played on' };
      if (hAfter || aAfter) links++; else ends++;
    }
  }
  return { ok: true, links, ends };
}

/** Games split into connected groups (teams joined by games); the biggest first. */
function components(games: PsGame[]): PsGame[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  for (const g of games) for (const t of [g.home, g.away]) if (!parent.has(t)) parent.set(t, t);
  for (const g of games) { const a = find(g.home), b = find(g.away); if (a !== b) parent.set(a, b); }
  const groups = new Map<string, PsGame[]>();
  for (const g of games) { const r = find(g.home); groups.set(r, [...(groups.get(r) ?? []), g]); }
  return [...groups.values()].sort((a, b) => b.length - a.length || (b.at(-1)!.date.localeCompare(a.at(-1)!.date)));
}

export interface ClassifyInput {
  members: string[];
  /** Same-conference games of the season (both sides members), NCAA championship games already removed. */
  games: PsGame[];
  /** Official conference games played per team (the conference's own table), where it publishes one. */
  officialGp?: Map<string, number>;
  /** Official table rank per team, for seeds. */
  officialRank?: Map<string, number>;
  /** Today (Eastern): a tournament whose last game is this recent, or that has games to come, may still have open ends. */
  asOf: string;
}

/** The conference's tournament, or null when it has none (yet). */
export function classifyConference(input: ClassifyInput): ConferenceTournament | null {
  const games = input.games
    .filter((g) => (g.status === 'final' && played(g)) || ((g.status === 'scheduled' || g.status === 'live') && g.date >= minusDays(input.asOf, 1)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (games.length < 3) return null;
  const dates = [...new Set(games.map((g) => g.date))];
  const official = input.officialGp && input.members.every((t) => input.officialGp!.has(t)) ? input.officialGp : null;
  const countsBefore = (d: string) => {
    const c = new Map<string, number>(input.members.map((t) => [t, 0]));
    for (const g of games) if (g.date < d && played(g)) { c.set(g.home, (c.get(g.home) ?? 0) + 1); c.set(g.away, (c.get(g.away) ?? 0) + 1); }
    return c;
  };

  type Cand = { d: string; main: PsGame[]; how: ConferenceTournament['how'] };
  const cands: Cand[] = [];
  // The tournament is the end of the conference schedule: never more than its last third of dates.
  for (const d of dates.slice(Math.floor((dates.length * 2) / 3))) {
    const set = games.filter((g) => g.date >= d);
    if (!knockout(set).ok) continue;
    // The bracket: every connected group with an advancement (until the final, the two halves are separate groups).
    // While it is being played, single games in its window (a first round whose winners have not played yet, games to
    // come) belong to it too; once finished, unconnected games are strays (a wrong membership, a makeup game).
    const comps = components(set);
    const linked = comps.filter((c) => knockout(c).links > 0);
    let main = linked.flat();
    if (main.length < 3) continue;
    const first = main.reduce((m, g) => (g.date < m ? g.date : m), main[0]!.date);
    const lastDate = main.reduce((m, g) => (g.date > m ? g.date : m), '');
    const live = main.some((g) => !played(g)) || daysBetween(lastDate, input.asOf) <= 3 || set.some((g) => !played(g));
    if (live) main = [...main, ...comps.filter((c) => !linked.includes(c) && c.every((g) => g.date >= first)).flat()];
    main.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const ko = knockout(main);
    const teams = new Set(main.flatMap((g) => [g.home, g.away]));
    if (main.length > teams.size - 1) continue;
    if (ko.ends > 1 && !live) continue;
    const before = countsBefore(d);
    let how: Cand['how'] = 'structure';
    if (official && [...before].every(([t, n]) => n === official.get(t))) how = 'official';
    else { const v = [...before.values()]; if (Math.max(...v) === Math.min(...v)) how = 'balanced'; }
    cands.push({ d, main, how });
  }
  if (!cands.length) return null;
  // Balanced: the LATEST such date. A last regular round in which every team plays leaves the counts balanced too and
  // can pass as a first round (2026 Ivy men, Big East men, WCC women all did; their official tables settle it).
  const rank = { official: 0, balanced: 1, structure: 2 } as const;
  const pick = [...cands].sort((a, b) => rank[a.how] - rank[b.how] || (a.how === 'balanced' ? b.d.localeCompare(a.d) : a.d.localeCompare(b.d)))[0]!;
  return describe(input, pick.main, pick.d, pick.how);
}

function describe(input: ClassifyInput, set: PsGame[], start: string, how: ConferenceTournament['how']): ConferenceTournament {
  const { byTeam, playsAfter, prevOf } = indexByTeam(set);
  const round = new Map<string, number>();
  for (const g of set) {
    const ph = prevOf(g.home, g), pa = prevOf(g.away, g);
    round.set(g.id, 1 + Math.max(ph ? round.get(ph.id)! : 0, pa ? round.get(pa.id)! : 0));
  }
  const teams = [...byTeam.keys()];
  const forward = Math.max(...round.values());
  // Rounds are usually played on their own dates (a day apart at most within a round). Where the number of such date
  // groups matches the rounds counted through the tree, the dates decide: two teams with byes meeting on
  // quarterfinal day is a quarterfinal, not a first round.
  const clusters: string[][] = [];
  for (const d of [...new Set(set.map((g) => g.date))]) {
    const cur = clusters.at(-1);
    if (cur && daysBetween(cur.at(-1)!, d) <= 1) cur.push(d); else clusters.push([d]);
  }
  if (clusters.length === forward) {
    const clusterOf = new Map(clusters.flatMap((c, i) => c.map((d) => [d, i + 1] as const)));
    for (const g of set) round.set(g.id, clusterOf.get(g.date)!);
  }
  const rounds = Math.max(forward, Math.ceil(Math.log2(Math.max(2, teams.length))));
  const last = set.at(-1)!;
  // Finished: everything played and a single game on the last date that either joins the whole tree (the halves meet
  // in the final) or stands two days or more after the round before it (a semifinal missing from our data leaves the
  // tree in two pieces; two semifinals on consecutive days are a round, not a final).
  const prevDate = set.filter((g) => g.date < last.date).reduce((m, g) => (g.date > m ? g.date : m), '');
  const complete = set.every(played) && set.filter((g) => g.date === last.date).length === 1
    && (components(set).length === 1 || (!!prevDate && daysBetween(prevDate, last.date) >= 2))
    && !playsAfter(last.home, last) && !playsAfter(last.away, last) && daysBetween(last.date, input.asOf) > 0;
  // A finished tournament's last game is the Final even where a round in between is missing from our data.
  if (complete) round.set(last.id, rounds);
  const label = (r: number) => (r === rounds ? 'Final' : r === rounds - 1 ? 'Semifinal' : r === rounds - 2 ? 'Quarterfinal' : r === 1 ? 'First round' : `Round ${r}`);
  const seeds = seedsFrom(input, start);
  const out: TournamentGame[] = set.map((g) => ({
    id: g.id, round: round.get(g.id)!, label: label(round.get(g.id)!), homeSeed: seeds.get(g.home) ?? null, awaySeed: seeds.get(g.away) ?? null,
    shootoutWinner: played(g) && g.hs === g.as ? winnerOf(g, playsAfter) : null,
  }));
  const champion = complete ? winnerOf(last, playsAfter) : null;
  return { start, games: out, rounds, teams, champion, complete, how, finalShootout: complete && !champion ? last.id : null };
}

/** Seeds: the official rank where published, else the regular-season table where the points are not tied
 *  (conferences break ties head-to-head first, which we do not model). Tied places get no seed rather than a guess. */
function seedsFrom(input: ClassifyInput, start: string): Map<string, number> {
  const out = new Map<string, number>();
  if (input.officialRank && input.officialRank.size) {
    const seen = new Map<number, number>();
    for (const r of input.officialRank.values()) seen.set(r, (seen.get(r) ?? 0) + 1);
    for (const [t, r] of input.officialRank) if (seen.get(r) === 1) out.set(t, r);
    return out;
  }
  const pts = new Map<string, number>(input.members.map((t) => [t, 0]));
  for (const g of input.games) {
    if (g.date >= start || !played(g) || !pts.has(g.home) || !pts.has(g.away)) continue;
    if (g.hs! > g.as!) pts.set(g.home, pts.get(g.home)! + 3); else if (g.hs! < g.as!) pts.set(g.away, pts.get(g.away)! + 3);
    else { pts.set(g.home, pts.get(g.home)! + 1); pts.set(g.away, pts.get(g.away)! + 1); }
  }
  const order = [...pts].sort((x, y) => y[1] - x[1]);
  order.forEach(([t, p], i) => { if (order[i - 1]?.[1] !== p && order[i + 1]?.[1] !== p) out.set(t, i + 1); });
  return out;
}
