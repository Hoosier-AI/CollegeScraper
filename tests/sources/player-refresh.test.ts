import { describe, it, expect } from 'vitest';
import { isBot } from '../../src/pro/playerRefresh.js';
import { parseLeaguePlayers } from '../../src/sources/apiFootball/parse.js';
import { fixture } from '../helpers/fakeFetcher.js';

describe('players fetched on view', () => {
  it('browsers do, bots and scripts never do', () => {
    expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/126 Safari/537.36')).toBe(false);
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBot('curl/8.4.0')).toBe(true);
    expect(isBot(undefined)).toBe(true);
  });
  it("one player's season answer keeps every competition", () => {
    const items = JSON.parse(fixture('apiFootball/league-players.json')).response;
    const all = parseLeaguePlayers(items, null, 2026).stats;
    const one = parseLeaguePlayers(items, 254, 2026).stats;
    expect(all.length).toBeGreaterThanOrEqual(one.length);
    expect(all.every((r) => Number.isInteger(r.league_id))).toBe(true);
    expect(new Set(all.map((r) => `${r.player_id}|${r.league_id}|${r.team_id}`)).size).toBe(all.length);
  });
});

import { isSelfNamed } from '../../src/pro/queries.js';
describe('transfers to a club named after the player', () => {
  it('are the provider\'s placeholder, not moves', () => {
    const salah = { display_name: 'Mohamed Salah', first_name: 'Mohamed', last_name: 'Salah Hamed Mahrous Ghaly' };
    expect(isSelfNamed('Salah Mohamed', salah)).toBe(true);
    expect(isSelfNamed('Liverpool', salah)).toBe(false);
    expect(isSelfNamed('Trabzonspor', salah)).toBe(false);
    expect(isSelfNamed(null, salah)).toBe(false);
    expect(isSelfNamed('Kingston Peter', { display_name: 'P. Kingston' })).toBe(true);
    expect(isSelfNamed('Lopez Antino', { display_name: 'A. Lopez' })).toBe(true);
    expect(isSelfNamed('Washington Huskies', { display_name: 'Jacob Castro', first_name: 'Jacob Alex', last_name: 'Castro' })).toBe(false);
    expect(isSelfNamed('Portland Timbers', { display_name: 'P. Kingston' })).toBe(false);
  });
});

import { within } from '../../src/pro/onView.js';
import { teamRefreshDue } from '../../src/pro/teamRefresh.js';
describe('clubs fetched on view', () => {
  it('a page waits a few seconds at most', async () => {
    expect(await within(new Promise<string>((r) => setTimeout(() => r('done'), 50)), 5, 'late')).toBe('late');
    expect(await within(Promise.resolve('done'), 50, 'late')).toBe('done');
  });
  it('clubs other sources created (negative ids) are never fetched', async () => {
    expect(await teamRefreshDue({} as never, -5)).toBe(false);
  });
});

import { cleanMoves } from '../../src/pro/queries.js';
describe('club transfer lists', () => {
  it('drops moves to the same club, placeholder clubs named after the player and repeats', () => {
    const m = (o: Record<string, unknown>) => ({ player_id: 1, date: '2026-01-05', from_team_id: 1595, to_team_id: 9000, from_name: 'Seattle Sounders', to_name: 'Austin', ...o });
    const names = new Map([[1, { display_name: 'P. Kingston', first_name: 'Paul', last_name: 'Kingston' }]]);
    const rows = [
      m({}), m({}),
      m({ to_team_id: 1595, to_name: 'Seattle Sounders' }),
      m({ to_team_id: 77001, to_name: 'Kingston Paul' }),
      m({ date: '2026-02-01', from_team_id: 9000, to_team_id: 1595, from_name: 'Austin', to_name: 'Seattle Sounders' }),
    ];
    expect(cleanMoves(rows, names).map((r) => `${r.date} ${r.from_name}>${r.to_name}`)).toEqual(['2026-01-05 Seattle Sounders>Austin', '2026-02-01 Austin>Seattle Sounders']);
  });
});

import { samePerson, mergeSquadDuplicates } from '../../src/pro/queries.js';
describe('one row per person in a squad', () => {
  it('knows a short and a full record of one player, and two different players apart', () => {
    expect(samePerson({ name: 'C. Gaffney' }, { name: 'Charles Gaffney', birth_date: '2003-07-29' })).toBe(true);
    expect(samePerson({ name: 'Nouhou', birth_date: '1997-06-23' }, { name: 'Nouhou Tolo', birth_date: '1997-06-23' })).toBe(true);
    expect(samePerson({ name: 'Nouhou' }, { name: 'Nouhou Tolo', birth_date: '1997-06-23' })).toBe(false);
    expect(samePerson({ name: 'Alex Roldan', birth_date: '1996-07-28' }, { name: 'Cristian Roldan', birth_date: '1995-06-03' })).toBe(false);
    expect(samePerson({ name: 'Jordan Morris' }, { name: 'Jaylin Morris' })).toBe(false);
    expect(samePerson({ name: 'P. Kingston' }, { name: 'Peter Kingston' })).toBe(true);
  });
  it('keeps the fuller record and the numbers of the row with more minutes', () => {
    const row = (id: number, name: string, minutes: number, extra: Record<string, unknown> = {}) => ({ player: { id, name, birth_date: null as string | null, ...extra }, number: null as number | null, listed: false, minutes });
    const out = mergeSquadDuplicates([row(1, 'P. Kingston', 1229, {}), { ...row(2, 'Peter Kingston', 1086, { birth_date: '2001-07-14' }), number: 45 }, row(3, 'Paul Arriola', 793)]);
    expect(out).toHaveLength(2);
    const pk = out.find((r) => r.minutes === 1229)!;
    expect(pk.player).toMatchObject({ id: 2, name: 'Peter Kingston' });
    expect(pk.number).toBe(45);
  });
});

import { mapPlayer } from '../../src/jobs/sources/mapping.js';
describe('a married name on one side', () => {
  const smith = { id: 1, display_name: 'Sophia Smith', first_name: 'Sophia', last_name: 'Smith', birth_date: '2000-08-10' } as any;
  const other = { id: 2, display_name: 'Sophia Jones', first_name: 'Sophia', last_name: 'Jones', birth_date: '2000-08-10' } as any;
  it('same birth date, first name and club: matched', () => {
    expect(mapPlayer({ name: 'Sophia Wilson', birth_date: '2000-08-10' } as any, [smith, other], [smith])).toMatchObject({ pro_id: 1 });
  });
  it('not at the club, or two such players there: no match', () => {
    expect(mapPlayer({ name: 'Sophia Wilson', birth_date: '2000-08-10' } as any, [smith], []).pro_id).toBeNull();
    expect(mapPlayer({ name: 'Sophia Wilson', birth_date: '2000-08-10' } as any, [smith, other], [smith, other]).pro_id).toBeNull();
  });
});
