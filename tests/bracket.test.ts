import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { conferenceBracket, ncaaBracket, ncaaNextSlot, type BracketRow } from '../src/college/bracket.js';
import { classifyConference, type PsGame } from '../src/college/postseason.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/postseason/${name}.json`, import.meta.url), 'utf8'));
const row = (x: Partial<BracketRow> & { id: string; game_date: string }): BracketRow => ({
  status: 'final', bracket_slot: null, round_number: null, tournament_round: null, home_program_id: null, away_program_id: null, home_name: null, away_name: null,
  home_seo: null, away_seo: null, home_logo: null, away_logo: null, home_score: null, away_score: null, home_seed: null, away_seed: null,
  overtime: false, shootout: false, neutral_site: false, shootout_winner: null, ...x,
});

// The 2025 NCAA tournaments as NCAA.com's scoreboard listed them (team names in place of ids).
function ncaa2025(g: 'm' | 'w') {
  return (fixture('ncaa-2025')[g] as any[]).map((x) => row({ id: x.id, game_date: x.game_date, bracket_slot: x.slot, round_number: x.round,
    home_program_id: x.home, away_program_id: x.away, home_name: x.home, away_name: x.away, home_score: x.hs, away_score: x.as, home_seed: x.home_seed, away_seed: x.away_seed }));
}

describe('NCAA bracket from slots', () => {
  it('women 2025: 64 teams, six full rounds, Florida St. champion', () => {
    const b = ncaaBracket(ncaa2025('w'))!;
    expect(b.rounds.map((r) => r.games.length)).toEqual([32, 16, 8, 4, 2, 1]);
    expect(b.rounds.map((r) => r.games.filter(Boolean).length)).toEqual([32, 16, 8, 4, 2, 1]);
    expect(b.teams).toBe(64);
    expect(b.champion?.name).toBe('Florida St.');
    // Every winner appears in the game its position feeds.
    for (let r = 0; r < 5; r++) b.rounds[r]!.games.forEach((g, i) => {
      const w = g!.home!.winner ? g!.home!.id : g!.away!.winner ? g!.away!.id : null;
      const next = b.rounds[r + 1]!.games[Math.floor(i / 2)]!;
      expect(w, `${b.rounds[r]!.label} ${g!.home!.name} v ${g!.away!.name}`).not.toBeNull();
      expect([next.home!.id, next.away!.id]).toContain(w);
    });
  });

  it('a level game with no shootout winner stored goes to the side found in the next slot', () => {
    const b = ncaaBracket(ncaa2025('w'))!;
    const g = b.rounds[2]!.games.find((x) => x!.home!.name === 'Virginia' && x!.away!.name === 'Washington')!;
    expect(g.shootout).toBe(true);
    expect(g.away!.winner).toBe(true);
  });

  it('men 2025: 48 teams, the top 16 seeds start in round two (16 first-round byes)', () => {
    const b = ncaaBracket(ncaa2025('m'))!;
    expect(b.rounds[0]!.games.filter(Boolean)).toHaveLength(16);
    expect(b.rounds[1]!.games.filter(Boolean)).toHaveLength(16);
    expect(b.teams).toBe(48);
    expect(b.champion?.name).toBe('Washington');
  });

  it('before it starts: unknown later games are empty positions fed by the round before', () => {
    const b = ncaaBracket(ncaa2025('w').filter((g) => g.round_number === 1).map((g) => ({ ...g, status: 'scheduled', home_score: null, away_score: null })))!;
    expect(b.rounds[1]!.games.every((g) => g === null)).toBe(true);
    expect(b.champion).toBeNull();
  });
});

describe('conference bracket from the tree', () => {
  function bigTenMen(): BracketRow[] {
    const f = fixture('big-ten-men-2026');
    const final = (f.games as PsGame[]).find((g) => g.date === '2026-11-15')!;
    const t = classifyConference({ members: f.members, asOf: '2026-11-16', games: (f.games as PsGame[]).map((g) => (g.id === final.id ? { ...g, pkWinner: 'Indiana' } : g)) })!;
    const byId = new Map<string, PsGame>(f.games.map((g: PsGame) => [g.id, g]));
    return t.games.map((tg) => { const g = byId.get(tg.id)!; return row({ id: g.id, game_date: g.date, round_number: tg.round, home_program_id: g.home, away_program_id: g.away,
      home_name: g.home, away_name: g.away, home_score: g.hs, away_score: g.as, home_seed: tg.homeSeed, away_seed: tg.awaySeed, shootout_winner: tg.shootoutWinner ?? (g.id === final.id ? 'Indiana' : null) }); });
  }

  it('Big Ten men 2026: six teams, two byes, the final at the top', () => {
    const b = conferenceBracket(bigTenMen())!;
    expect(b.rounds.map((r) => r.label)).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
    expect(b.rounds.map((r) => r.games.filter(Boolean).length)).toEqual([2, 2, 1]);
    expect(b.champion?.name).toBe('Indiana');
    const final = b.rounds[2]!.games[0]!;
    // Each semifinal sits under the final on the side of the team it sent there.
    const [s1, s2] = b.rounds[1]!.games;
    expect([s1!.home!.name, s1!.away!.name]).toContain(final.home!.name);
    expect([s2!.home!.name, s2!.away!.name]).toContain(final.away!.name);
    // Byes: the semifinal side that came without a quarterfinal has an empty position below it.
    const empties = b.rounds[0]!.games.filter((g) => g === null).length;
    expect(empties).toBe(2);
  });

  it('a level semifinal is won by the side that played on', () => {
    const b = conferenceBracket(bigTenMen())!;
    const semi = b.rounds[1]!.games.find((g) => g!.home!.name === 'Washington')!;
    expect(semi.home!.winner).toBe(true);
  });
});

describe('ncaaNextSlot', () => {
  const g = (slot: number, home: string | null, away: string | null) => ({ bracket_slot: slot, home_program_id: home, away_program_id: away });
  it('uses the slot rule until a next-round game holds one of the teams', () => {
    const next = ncaaNextSlot([g(401, 'a', 'b'), g(402, 'c', 'd'), g(403, 'e', 'f'), g(404, 'g', 'h')]);
    expect([401, 402, 403, 404].map(next)).toEqual([501, 501, 502, 502]);
  });
  it('follows the teams when the pairing is crossed', () => {
    const next = ncaaNextSlot([g(401, 'a', 'b'), g(402, 'c', 'd'), g(403, 'e', 'f'), g(404, 'g', 'h'), g(501, 'h', 'e'), g(502, 'b', null)]);
    expect([401, 402, 403, 404].map(next)).toEqual([502, 502, 501, 501]);
  });
});
