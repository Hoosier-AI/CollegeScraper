// Pure: a tournament's games laid out as a bracket, one column per round, ordered so the games at positions 2p-1 and
// 2p of a round feed position p of the next (drawn with connectors). Empty positions are byes or games not known
// yet ("Winner of A / B").
//   - NCAA tournament: positions are NCAA.com's bracket slots (bracketId = round * 100 + position; position i feeds
//     ceil(i/2)); six rounds for both fields (the men's top 16 seeds start in round 2: their first-round places are byes).
//   - Conference tournaments: positions come from the tree, from the final back (each side's previous game), since no
//     source gives slots. A tournament still being played has no final yet: its latest games are placed in order.

export interface BracketTeam { id: string | null; name: string | null; seo: string | null; logo: string | null; seed: number | null; score: number | null; winner: boolean }
export interface BracketGame {
  id: string | null; position: number; date: string | null; status: string | null;
  home: BracketTeam | null; away: BracketTeam | null;
  overtime: boolean; shootout: boolean; neutral: boolean;
  /** Byes or games not known yet: who goes into each side (the positions that feed it). */
  feeds: [number | null, number | null];
}
export interface BracketRound { number: number; label: string; games: (BracketGame | null)[] }
export interface Bracket { rounds: BracketRound[]; champion: BracketTeam | null; complete: boolean; teams: number }

/** One game row as read from college_v_schedule (+ the tournament columns of migration 208). */
export interface BracketRow {
  id: string; game_date: string; status: string; bracket_slot: number | null; round_number: number | null; tournament_round: string | null;
  home_program_id: string | null; away_program_id: string | null; home_name: string | null; away_name: string | null;
  home_seo: string | null; away_seo: string | null; home_logo: string | null; away_logo: string | null;
  home_short_name?: string | null; away_short_name?: string | null;
  home_score: number | null; away_score: number | null; home_seed: number | null; away_seed: number | null;
  overtime: boolean | null; shootout: boolean | null; neutral_site: boolean | null; shootout_winner: string | null;
}

const NCAA_LABELS = ['First round', 'Second round', 'Third round', 'Quarterfinals', 'Semifinals', 'Final'];
export const ncaaRoundTitle = (r: number) => NCAA_LABELS[r - 1] ?? `Round ${r}`;
export const confRoundTitle = (r: number, rounds: number) => (r === rounds ? 'Final' : r === rounds - 1 ? 'Semifinals' : r === rounds - 2 ? 'Quarterfinals' : r === 1 ? 'First round' : `Round ${r}`);

const isPlayed = (g: BracketRow) => g.status === 'final' && g.home_score != null && g.away_score != null;

/** The winner's program id, or null (not played, or level with no shootout winner). */
export function winnerId(g: BracketRow, onward?: (team: string) => boolean): string | null {
  if (!isPlayed(g)) return null;
  if (g.home_score! > g.away_score!) return g.home_program_id;
  if (g.away_score! > g.home_score!) return g.away_program_id;
  if (g.shootout_winner) return g.shootout_winner;
  if (onward) { const h = !!g.home_program_id && onward(g.home_program_id), a = !!g.away_program_id && onward(g.away_program_id); if (h !== a) return h ? g.home_program_id : g.away_program_id; }
  return null;
}

function team(g: BracketRow, side: 'home' | 'away', winner: string | null): BracketTeam | null {
  const id = side === 'home' ? g.home_program_id : g.away_program_id;
  const name = side === 'home' ? (g.home_short_name ?? g.home_name) : (g.away_short_name ?? g.away_name);
  if (!id && !name) return null;
  return { id, name, seo: side === 'home' ? g.home_seo : g.away_seo, logo: side === 'home' ? g.home_logo : g.away_logo,
    seed: side === 'home' ? g.home_seed : g.away_seed, score: side === 'home' ? g.home_score : g.away_score, winner: !!winner && winner === id };
}

function toGame(g: BracketRow, position: number, winner: string | null, feeds: [number | null, number | null]): BracketGame {
  return { id: g.id, position, date: g.game_date, status: g.status, home: team(g, 'home', winner), away: team(g, 'away', winner),
    overtime: !!g.overtime, shootout: !!g.shootout || (isPlayed(g) && g.home_score === g.away_score), neutral: !!g.neutral_site, feeds };
}

