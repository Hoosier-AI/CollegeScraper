import { describe, expect, it } from 'vitest';
import { pkWinners, planPostseason } from '../../src/jobs/classifyPostseason.js';

const base = { postseason: false, postseason_source: null, tournament: null, tournament_round: null, round_number: null, home_seed: null, away_seed: null,
  shootout_winner: null, tournament_conference_id: null, bracket_slot: null, conference_game: true, shootout: false, neutral_site: false, gender: 'm', status: 'final' };
const game = (id: string, date: string, home: string, away: string, hs: number, as: number, extra: Record<string, unknown> = {}) =>
  ({ ...base, id, game_date: date, home_program_id: home, away_program_id: away, home_score: hs, away_score: as, ...extra }) as any;
const members = ['A', 'B', 'C', 'D'].map((p) => ({ program_id: p, conference_id: 'X', gender: 'm' }));
const conferences = [{ id: 'X', name: 'Example Conference', short_name: 'EX' }];
// A double round robin, then a four-team knockout.
const season = [
  game('r1', '2026-10-01', 'A', 'B', 1, 0), game('r2', '2026-10-01', 'C', 'D', 1, 0), game('r3', '2026-10-05', 'A', 'C', 1, 0), game('r4', '2026-10-05', 'B', 'D', 1, 0),
  game('r5', '2026-10-09', 'A', 'D', 1, 0), game('r6', '2026-10-09', 'B', 'C', 1, 0),
  game('s1', '2026-11-06', 'A', 'D', 2, 0), game('s2', '2026-11-06', 'B', 'C', 1, 0), game('f', '2026-11-09', 'A', 'B', 1, 1),
];

describe('pkWinners', () => {
  it('the side with more shootout goals; disagreeing sources answer nothing', () => {
    expect(pkWinners([{ game_id: 'g', program_id: 'A', source: 'ncaa', shootout_goals: 3 }, { game_id: 'g', program_id: 'B', source: 'ncaa', shootout_goals: 2 }]).get('g')).toBe('A');
    expect(pkWinners([
      { game_id: 'g', program_id: 'A', source: 'ncaa', shootout_goals: 3 }, { game_id: 'g', program_id: 'B', source: 'ncaa', shootout_goals: 2 },
      { game_id: 'g', program_id: 'B', source: 'site', shootout_goals: 4 },
    ]).has('g')).toBe(false);
  });
});

describe('planPostseason', () => {
  const plan = (games: any[], pk = new Map<string, string>()) => planPostseason({ games, members, conferences, official: [], pk, asOf: '2026-11-16' });

  it('marks the knockout games, out of the conference table, with rounds and the champion from the shootout', () => {
    const { patches, tournaments } = plan(season, new Map([['f', 'B']]));
    expect([...patches.keys()].sort()).toEqual(['f', 's1', 's2']);
    expect(patches.get('f')).toMatchObject({ postseason: true, postseason_source: 'inferred', tournament: 'EX Tournament', tournament_round: 'Final', conference_game: false, shootout_winner: 'B' });
    expect(patches.get('s1')).toMatchObject({ tournament_round: 'Semifinal', round_number: 1 });
    expect(tournaments[0]!.champion).toBe('B');
  });

  it('only writes what changes', () => {
    const first = plan(season, new Map([['f', 'B']])).patches;
    const applied = season.map((g) => ({ ...g, ...(first.get(g.id) ?? {}) }));
    expect(plan(applied, new Map([['f', 'B']])).patches.size).toBe(0);
  });

  it('a game it marked before and no longer finds goes back to a plain conference game', () => {
    const stale = [...season.slice(0, 6), game('x', '2026-10-12', 'C', 'D', 2, 1, { postseason: true, postseason_source: 'inferred', tournament: 'EX Tournament', conference_game: false })];
    expect(plan(stale).patches.get('x')).toMatchObject({ postseason: false, postseason_source: null, tournament: null, conference_game: true });
  });

  it('a level final: the NCAA field settles it when only one finalist is in it', () => {
    const ncaa = [game('n1', '2026-11-20', 'B', 'Z', 2, 0, { postseason: true, postseason_source: 'ncaa', bracket_slot: 101, conference_game: false })];
    const { tournaments, patches } = plan([...season, ...ncaa], new Map([['f', 'A']]));
    expect(tournaments[0]!.champion).toBe('B');
    expect(patches.get('f')).toMatchObject({ shootout_winner: 'B' });
    expect(patches.has('n1')).toBe(false);
  });

  it('a level NCAA game takes its shootout winner from the next slot', () => {
    const ncaa = [
      game('n1', '2026-11-20', 'C', 'Z', 1, 1, { postseason: true, postseason_source: 'ncaa', bracket_slot: 101, conference_game: false }),
      game('n2', '2026-11-23', 'Z', 'Y', 0, 1, { postseason: true, postseason_source: 'ncaa', bracket_slot: 201, conference_game: false }),
    ];
    expect(plan([...season, ...ncaa]).patches.get('n1')).toEqual({ shootout_winner: 'Z' });
  });
});
