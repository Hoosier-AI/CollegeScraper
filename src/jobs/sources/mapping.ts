// Pure: another source's clubs, games and players -> API-Football ids. source-map feeds it from the database and
// writes the answers to pro_source_ids. A match must be clear: two equally good candidates map to nothing.
import { bestOf, clubScore, nearKickoff, personScore, type ProPerson } from '../../sources/match.js';

export interface Mapped { pro_id: number | null; method: string; confidence: number; evidence?: Record<string, unknown> }
export interface SrcTeam { ext_id: string; name: string; short_name?: string | null }
export interface ApiTeam { id: number; name: string; display_name: string }
export interface SrcGame { ext_id: string; kickoff: string; home_ext: string; away_ext: string }
export interface ApiFixture { id: number; kickoff: string; home_team_id: number; away_team_id: number }
export interface SrcPerson { ext_id: string; name: string; birth_date: string | null }
export type ApiPerson = ProPerson & { id: number; birth_date: string | null };

/** Fixtures by UTC day, so a game only looks at the days around its own (not every fixture of every season). */
function dayIndex(fixtures: ApiFixture[]): (kickoff: string, hours: number) => ApiFixture[] {
  const DAY = 86400_000;
  const byDay = new Map<number, ApiFixture[]>();
  for (const f of fixtures) { const d = Math.floor(Date.parse(f.kickoff) / DAY); byDay.set(d, [...(byDay.get(d) ?? []), f]); }
  return (kickoff, hours) => {
    const t = Date.parse(kickoff), d = Math.floor(t / DAY), span = Math.ceil(hours / 24);
    const out: ApiFixture[] = [];
    for (let i = d - span; i <= d + span; i += 1) for (const f of byDay.get(i) ?? []) if (nearKickoff(f.kickoff, kickoff, hours)) out.push(f);
    return out;
  };
}

/**
 * Clubs: a hand-kept alias first, then the name (0.85 and up, clearly ahead of the rest), then the games: a club
 * that keeps meeting a mapped opponent at the same kickoff is the one API-Football has there (3+ games, 80%+).
 */
export function mapTeams(src: SrcTeam[], api: ApiTeam[], games: SrcGame[], fixtures: ApiFixture[], aliases: Record<string, number> = {}): Map<string, Mapped> {
  const out = new Map<string, Mapped>();
  for (const t of src) {
    const alias = aliases[t.ext_id] ?? aliases[t.name];
    if (alias != null) { out.set(t.ext_id, { pro_id: alias, method: 'alias', confidence: 1 }); continue; }
    const best = bestOf(api, (a) => Math.max(clubScore(t.name, a.name), clubScore(t.name, a.display_name), t.short_name ? clubScore(t.short_name, a.display_name) * 0.95 : 0), 0.85);
    if (best) out.set(t.ext_id, { pro_id: best.item.id, method: 'name', confidence: Math.round(best.score * 95) / 100, evidence: { api_name: best.item.name } });
  }
  // Games settle the rest, a round at a time (each round can unlock the next).
  const near = dayIndex(fixtures);
  for (let round = 0; round < 3; round += 1) {
    const votes = new Map<string, Map<number, number>>();
    for (const g of games) {
      for (const [mine, other, side] of [[g.home_ext, g.away_ext, 'home'], [g.away_ext, g.home_ext, 'away']] as const) {
        const known = out.get(mine)?.pro_id;
        if (known == null || out.get(other)?.pro_id != null) continue;
        const f = near(g.kickoff, 3).filter((x) => (side === 'home' ? x.home_team_id === known : x.away_team_id === known));
        if (f.length !== 1) continue;
        const theirs = side === 'home' ? f[0]!.away_team_id : f[0]!.home_team_id;
        const v = votes.get(other) ?? new Map<number, number>();
        v.set(theirs, (v.get(theirs) ?? 0) + 1);
        votes.set(other, v);
      }
    }
    let added = 0;
    for (const [ext, v] of votes) {
      const total = [...v.values()].reduce((a, b) => a + b, 0);
      const [id, n] = [...v.entries()].sort((a, b) => b[1] - a[1])[0]!;
      if (n >= 3 && n / total >= 0.8) { out.set(ext, { pro_id: id, method: 'games', confidence: 0.95, evidence: { games: n, of: total } }); added += 1; }
    }
    if (!added) break;
  }
  for (const t of src) if (!out.has(t.ext_id)) out.set(t.ext_id, { pro_id: null, method: 'none', confidence: 0 });
  return out;
}

/** Games: the same two mapped clubs within 36 hours (home and away swapped counts, a little less sure). */
export function mapGames(games: SrcGame[], fixtures: ApiFixture[], teams: Map<string, Mapped>): Map<string, Mapped> {
  const out = new Map<string, Mapped>();
  const around = dayIndex(fixtures);
  for (const g of games) {
    const h = teams.get(g.home_ext)?.pro_id, a = teams.get(g.away_ext)?.pro_id;
    if (h == null || a == null) { out.set(g.ext_id, { pro_id: null, method: 'none', confidence: 0 }); continue; }
    const near = around(g.kickoff, 36);
    const same = near.filter((f) => f.home_team_id === h && f.away_team_id === a);
    const swapped = near.filter((f) => f.home_team_id === a && f.away_team_id === h);
    if (same.length === 1) out.set(g.ext_id, { pro_id: same[0]!.id, method: 'teams+date', confidence: 1 });
    else if (!same.length && swapped.length === 1) out.set(g.ext_id, { pro_id: swapped[0]!.id, method: 'teams+date swapped', confidence: 0.9 });
    else out.set(g.ext_id, { pro_id: null, method: 'none', confidence: 0, evidence: { candidates: same.length + swapped.length } });
  }
  return out;
}

/**
 * Players: name and birth date (0.95); else name among the people API-Football has at the mapped club that season
 * (0.8), never one whose known birth date differs.
 */
export function mapPlayer(p: SrcPerson, byBirthAll: ApiPerson[], atClubAll: ApiPerson[]): Mapped {
  // The same person can come from several lists: one candidate each, or a tie would hide the match.
  const uniq = (xs: ApiPerson[]) => [...new Map(xs.map((x) => [x.id, x])).values()];
  const byBirth = uniq(byBirthAll), atClub = uniq(atClubAll);
  if (p.birth_date) {
    const best = bestOf(byBirth.filter((c) => c.birth_date === p.birth_date), (c) => personScore(p.name, c), 0.9);
    if (best) return { pro_id: best.item.id, method: 'name+birth', confidence: 0.95 };
  }
  const club = atClub.filter((c) => !p.birth_date || !c.birth_date || c.birth_date === p.birth_date);
  const best = bestOf(club, (c) => personScore(p.name, c), 0.9);
  if (best) return { pro_id: best.item.id, method: 'name+club', confidence: 0.8 };
  return { pro_id: null, method: 'none', confidence: 0 };
}