/** NCAA tournament bracket from bracket slots. */
export function ncaaBracket(rows: BracketRow[]): Bracket | null {
  const games = rows.filter((g) => g.bracket_slot != null);
  if (!games.length) return null;
  const bySlot = new Map<number, BracketRow>();
  for (const g of games) bySlot.set(g.bracket_slot!, g);
  const rounds = 6;
  const onward = (slot: number) => (t: string) => {
    const r = Math.floor(slot / 100), i = slot % 100;
    const next = bySlot.get((r + 1) * 100 + Math.ceil(i / 2));
    return !!next && (next.home_program_id === t || next.away_program_id === t);
  };
  const out: BracketRound[] = [];
  for (let r = 1; r <= rounds; r++) {
    const n = 2 ** (rounds - r);
    const list: (BracketGame | null)[] = [];
    for (let p = 1; p <= n; p++) {
      const g = bySlot.get(r * 100 + p);
      if (!g) { list.push(null); continue; }
      list.push(toGame(g, p, winnerId(g, onward(r * 100 + p)), r > 1 ? [2 * p - 1, 2 * p] : [null, null]));
    }
    out.push({ number: r, label: ncaaRoundTitle(r), games: list });
  }
  const final = bySlot.get(rounds * 100 + 1);
  const champ = final ? winnerId(final) : null;
  const champion = final && champ ? team(final, final.home_program_id === champ ? 'home' : 'away', champ) : null;
  const teams = new Set(games.flatMap((g) => [g.home_program_id, g.away_program_id]).filter(Boolean)).size;
  return { rounds: out, champion, complete: !!champion, teams };
}

/** A conference tournament's bracket from its games (round_number set by classify-postseason). */
export function conferenceBracket(rows: BracketRow[]): Bracket | null {
  const games = [...rows].filter((g) => g.round_number != null).sort((a, b) => a.game_date.localeCompare(b.game_date) || a.id.localeCompare(b.id));
  if (!games.length) return null;
  const byTeam = new Map<string, BracketRow[]>();
  for (const g of games) for (const t of [g.home_program_id, g.away_program_id]) if (t) byTeam.set(t, [...(byTeam.get(t) ?? []), g]);
  const prevOf = (t: string | null, g: BracketRow) => { if (!t) return null; const l = byTeam.get(t)!; const i = l.indexOf(g); return i > 0 ? l[i - 1]! : null; };
  const nextOf = (t: string, g: BracketRow) => { const l = byTeam.get(t)!; const i = l.indexOf(g); return i < l.length - 1 ? l[i + 1]! : null; };
  const teams = byTeam.size;
  const rounds = Math.max(...games.map((g) => g.round_number!), Math.ceil(Math.log2(Math.max(2, teams))));
  const winner = (g: BracketRow) => winnerId(g, (t) => !!nextOf(t, g));
  const grid: (BracketGame | null)[][] = Array.from({ length: rounds }, (_, i) => Array(2 ** (rounds - i - 1)).fill(null));
  const placed = new Set<string>();
  // Place g at (round, position) and its feeders below it: home side's previous game at 2p-1, away side's at 2p.
  const place = (g: BracketRow, r: number, p: number) => {
    if (placed.has(g.id) || r < 1 || p > grid[r - 1]!.length) return;
    placed.add(g.id);
    grid[r - 1]![p - 1] = toGame(g, p, winner(g), r > 1 ? [2 * p - 1, 2 * p] : [null, null]);
    const ph = prevOf(g.home_program_id, g), pa = prevOf(g.away_program_id, g);
    if (ph) place(ph, r - 1, 2 * p - 1);
    if (pa) place(pa, r - 1, 2 * p);
  };
  // Roots: games whose winner has not played again (the final, or the latest games while it is being played).
  const roots = games.filter((g) => { const w = winner(g); return !w || !nextOf(w, g); }).filter((g) => isPlayed(g) || g.status !== 'final');
  const top = roots.filter((g) => g.round_number === rounds);
  if (top.length === 1) place(top[0]!, rounds, 1);
  // Still being played: each remaining root at its own round, the higher seeds first.
  const rest = roots.filter((g) => !placed.has(g.id)).sort((a, b) => b.round_number! - a.round_number! || seedOf(a) - seedOf(b));
  for (const g of rest) {
    const r = Math.min(g.round_number!, rounds);
    const free = grid[r - 1]!.findIndex((x, i) => !x && fits(grid, r, i + 1));
    if (free >= 0) place(g, r, free + 1);
  }
  const final = top.length === 1 ? top[0]! : null;
  const champ = final ? winner(final) : null;
  const champion = final && champ ? team(final, final.home_program_id === champ ? 'home' : 'away', champ) : null;
  return {
    rounds: grid.map((list, i) => ({ number: i + 1, label: confRoundTitle(i + 1, rounds), games: list })),
    champion, complete: !!champion, teams,
  };
}

const seedOf = (g: BracketRow) => Math.min(g.home_seed ?? 99, g.away_seed ?? 99);
/** A position is free for a subtree when its parent position in the next round is not already holding a placed game
 *  whose feeders point elsewhere (keeps a half of the bracket together). */
function fits(grid: (BracketGame | null)[][], r: number, p: number): boolean {
  return !grid[r]?.[Math.ceil(p / 2) - 1];
}
