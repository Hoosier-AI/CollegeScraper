import { describe, expect, it } from 'vitest';
import { isPlaceholderTeam, LOOKAHEAD_DAYS } from '../src/jobs/sweepScoreboard.js';

describe('NCAA.com placeholder teams', () => {
  it('treats "TBA"/"TBD" as no team', () => {
    expect(isPlaceholderTeam({ seo: 'tba', short: 'TBA', full: 'TBA' })).toBe(true);
    expect(isPlaceholderTeam({ seo: null, short: 'TBD', full: null })).toBe(true);
    expect(isPlaceholderTeam({ seo: 'tba ', short: null })).toBe(true);
  });
  it('keeps real teams, including names that contain the letters', () => {
    expect(isPlaceholderTeam({ seo: 'vanderbilt', short: 'Vanderbilt', full: 'Vanderbilt University' })).toBe(false);
    expect(isPlaceholderTeam({ seo: 'tbaa', short: 'TBA State' })).toBe(false);
  });
  it('reads a week ahead, so a bracket announced on Monday is on the site before Thursday', () => {
    expect(LOOKAHEAD_DAYS).toBeGreaterThanOrEqual(4);
  });
});
