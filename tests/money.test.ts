import { describe, expect, it } from 'vitest';
import { adsTxt, buildCsp, currentSponsors, normalizeAds, normalizeSponsors, placementFor } from '../src/money/config.js';

describe('ads settings', () => {
  it('stays off without a valid publisher id', () => {
    expect(normalizeAds({ enabled: true })).toEqual({ enabled: false, client: null, slots: { rail: null, inline: null } });
    expect(normalizeAds({ enabled: true, client: 'pub-123' }).enabled).toBe(false);
    expect(normalizeAds(null).enabled).toBe(false);
  });
  it('keeps a valid publisher and slot ids', () => {
    expect(normalizeAds({ enabled: true, client: 'ca-pub-1234567890123456', slots: { rail: '1234567890', inline: 'x' } })).toEqual({
      enabled: true,
      client: 'ca-pub-1234567890123456',
      slots: { rail: '1234567890', inline: null },
    });
  });
  it('writes the ads.txt line only with a publisher', () => {
    expect(adsTxt(normalizeAds({ client: 'ca-pub-1234567890123456' }))).toBe('google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
    expect(adsTxt(normalizeAds({}))).toBeNull();
  });
});

describe('content security policy', () => {
  it('allows only our own scripts and no frames while ads are off', () => {
    const csp = buildCsp(false);
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain('google');
    expect(csp).not.toContain('frame-src');
    expect(csp).toContain("frame-ancestors 'none'");
  });
  it('adds Google ad and consent hosts while ads are on', () => {
    const csp = buildCsp(true);
    expect(csp).toMatch(/script-src 'self' https:\/\/pagead2\.googlesyndication\.com/);
    expect(csp).toContain('frame-src https://pagead2.googlesyndication.com');
    expect(csp).toContain('https://fundingchoicesmessages.google.com');
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('sponsors', () => {
  const list = normalizeSponsors([
    { placement: 'college', name: '  Elite  ID Camps ', url: 'https://example.com/camps', tagline: 'Find your college fit', starts_on: '2026-10-01', ends_on: '2026-12-31' },
    { placement: 'pro', name: 'Old', url: 'https://old.example.com', ends_on: '2026-09-30' },
    { placement: 'site', name: 'Insecure', url: 'http://example.com' },
    { placement: 'ads', name: 'Bad placement', url: 'https://example.com' },
  ]);
  it('keeps only valid https sponsors and cleans their names', () => {
    expect(list.map((s) => s.name)).toEqual(['Elite ID Camps', 'Old']);
  });
  it('shows a sponsor only between its dates', () => {
    expect(currentSponsors(list, '2026-10-16').map((s) => s.name)).toEqual(['Elite ID Camps']);
    expect(currentSponsors(list, '2026-09-15').map((s) => s.name)).toEqual(['Old']);
  });
  it('maps a page to its section', () => {
    expect(placementFor('/pro/leagues/39')).toBe('pro');
    expect(placementFor('/intl/rankings')).toBe('intl');
    expect(placementFor('/news')).toBe('news');
    expect(placementFor('/pro/news')).toBe('news');
    expect(placementFor('/pro/newsletter')).toBe('pro');
    expect(placementFor('/teams/123')).toBe('college');
  });
});
