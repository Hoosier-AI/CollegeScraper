import { describe, expect, it } from 'vitest';
import { checkRequest, ipHash } from '../src/legal/routes.js';
import { inlineParts, LEGAL, LEGAL_SLUGS } from '../src/legal/content.js';
import { legalBody, legalHead } from '../src/seo/legal.js';

describe('request form', () => {
  it('accepts a proper request and trims it', () => {
    const r = checkRequest({ kind: 'removal', email: ' Parent@Example.com ', details: 'Please remove my son\'s hometown from his page.', page_url: 'https://www.plaibook.live/players/x', name: '  A  B ' });
    expect(r).toMatchObject({ ok: true, row: { kind: 'removal', email: 'parent@example.com', name: 'A B' } });
  });
  it('refuses bad input and quietly drops honeypot hits', () => {
    expect(checkRequest({ kind: 'hack', email: 'a@b.co', details: 'long enough text' })).toMatchObject({ ok: false });
    expect(checkRequest({ kind: 'other', email: 'not an email', details: 'long enough text' })).toMatchObject({ ok: false });
    expect(checkRequest({ kind: 'other', email: 'a@b.co', details: 'short' })).toMatchObject({ ok: false });
    expect(checkRequest({ kind: 'other', email: 'a@b.co', details: 'long enough text', page_url: 'javascript:alert(1)' })).toMatchObject({ ok: false });
    expect(checkRequest({ kind: 'other', email: 'a@b.co', details: 'long enough text', website: 'http://spam' })).toEqual({ ok: false, error: 'spam', spam: true });
  });
  it('takes advertising, sponsorship and data-access enquiries with a company', () => {
    const r = checkRequest({ kind: 'sponsorship', email: 'deals@brand.com', company: '  Brand  Co ', details: 'We would like to sponsor the college section.' });
    expect(r).toMatchObject({ ok: true, row: { kind: 'sponsorship', company: 'Brand Co' } });
    expect(checkRequest({ kind: 'data_access', email: 'a@b.co', details: 'We want API access for our app.' })).toMatchObject({ ok: false, error: 'Enter your company or organisation.' });
    expect(checkRequest({ kind: 'correction', email: 'a@b.co', details: 'The score was 2-1, not 2-0.' })).toMatchObject({ ok: true, row: { company: null } });
  });
  it('hashes the IP one way, stable per salt', () => {
    expect(ipHash('1.2.3.4', 's')).toBe(ipHash('1.2.3.4', 's'));
    expect(ipHash('1.2.3.4', 's')).not.toContain('1.2.3.4');
    expect(ipHash('1.2.3.4', 's')).not.toBe(ipHash('1.2.3.4', 't'));
  });
});

describe('policy pages', () => {
  it('every page has text, a path and server HTML with escaped links', () => {
    for (const s of LEGAL_SLUGS) {
      const p = LEGAL[s];
      expect(p.path).toBe(`/${s}`);
      expect(p.sections.length).toBeGreaterThan(0);
      const html = legalBody(s);
      expect(html).toContain(`<h1>`);
      expect(html).not.toMatch(/\]\(/); // every [text](url) became a link
      expect(legalHead(s, { baseUrl: 'https://www.plaibook.live', currentSeason: 2026 }).canonical).toBe(`https://www.plaibook.live/${s}`);
    }
  });
  it('leaves room for advertising: no page promises there will never be ads', () => {
    const all = JSON.stringify(LEGAL_SLUGS.map((s) => LEGAL[s]));
    expect(all).not.toMatch(/no advertising and no cookies|we do not run ads|no cookies, no ad tracking/i);
    expect(JSON.stringify(LEGAL.terms)).toContain('Advertising, sponsorships and paid features');
    expect(JSON.stringify(LEGAL.privacy)).toContain('Your privacy choices');
  });
  it('keeps the licence notices the open sources require on /sources', () => {
    const credits = JSON.stringify(LEGAL.sources);
    expect(credits).toContain('Wikipedia');
    expect(credits).toContain('CC BY-SA 4.0');
    expect(credits).toContain('Joshua C. Fjelstul');
    expect(credits).toContain('github.com/jfjelstul/worldcup');
    expect(credits).toContain('gdeltproject.org');
  });
  it('splits inline links', () => {
    expect(inlineParts('See [Terms](/terms) now')).toEqual([{ text: 'See ' }, { text: 'Terms', href: '/terms' }, { text: ' now' }]);
  });
});
