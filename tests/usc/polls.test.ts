import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { parseUscSite, parseUscDate, parseOthers, uscSiteUrl } from '../../src/sources/usc/polls.js';

describe('united soccer coaches polls', () => {
  it('parses every poll on the D1 men page in chronological order', () => {
    const site = parseUscSite(fixture('usc/ncaa-di-men.html'));
    expect(site.title).toMatch(/DI Mens/);
    expect(site.polls.map((p) => p.label)).toEqual(['Pre-season Poll', 'Poll 1', 'Poll 2', 'Poll 3']);
    expect(site.polls.map((p) => p.publishedOn)).toEqual(['2026-08-04', '2026-08-25', '2026-09-01', '2026-09-08']);
    const p3 = site.polls[3]!;
    expect(p3.rows).toHaveLength(25);
    expect(p3.rows[0]).toEqual({ rank: 1, school: 'Stanford University', previous: 1, firstPlaceVotes: 8, points: 200, record: expect.stringMatching(/^\d+-\d+-\d+$/) });
    expect(p3.notes).toMatch(/through games of September 6, 2026/);
    expect(p3.alsoReceiving.map((o) => o.school)).toContain('UMKC');
    expect(p3.alsoReceiving.find((o) => o.school === 'Utah Valley University')?.points).toBe(7);
    expect(site.polls[0]!.rows[0]!.school).toBe('University of Washington');
  });
  it('parses a page with a single pre-season poll (D3 women)', () => {
    const site = parseUscSite(fixture('usc/ncaa-diii-women.html'));
    expect(site.polls).toHaveLength(1);
    expect(site.polls[0]!.label).toBe('Pre-season Poll');
    expect(site.polls[0]!.publishedOn).toBe('2026-08-04');
    expect(site.polls[0]!.rows.length).toBeGreaterThanOrEqual(25);
  });
  it('helpers', () => {
    expect(parseUscDate('National - Poll 3 - September 8, 2026')).toBe('2026-09-08');
    expect(parseUscDate('Sept. 8, 2026')).toBe('2026-09-08');
    expect(parseOthers('Also receiving votes: Utah Valley University (7), University of Memphis (7), UMKC (1)')).toEqual([{ school: 'Utah Valley University', points: 7 }, { school: 'University of Memphis', points: 7 }, { school: 'UMKC', points: 1 }]);
    expect(uscSiteUrl('w', 'd2')).toBe('https://unitedsoccercoaches.org/rankings/college-rankings/ncaa-dii-women/');
    expect(uscSiteUrl('m', 'd1')).toBe('https://unitedsoccercoaches.org/rankings/college-rankings/ncaa-di-men/');
  });
});
