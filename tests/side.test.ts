import { describe, expect, it } from 'vitest';
import { coachOnSide, intlHomeOnSide, matchesOnSide, proHomeOnSide, refereeOnSide, sideOf, transfersOnSide } from '../src/ui/side.js';

const day = { date: '2026-10-16', total: 3, live: 1, groups: [
  { league: { name: 'NWSL Women', gender: 'w' }, matches: [{ id: 1, status: 'live' }] },
  { league: { name: 'Major League Soccer', gender: 'm' }, matches: [{ id: 2 }, { id: 3 }] },
] };

describe('one side of a both-sides answer (?gender=m|w)', () => {
  it('reads only m or w', () => {
    expect(sideOf('w')).toBe('w'); expect(sideOf('women')).toBeNull(); expect(sideOf(undefined)).toBeNull();
  });
  it('keeps a match day to the side and redoes the counts', () => {
    expect(matchesOnSide(day, 'w')).toMatchObject({ total: 1, live: 1, groups: [{ league: { name: 'NWSL Women' } }] });
    expect(matchesOnSide(day, 'm')).toMatchObject({ total: 2, live: 0 });
    expect(matchesOnSide(day, null)).toBe(day);
  });
  it('Pro and International Today keep featured leagues, abroad lines, upcoming and tournaments to the side', () => {
    const pro = proHomeOnSide({ matches: day, next_us: null, featured: [{ gender: 'm' }, { gender: 'w' }], abroad: { lines: [{ match: { league: { gender: 'm' } } }, { match: { league: { gender: 'w' } } }] } }, 'w');
    expect(pro.featured).toEqual([{ gender: 'w' }]);
    expect(pro.abroad.lines).toHaveLength(1);
    const intl = intlHomeOnSide({ matches: day, upcoming: [{ league: { gender: 'm' } }], recent: [{ league: { gender: 'w' } }], tournaments: [{ gender: 'm' }, { gender: 'w' }] }, 'm');
    expect(intl.upcoming).toHaveLength(1); expect(intl.recent).toHaveLength(0); expect(intl.tournaments).toEqual([{ gender: 'm' }]);
  });
  it('transfers follow the destination club, unknown sides stay', () => {
    const rows = [{ to: { gender: 'w' } }, { to: { gender: 'm' } }, { to: { gender: null }, from: { gender: 'w' } }, { to: {} }];
    expect(transfersOnSide(rows, 'w')).toHaveLength(3);
  });
  it('a college referee and coach keep one side, with career and head record redone', () => {
    const ref = refereeOnSide({ referee: { name: 'R' }, career: { games: 30, cards_pg: 9 }, seasons: [{ season: 2025, gender: 'm', games: 20, cards_pg: 4 }, { season: 2025, gender: 'w', games: 10, cards_pg: 2 }], recent: [{ match: { gender: 'w', game_date: '2025-11-01' } }], teams: [{ program: { gender: 'm' } }] }, 'w');
    expect(ref.career).toMatchObject({ games: 10, cards_pg: 2 }); expect(ref.teams).toHaveLength(0); expect(ref.referee.last_date).toBe('2025-11-01');
    const coach = coachOnSide({ seasons: [{ is_head: true, program: { gender: 'm' }, record: { w: 10, l: 0, t: 0 } }, { is_head: true, program: { gender: 'w' }, record: { w: 5, l: 3, t: 2 } }], head_record: { w: 15, l: 3, t: 2, seasons: 2 } }, 'w');
    expect(coach.head_record).toMatchObject({ w: 5, l: 3, t: 2, seasons: 1, win_share: 0.6 });
  });
});
