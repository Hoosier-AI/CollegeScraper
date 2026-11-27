// Pure: the knockout stage of a pro cup or an international tournament as a bracket, from one league season's
// fixtures. The source (API-Football) gives a round name on every fixture and nothing else: no draw slots, no tie
// ids. So:
//   - the round name says what kind of round it is and, for a named knockout round, how many teams it has (roundRank);
//   - fixtures of one round between the same two teams are one tie (two legs, a replay, or a best-of-three series);
//   - the bracket starts at the earliest round that is a full power of two (16 teams, 8 ties) and runs to the final;
//     knockout rounds before it (play-offs, numbered rounds, a first round with byes) are listed as `preliminary`;
//   - positions come from the tree, from the final back, exactly as a college conference tournament's do: the tie is
//     mapped onto that builder's row (conferenceBracket in src/college/bracket.ts) rather than building a second tree.
import { conferenceBracket, type BracketGame, type BracketRow, type BracketTeam } from '../college/bracket.js';

export type RoundStage = 'group' | 'league' | 'qualifying' | 'knockout' | 'third';
export interface RoundRank { stage: RoundStage; /** Teams in a named knockout round (Final 2, Semi-finals 4, ...). */ size: number | null }

const pow2 = (n: number) => Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;

/** What a fixture's round name means. Tolerant of case, hyphens and plurals. A name it does not know is 'league'
 *  (never drawn as a knockout round). */
