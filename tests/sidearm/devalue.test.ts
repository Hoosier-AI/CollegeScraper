import { describe, expect, it } from 'vitest';
import { decodeDevalue, decodeNuxtData, extractNuxtDataJson, findObject } from '../../src/sources/sites/sidearm/devalue.js';
import { fixture } from '../helpers/fakeFetcher.js';

describe('devalue decoder', () => {
  it('round-trips a handmade Nuxt payload with wrappers, Set/Map/Date and a cycle', () => {
    const flat = [
      { a: 1, list: 2, date: 6, set: 8, flag: 9, map: 10, nested: 4, self: 0, missing: -1, nan: -3 },
      'hello',
      ['Reactive', 3],
      [1, 5, -1],
      ['Ref', 7],
      42,
      ['Date', '2025-11-30T00:00:00.000Z'],
      { x: 5 },
      ['Set', 1, 5],
      ['ShallowRef', 12],
      ['Map', 1, 5],
      'unused',
      true,
    ];
    const root = decodeDevalue(flat) as Record<string, unknown>;
    expect(root.a).toBe('hello');
    expect(root.list).toEqual(['hello', 42, undefined]);
    expect(root.nested).toEqual({ x: 42 });
    expect(root.flag).toBe(true);
    expect(root.missing).toBeUndefined();
    expect(Number.isNaN(root.nan)).toBe(true);
    expect(root.date).toBeInstanceOf(Date);
    expect((root.date as Date).toISOString()).toBe('2025-11-30T00:00:00.000Z');
    expect(root.set).toBeInstanceOf(Set);
    expect([...(root.set as Set<unknown>)]).toEqual(['hello', 42]);
    expect(root.map).toBeInstanceOf(Map);
    expect((root.map as Map<unknown, unknown>).get('hello')).toBe(42);
    expect(root.self).toBe(root); // cycle preserved, no infinite recursion
  });

  it('extracts the script body and tolerates missing payloads', () => {
    const html = '<html><script type="application/json" data-ssr="true" id="__NUXT_DATA__">[{"a":1},"x"]</script></html>';
    expect(extractNuxtDataJson(html)).toBe('[{"a":1},"x"]');
    expect(decodeNuxtData(html)).toEqual({ a: 'x' });
    expect(extractNuxtDataJson('<html></html>')).toBeNull();
    expect(decodeNuxtData('<html></html>')).toBeUndefined();
    expect(decodeNuxtData('<script id="__NUXT_DATA__">not json</script>')).toBeUndefined();
  });

  it('decodes the real box score payload down to pinia.boxscore.boxscore', () => {
    const root = decodeNuxtData(fixture('sidearm/duke-boxscore-24759.html')) as Record<string, unknown>;
    expect(root).toBeTruthy();
    expect(root.path).toBe('/sports/mens-soccer/stats/2025/akron/boxscore/24759');
    const pinia = root.pinia as Record<string, unknown>;
    const store = pinia.boxscore as Record<string, unknown>;
    const games = store.boxscore as Record<string, Record<string, unknown>>;
    const ids = Object.keys(games);
    expect(ids.length).toBe(1);
    const game = games[ids[0]!]!;
    expect(game.homeTeamName).toBe('Akron');
    expect(game.visitingTeamName).toBe('Duke');
    expect(Array.isArray(game.plays)).toBe(true);
    expect(findObject(root, (o) => 'homeTeam' in o && 'visitingTeam' in o)).toBe(game);
  });
});
