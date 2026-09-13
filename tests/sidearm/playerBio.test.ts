import { describe, expect, it } from 'vitest';
import { extractHonors, parsePlayerBio } from '../../src/sources/sites/sidearm/playerBio.js';
import { fixture } from '../helpers/fakeFetcher.js';

describe('parsePlayerBio', () => {
  it('extracts honors and bio text from the recorded goduke.com bio page', () => {
    // Note: goduke.com served the 2012 women's soccer bio of Nicole Lipp for this URL
    // (the Nuxt payload src is /sports/womens-soccer/roster/colin-gallagher/8887), so the
    // assertions are about that page's content.
    const bio = parsePlayerBio(fixture('sidearm/duke-bio-8833.html'), 'https://goduke.com/sports/mens-soccer/roster/colin-gallagher/8833');
    expect(bio.sourceUrl).toBe('https://goduke.com/sports/mens-soccer/roster/colin-gallagher/8833');
    expect(bio.bioText).toBeTruthy();
    expect(bio.bioText!.length).toBeGreaterThan(3000);
    expect(bio.bioText!.length).toBeLessThan(20000); // bio container only, not the 900 KB of site chrome
    expect(bio.bioText).toMatch(/NCAA College Cup/);
    expect(bio.bioText).toMatch(/Lipp/);
    expect(bio.bioText).not.toMatch(/\s{2,}/);
    expect(bio.bioText).toMatch(/Career Statistics Career:/); // <br>/<strong> boundaries become spaces
    expect(bio.honors.length).toBeGreaterThan(5);
    expect(bio.honors).toContain('named to the NCAA College Cup’s All-Tournament Team, after notching two assists in the semifinals against Wake Forest');
    expect(bio.honors.some((h) => /Honorable Mention/.test(h))).toBe(true);
    expect(bio.honors.some((h) => /All-America/.test(h))).toBe(true);
    expect(bio.honors.some((h) => /First Team/.test(h))).toBe(true);
    expect(bio.honors.every((h) => h.length <= 200)).toBe(true);
    expect(new Set(bio.honors.map((h) => h.toLowerCase())).size).toBe(bio.honors.length);
  });

  it('parses legacy sidearm-roster-player-bio markup', () => {
    const html = `<html><body><div class="sidearm-roster-player-bio">
      <p><strong>2024:</strong> Named First Team All-ACC and United Soccer Coaches Second Team All-America ... started all 20 matches ... scored 9 goals.</p>
      <p><strong>2023:</strong> ACC All-Freshman Team selection; TopDrawerSoccer Team of the Week (Sept. 12); Honorable Mention All-ACC.</p>
      <p><strong>Personal:</strong> Son of Ann and Bob Gallagher.</p>
    </div></body></html>`;
    const bio = parsePlayerBio(html, 'https://x.edu/bio');
    expect(bio.bioText).toMatch(/^2024: Named First Team All-ACC/);
    expect(bio.bioText).toMatch(/Gallagher/);
    expect(bio.honors).toEqual([
      '2024: Named First Team All-ACC and United Soccer Coaches Second Team All-America',
      '2023: ACC All-Freshman Team selection',
      'TopDrawerSoccer Team of the Week (Sept. 12)',
      'Honorable Mention All-ACC',
    ]);
  });

  it('returns empty honors and null text when no bio container exists', () => {
    const bio = parsePlayerBio('<html><body><nav>menu</nav></body></html>', 'https://x.edu/bio');
    expect(bio).toEqual({ honors: [], bioText: null, sourceUrl: 'https://x.edu/bio' });
  });

  it('dedupes and truncates honors', () => {
    const long = `Named All-ACC ${'x'.repeat(300)}. Named All-ACC. named all-acc.`;
    const honors = extractHonors(long);
    expect(honors).toHaveLength(2);
    expect(honors[0]!.length).toBeLessThanOrEqual(200);
    expect(honors[1]).toBe('Named All-ACC');
  });
});
