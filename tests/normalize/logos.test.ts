import { describe, it, expect } from 'vitest';
import { hotlinkable, logoSrc, ncaaLogoUrl, teamCategories } from '../../src/normalize/logos.js';

describe('logos and avatars', () => {
  it('falls back to NCAA.com by slug, never for synthetic programs', () => {
    expect(logoSrc(null, 'mcneese')).toBe('https://www.ncaa.com/sites/default/files/images/logos/schools/bgl/mcneese.svg');
    expect(logoSrc('https://x/logo.svg', 'mcneese')).toBe('https://x/logo.svg');
    expect(ncaaLogoUrl('x-shawnee-state')).toBeNull();
  });
  it('knows which photos cannot be hotlinked', () => {
    expect(hotlinkable('https://umbcretrievers.com/images/2026/7/20/Besserhead2.png?width=80')).toBe(true);
    expect(hotlinkable('https://juniatasports.net/sports/msoc/2026-27/photos/0001/hs_A.jpg')).toBe(false);
    expect(hotlinkable('https://cdn.prestosports.com/action/cdn/img/x.jpg')).toBe(false);
    expect(hotlinkable(null)).toBe(false);
  });
});

describe('teamCategories', () => {
  it('keeps team rows only and the best rank per label', () => {
    const rows = [
      { poll: 'ncaa:1', label: 'Yellow Cards', rank: 5, value: 2, week_of: '2026-09-15', player_season_id: 'p1', subject_name: 'Yellow Cards|Jane Doe|Duke' },
      { poll: 'ncaa:2', label: 'Yellow Cards', rank: 88, value: 3, week_of: '2026-09-15', player_season_id: null, subject_name: 'Yellow Cards|Duke' },
      { poll: 'ncaa:3', label: 'Scoring Offense', rank: 2, value: 3.1, week_of: '2026-09-15', player_season_id: null, subject_name: 'Scoring Offense|Duke' },
      { poll: 'usc', label: 'Poll 4', rank: 1, value: 200, week_of: '2026-09-15', player_season_id: null, subject_name: 'Duke' },
    ];
    expect(teamCategories(rows)).toEqual([{ category: 'Scoring Offense', rank: 2, value: 3.1, week_of: '2026-09-15' }, { category: 'Yellow Cards', rank: 88, value: 3, week_of: '2026-09-15' }]);
  });
});
