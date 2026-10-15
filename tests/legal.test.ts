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
  it('splits inline links', () => {
    expect(inlineParts('See [Terms](/terms) now')).toEqual([{ text: 'See ' }, { text: 'Terms', href: '/terms' }, { text: ' now' }]);
  });
});
