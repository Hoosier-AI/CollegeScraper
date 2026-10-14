import { describe, it, expect } from 'vitest';
import { AREA_NAV, navItemFor } from '../../ui/src/lib/nav.js';

describe('one menu for every area', () => {
  it('keeps the same slots in the same order', () => {
    const order = ['matches', 'competitions', 'teams', 'players', 'leaders', 'rankings', 'news'];
    for (const area of ['college', 'pro', 'intl'] as const) {
      const keys = AREA_NAV[area].slots.map((s) => s.key);
      expect(keys).toEqual(order);
    }
  });
  it('names the competitions slot in each area\'s own word', () => {
    expect(['college', 'pro', 'intl'].map((a) => AREA_NAV[a as 'college'].slots[1]!.label)).toEqual(['Conferences', 'Leagues', 'Tournaments']);
  });
  it('lights the section a detail page belongs to', () => {
    expect(navItemFor('college', '/players/abc')?.label).toBe('Players');
    expect(navItemFor('pro', '/pro/teams/atlanta-united-fc')?.label).toBe('Teams');
    expect(navItemFor('pro', '/pro/abroad')?.label).toBe('Americans abroad');
    expect(navItemFor('intl', '/intl/tournaments/world-cup')?.label).toBe('Tournaments');
    expect(navItemFor('college', '/playersx')).toBeNull();
  });
});