export function roundRank(label: string | null | undefined): RoundRank {
  const s = String(label ?? '').toLowerCase().replace(/[-–—_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return { stage: 'league', size: null };
  if (/\b(3rd|third)\b.*\bplace\b|\bbronze\b/.test(s)) return { stage: 'third', size: null };
  if (/\bgroups?\b/.test(s)) return { stage: 'group', size: null };
  if (/\b(regular season|league (stage|phase))\b/.test(s)) return { stage: 'league', size: null };
  if (/\bplay ?offs?\b|\bplay ?in\b|\bpreliminary\b|\bqualif/.test(s)) return { stage: 'qualifying', size: null };
  const of = /\bround of (\d+)\b/.exec(s);
  if (of) { const n = Number(of[1]); return pow2(n) ? { stage: 'knockout', size: n } : { stage: 'qualifying', size: null }; }
  // "8th Finals" and "1/8 finals" are the round of 16.
  const nth = /\b(?:1 )?(\d+)(?:th|nd)? finals?\b/.exec(s);
  if (nth) { const n = Number(nth[1]) * 2; return pow2(n) ? { stage: 'knockout', size: n } : { stage: 'qualifying', size: null }; }
  if (/\bquarter ?finals?\b/.test(s)) return { stage: 'knockout', size: 8 };
  if (/\bsemi ?finals?\b/.test(s)) return { stage: 'knockout', size: 4 };
  if (/\bfinals?\b/.test(s)) return { stage: 'knockout', size: 2 };
  if (/\b\d+(st|nd|rd|th) round\b|\bround \d+\b|\b(first|second|third|fourth|fifth|sixth) round\b/.test(s)) return { stage: 'qualifying', size: null };
  return { stage: 'league', size: null };
}

const KNOCKOUT_LABEL: Record<number, string> = { 2: 'Final', 4: 'Semi-finals', 8: 'Quarter-finals' };
export const knockoutLabel = (size: number) => KNOCKOUT_LABEL[size] ?? `Round of ${size}`;

/** One side of a fixture as the pro reads return it (toMatchRow in src/pro/queries.ts). */
export interface CupSide { id: number | null; name: string | null; logo: string | null; score: number | null }
/** One fixture: the FIXTURE_SELECT row after toMatchRow. `score` counts extra time, never the shootout. */
export interface CupFixture {
  id: number; slug: string; kickoff: string; status: string; status_short: string | null; round: string | null;
  home: CupSide; away: CupSide; et: [number | null, number | null]; pen: [number | null, number | null]; winner: 'home' | 'away' | 'draw' | null;
}
export interface CupLeg { home: number | null; away: number | null; date: string }
/** A game of the bracket: the college shape plus what a pro tie adds. */
export interface CupGame extends BracketGame {
  /** The match page: the deciding leg, or the next one to be played. */
  to?: string;
  /** Each leg's score, the tie's home side first; only when there is more than one. The sides' `score` is then the
   *  aggregate (or games won, when `series`). */
  legs?: CupLeg[];
  /** The shootout, the tie's home side first. */
  pens?: [number, number];
  /** Three or more games between the two (a best-of-three): the score is games won. */
  series?: boolean;
}
export interface CupRound { number: number; label: string; games: (CupGame | null)[] }
export interface CupBracket { rounds: CupRound[]; champion: BracketTeam | null; complete: boolean; teams: number }
export interface CupKnockout { bracket: CupBracket | null; third_place: CupGame | null; preliminary: { label: string; games: CupGame[] }[] }

/** The fixtures of one round between the same two teams, oldest first. Home is the first leg's home side. */
export interface Tie { key: string; legs: CupFixture[]; home: CupSide; away: CupSide }
export interface TieResult {
  status: 'final' | 'live' | 'scheduled'; home: number | null; away: number | null; winner: 'home' | 'away' | null;
  pens: [number, number] | null; overtime: boolean; series: boolean;
}

const known = (s: CupSide) => s.id != null;
/** A leg's two numbers turned to the tie's home side first. */
const turned = <T>(t: Tie, leg: CupFixture, pair: [T, T]): [T, T] => (leg.home.id === t.home.id ? pair : [pair[1], pair[0]]);
const hasScore = (f: CupFixture) => f.home.score != null && f.away.score != null;

/** Who won one game of a series: the score, then its shootout, then the source's own winner mark. */
function legWinner(t: Tie, leg: CupFixture): 'home' | 'away' | null {
  const [h, a] = turned(t, leg, [leg.home.score ?? 0, leg.away.score ?? 0]);
  if (h !== a) return h > a ? 'home' : 'away';
  const [ph, pa] = turned(t, leg, leg.pen);
  if (ph != null && pa != null && ph !== pa) return ph > pa ? 'home' : 'away';
  if (leg.winner === 'home' || leg.winner === 'away') return (leg.winner === 'home') === (leg.home.id === t.home.id) ? 'home' : 'away';
  return null;
}

/** A tie's score and winner. Two legs: the aggregate, then the last leg's shootout, then the source's winner mark on
 *  a level last leg, then whichever side plays on (`onward`, as college winnerId does: covers ties once settled on
 *  away goals and results with no shootout stored). Three or more games: games won. */
export function tieResult(t: Tie, onward?: (teamId: number) => boolean): TieResult {
  const last = t.legs[t.legs.length - 1]!;
  const played = t.legs.filter((l) => (l.status === 'final' || l.status === 'live') && hasScore(l));
  const series = t.legs.length >= 3;
  let home: number | null = null, away: number | null = null;
  if (played.length) {
    home = 0; away = 0;
    for (const l of played) {
      if (series) { if (l.status !== 'final') continue; const w = legWinner(t, l); if (w === 'home') home++; else if (w === 'away') away++; }
      else { const [h, a] = turned(t, l, [l.home.score!, l.away.score!]); home += h; away += a; }
    }
  }
  const overtime = last.status_short === 'AET' || last.status_short === 'PEN';
  const done = t.legs.every((l) => l.status === 'final') && played.length === t.legs.length;
  if (!done) return { status: t.legs.some((l) => l.status === 'live') ? 'live' : 'scheduled', home, away, winner: null, pens: null, overtime: false, series };
  let winner: 'home' | 'away' | null = home! > away! ? 'home' : away! > home! ? 'away' : null;
  let pens: [number, number] | null = null;
  if (!winner && !series) {
    const [ph, pa] = turned(t, last, last.pen);
    if (ph != null && pa != null) { pens = [ph, pa]; if (ph !== pa) winner = ph > pa ? 'home' : 'away'; }
    // A level last leg with a winner marked: the source's way of saying who won the shootout.
    if (!winner && last.home.score === last.away.score) winner = legWinner(t, last);
  }
  if (!winner && onward && known(t.home) && known(t.away)) {
    const h = onward(t.home.id!), a = onward(t.away.id!);
    if (h !== a) winner = h ? 'home' : 'away';
  }
  return { status: 'final', home, away, winner, pens, overtime, series };
}

/** One round's fixtures as ties: the same two teams (either way round) are one tie. */
export function tiesOf(fixtures: CupFixture[]): Tie[] {
  const by = new Map<string, Tie>();
  for (const f of [...fixtures].sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id - b.id)) {
    const key = known(f.home) && known(f.away) ? [f.home.id!, f.away.id!].sort((a, b) => a - b).join('-') : `f${f.id}`;
    const t = by.get(key);
    if (t) t.legs.push(f); else by.set(key, { key, legs: [f], home: f.home, away: f.away });
  }
  return [...by.values()];
}

function side(s: CupSide, score: number | null, winner: boolean): BracketTeam | null {
  if (!known(s) && !s.name) return null;
  return { id: s.id == null ? null : String(s.id), name: s.name, seo: null, logo: s.logo, seed: null, score, winner };
}

function toGame(t: Tie, r: TieResult, position: number, feeds: [number | null, number | null], link: (slug: string) => string): CupGame {
  // The match the card opens: the deciding leg once the tie is over, before that the next leg to be played.
  const leg = r.status === 'final' ? t.legs[t.legs.length - 1]! : t.legs.find((l) => l.status !== 'final') ?? t.legs[t.legs.length - 1]!;
  const g: CupGame = {
    id: String(leg.id), position, date: leg.kickoff, status: r.status,
    home: side(t.home, r.home, r.winner === 'home'), away: side(t.away, r.away, r.winner === 'away'),
    overtime: r.overtime, shootout: !!r.pens, neutral: false, feeds, to: link(leg.slug),
  };
  if (t.legs.length > 1) g.legs = t.legs.map((l) => { const [home, away] = turned(t, l, [l.home.score, l.away.score]); return { home, away, date: l.kickoff }; });
  if (r.pens) g.pens = r.pens;
  if (r.series) g.series = true;
  return g;
}

interface Round { key: string; label: string; rank: RoundRank; ties: Tie[]; first: string; teams: Set<number> }

/** A season's fixtures to its knockout stage. Group and league rounds are ignored. `link` turns a match slug into
 *  its page (/pro/matches/<slug> or /intl/matches/<slug>). */
export function cupKnockout(fixtures: CupFixture[], link: (slug: string) => string): CupKnockout {
  // Rounds: named knockout rounds by their size ('Final' and 'Finals' are one), the others by name.
  const groups = new Map<string, { label: string; rank: RoundRank; rows: CupFixture[] }>();
  for (const f of fixtures) {
    if (f.status === 'cancelled' || !f.round) continue;
    const rank = roundRank(f.round);
    if (rank.stage === 'group' || rank.stage === 'league') continue;
    const key = rank.stage === 'knockout' ? `k${rank.size}` : rank.stage === 'third' ? 'third' : `q:${f.round.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    const g = groups.get(key) ?? { label: rank.stage === 'knockout' ? knockoutLabel(rank.size!) : f.round, rank, rows: [] };
    g.rows.push(f); groups.set(key, g);
  }
  const rounds: Round[] = [...groups.entries()].map(([key, g]) => {
    const ties = tiesOf(g.rows);
    return { key, label: g.label, rank: g.rank, ties, first: ties[0]!.legs[0]!.kickoff, teams: new Set(ties.flatMap((t) => [t.home.id, t.away.id]).filter((x): x is number => x != null)) };
  }).sort((a, b) => a.first.localeCompare(b.first));
  const third = rounds.find((r) => r.rank.stage === 'third') ?? null;
  const main = rounds.filter((r) => r !== third);
  // Who plays on after a round: every team in a later round (the third-place game is not playing on).
  const results = new Map<Tie, TieResult>();
  main.forEach((r, i) => {
    const later = main.slice(i + 1);
    const onward = (id: number) => later.some((x) => x.teams.has(id));
    for (const t of r.ties) results.set(t, tieResult(t, onward));
  });
  if (third) for (const t of third.ties) results.set(t, tieResult(t));

  // Where the bracket starts. From the latest named round known (the final, or the round being played) back through
  // every earlier round that is full: N teams in N/2 ties. A round that is not (a play-off for half the places, a
  // first round with byes, or fixtures missing) ends it, and is listed with the preliminary rounds.
  const bySize = new Map<number, Round>();
  for (const r of main) if (r.rank.stage === 'knockout') bySize.set(r.rank.size!, r);
  let start = 0;
  if (bySize.size) {
    const latest = Math.min(...bySize.keys());
    if (bySize.get(latest)!.ties.length <= latest / 2) {
      start = latest;
      while (bySize.get(start * 2)?.ties.length === start) start *= 2;
    }
  }
  const inBracket = (r: Round) => r.rank.stage === 'knockout' && start > 0 && r.rank.size! <= start;

  let bracket: CupBracket | null = null;
  if (start) {
    const count = Math.log2(start);
    const number = (size: number) => count - Math.log2(size) + 1;
    const tieById = new Map<string, Tie>();
    const rows: BracketRow[] = [];
    for (const r of main) {
      if (!inBracket(r)) continue;
      for (const t of r.ties) {
        // A tie with a side not known yet is left out: the tree is walked by team, and the positions under it would
        // be closed to the games that feed it. Its place shows as "Winner of ..." until both sides are known.
        if (!known(t.home) || !known(t.away)) continue;
        const res = results.get(t)!;
        const id = `${r.key}:${t.key}`;
        tieById.set(id, t);
        const n = number(r.rank.size!);
        rows.push({
          // game_date only orders the rows: the round first, so a rearranged fixture cannot put a team's rounds out of order.
          id, game_date: `${String(n).padStart(2, '0')} ${t.legs[0]!.kickoff}`, status: res.status, bracket_slot: null, round_number: n, tournament_round: r.label,
          home_program_id: String(t.home.id), away_program_id: String(t.away.id), home_name: t.home.name, away_name: t.away.name,
          home_seo: null, away_seo: null, home_logo: t.home.logo, away_logo: t.away.logo,
          home_score: res.home, away_score: res.away, home_seed: null, away_seed: null, overtime: res.overtime, shootout: !!res.pens, neutral_site: false,
          // Level on the score shown: the winner worked out above (shootout, or the side that plays on).
          shootout_winner: res.winner && res.home === res.away ? String(res.winner === 'home' ? t.home.id : t.away.id) : null,
        });
      }
    }
    const tree = rows.length ? conferenceBracket(rows, { rounds: count }) : null;
    if (tree) {
      const out: CupRound[] = tree.rounds.map((r, i) => ({
        number: r.number, label: knockoutLabel(2 ** (count - i)),
        games: r.games.map((g) => { const t = g?.id ? tieById.get(g.id) : null; return g && t ? toGame(t, results.get(t)!, g.position, g.feeds, link) : null; }),
      }));
      const final = out[out.length - 1]!.games[0] ?? null;
      const champion = final?.status === 'final' ? (final.home?.winner ? final.home : final.away?.winner ? final.away : null) : null;
      bracket = { rounds: out, champion, complete: !!champion, teams: tree.teams };
    }
  }

  const flat = (r: Round) => r.ties.map((t, i) => toGame(t, results.get(t)!, i + 1, [null, null], link));
  return {
    bracket,
    third_place: third ? flat(third)[0] ?? null : null,
    preliminary: main.filter((r) => !bracket || !inBracket(r)).map((r) => ({ label: r.label, games: flat(r) })),
  };
}
