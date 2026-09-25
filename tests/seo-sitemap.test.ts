// Sitemap documents, file splitting and robots.txt.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Sitemaps, sitemapIndexXml, urlsetXml, PER_FILE } from '../src/seo/sitemaps.js';
import { robotsTxt } from '../src/seo/robots.js';
import { FixtureSeoData } from './helpers/seoFixtures.js';

const BASE = 'https://plaibook-college-scraper.onrender.com';

describe('sitemap xml', () => {
  it('writes absolute, escaped locations with a date-only lastmod', () => {
    const xml = urlsetXml(`${BASE}/`, [{ path: '/teams?season=2025&x=1', lastmod: '2026-09-20T12:34:56Z' }, { path: '/rankings' }]);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
    expect(xml).toContain(`<url><loc>${BASE}/teams?season=2025&amp;x=1</loc><lastmod>2026-09-20</lastmod></url>`);
    expect(xml).toContain(`<url><loc>${BASE}/rankings</loc></url>`);
    expect(sitemapIndexXml(BASE, [{ path: '/sitemaps/core.xml' }])).toContain(`<sitemap><loc>${BASE}/sitemaps/core.xml</loc></sitemap>`);
  });
  it('keeps each file within the 40,000 URL limit', () => {
    expect(PER_FILE).toBe(40_000);
  });
});

describe('Sitemaps', () => {
  it('indexes core, teams and per-season files split by size, skipping empty seasons', async () => {
    const data = new FixtureSeoData();
    const s = new Sitemaps(data, BASE, { perFile: 3 });
    const files = (await s.files()).map((f) => f.path);
    expect(files).toEqual([
      '/sitemaps/core.xml', '/sitemaps/teams.xml',
      '/sitemaps/matches-2026-1.xml', '/sitemaps/matches-2026-2.xml', '/sitemaps/matches-2026-3.xml',
      '/sitemaps/players-2026-1.xml', '/sitemaps/players-2026-2.xml',
      '/sitemaps/players-2025-1.xml',
    ]);
    const second = await s.get('/sitemaps/matches-2026-2.xml');
    expect(second?.match(/<url>/g)).toHaveLength(3);
    expect(second).toContain('/matches/2026-game-3<');
    const last = await s.get('/sitemaps/matches-2026-3.xml');
    expect(last?.match(/<url>/g)).toHaveLength(1);
    expect(await s.get('/sitemaps/matches-2026-4.xml')).toBeNull();
    expect(await s.get('/sitemaps/players-2025-0.xml')).toBeNull();
    expect(await s.get('/sitemaps/nope.xml')).toBeNull();
    const core = await s.get('/sitemaps/core.xml');
    for (const p of ['/', '/rankings', '/teams', '/conferences/acc']) expect(core).toContain(`<loc>${BASE}${p}</loc>`);
  });
  it('caches documents for an hour', async () => {
    const data = new FixtureSeoData();
    const spy = vi.spyOn(data, 'sitemapTeams');
    const s = new Sitemaps(data, BASE);
    await s.get('/sitemaps/teams.xml'); await s.get('/sitemaps/teams.xml');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('robots.txt', () => {
  const txt = robotsTxt(BASE);
  const group = (agent: string) => { const i = txt.indexOf(`User-agent: ${agent}\n`); return txt.slice(i, txt.indexOf('\n\n', i)); };
  it('lets crawlers read /api (pages render from it) and keeps the admin surfaces and /v1 out', () => {
    const star = group('*');
    expect(star).toContain('Allow: /api/');
    expect(star).not.toContain('Disallow: /api/\n');
    for (const p of ['/admin', '/jobs', '/quality', '/console', '/v1']) expect(star).toContain(`Disallow: ${p}\n`);
  });
  it('blocks AI training crawlers everywhere and allows AI answer crawlers', () => {
    for (const bot of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Bytespider']) expect(group(bot)).toMatch(/^Disallow: \/$/m);
    for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User']) {
      expect(txt).toContain(`User-agent: ${bot}\n`);
      expect(group(bot)).toContain('Allow: /\n');
      expect(group(bot)).not.toMatch(/^Disallow: \/$/m);
    }
    expect(txt).toContain(`Sitemap: ${BASE}/sitemap.xml`);
  });
  it('ui/public/robots.txt is the same file for the production host', () => {
    expect(readFileSync(new URL('../ui/public/robots.txt', import.meta.url), 'utf8')).toBe(txt);
  });
});
