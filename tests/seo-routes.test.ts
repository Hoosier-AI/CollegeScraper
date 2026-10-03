// The SEO routes end to end through Fastify inject, over fixture data and the real ui/index.html shell, with
// @fastify/static registered after them exactly as in src/server.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerSeo, PAGE_CACHE_CONTROL } from '../src/seo/routes.js';
import { stringTemplate } from '../src/seo/template.js';
import { FixtureSeoData, GAME_ID, PLAYER_ID, TEAM_ID, CONF_ID } from './helpers/seoFixtures.js';

const BASE = 'https://plaibook-college-scraper.onrender.com';
const shell = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const HTML = { accept: 'text/html,application/xhtml+xml' };

function makeApp(data = new FixtureSeoData(), extra: Partial<Parameters<typeof registerSeo>[1]> = {}) {
  const app = Fastify();
  const seo = registerSeo(app, { data, template: stringTemplate(shell), baseUrl: BASE, gscVerificationFile: 'google0123abcd.html', indexNowKey: 'abcdef0123456789', ...extra });
  app.register(fastifyStatic, { root: fileURLToPath(new URL('../ui/public', import.meta.url)), prefix: '/', wildcard: true });
  app.setNotFoundHandler(seo.notFound);
  return { app, data };
}

const between = (s: string, a: string, b: string) => { const i = s.indexOf(a); return i < 0 ? '' : s.slice(i + a.length, s.indexOf(b, i + a.length)); };

describe('seo routes', () => {
  let app: FastifyInstance; let data: FixtureSeoData;
  beforeAll(async () => { ({ app, data } = makeApp()); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('renders a team page: title, canonical, JSON-LD and the #ssr summary', async () => {
    const r = await app.inject({ url: '/teams/duke/men?tab=games', headers: HTML });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.headers['cache-control']).toBe(PAGE_CACHE_CONTROL);
    const html = r.body;
    expect(between(html, '<title>', '</title>')).toBe("Duke Men&#39;s Soccer 2026: Roster, Schedule and Stats | Plaibook Stats");
    expect(html).toContain(`<link rel="canonical" href="${BASE}/teams/duke/men" />`);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
    expect(ld.map((j) => j['@type'])).toEqual(['SportsTeam', 'BreadcrumbList']);
    expect(ld[0]).toMatchObject({ sport: 'Soccer', memberOf: { name: 'Atlantic Coast Conference' }, coach: { name: 'Kevin Coach' } });
    const ssr = between(html, '<section id="ssr">', '</section>');
    expect(ssr).toContain("<h1>Duke Men&#39;s Soccer 2026</h1>");
    expect(ssr).toContain('<a href="/players/jane-doe-222222">');
    expect(ssr).toContain('Coach with Tekki');
    expect(html.indexOf('<div id="root"></div>')).toBeLessThan(html.indexOf('<section id="ssr">'));
    expect(html).not.toContain('<!--ssr-');
    expect(html).toContain('<script type="module"'); // the app still boots
  });

  it('keeps a non-current season in the canonical and serves repeat views from the cache', async () => {
    const before = data.calls.length;
    const a = await app.inject({ url: '/teams/duke/men?season=2025', headers: HTML });
    expect(a.body).toContain(`<link rel="canonical" href="${BASE}/teams/duke/men?season=2025" />`);
    const b = await app.inject({ url: '/teams/duke/men?season=2025&tab=roster', headers: HTML });
    expect(b.headers['x-ssr-cache']).toBe('hit');
    expect(data.calls.length).toBe(before + 1);
  });

  it('301s UUID addresses to their slugs, keeping the query string', async () => {
    const t = await app.inject({ url: `/teams/${TEAM_ID}?season=2025`, headers: HTML });
    expect(t.statusCode).toBe(301);
    expect(t.headers.location).toBe('/teams/duke/men?season=2025');
    const p = await app.inject({ url: `/players/${PLAYER_ID}`, headers: HTML });
    expect(p.statusCode).toBe(301);
    expect(p.headers.location).toBe('/players/jane-doe-222222');
    const m = await app.inject({ url: `/matches/${GAME_ID}`, headers: HTML });
    expect(m.headers.location).toBe('/matches/2026-09-12-wake-forest-at-duke-men');
    const c = await app.inject({ url: `/conferences/${CONF_ID}`, headers: HTML });
    expect(c.headers.location).toBe('/conferences/acc');
    const renamed = await app.inject({ url: '/players/jane-smith-222222', headers: HTML });
    expect(renamed.statusCode).toBe(301);
    expect(renamed.headers.location).toBe('/players/jane-doe-222222');
    const upper = await app.inject({ url: '/teams/Duke/Men', headers: HTML });
    expect(upper.headers.location).toBe('/teams/duke/men');
  });

  it('answers unknown slugs and unknown paths with a real 404 page', async () => {
    for (const url of ['/teams/nowhere/men', '/teams/duke/mixed', `/teams/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, '/players/nobody-000000', '/matches/2026-01-01-a-at-b-men', '/conferences/none', '/teams/duke', '/totally/unknown', '/assets/missing.js']) {
      const r = await app.inject({ url, headers: HTML });
      expect(r.statusCode, url).toBe(404);
      expect(r.body).toContain('<meta name="robots" content="noindex" />');
      expect(r.body).toContain('<h1>Page not found</h1>');
    }
  });

  it('serves the app shell with 200 for app routes it does not render', async () => {
    for (const url of ['/matches', '/search?q=duke', '/console', '/teams/']) {
      const r = await app.inject({ url, headers: HTML });
      expect(r.statusCode, url).toBe(200);
      expect(r.body).toContain('<div id="root"></div>');
      expect(r.body).not.toContain('id="ssr"');
    }
  });

  it('keeps API paths as JSON 404s', async () => {
    const r = await app.inject({ url: '/api/nothing' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'not found' });
    expect((await app.inject({ url: '/v1/nothing' })).json()).toEqual({ error: 'not found' });
  });

  it('turns the old client-side redirects into 301s', async () => {
    expect((await app.inject({ url: '/standings?gender=w' })).headers.location).toBe('/rankings?gender=w');
    expect((await app.inject({ url: '/leaders' })).headers.location).toBe('/rankings?view=leaders');
    expect((await app.inject({ url: '/conferences' })).headers.location).toBe('/rankings?view=standings');
    const g = await app.inject({ url: `/games/${GAME_ID}` });
    expect(g.statusCode).toBe(301);
    expect(g.headers.location).toBe('/matches/2026-09-12-wake-forest-at-duke-men');
  });

  it('renders the player, match, conference, rankings, teams and home pages', async () => {
    const player = await app.inject({ url: '/players/jane-doe-222222', headers: HTML });
    expect(player.statusCode).toBe(200);
    expect(player.body).toContain('"@type":"Person"');
    expect(player.body).not.toContain('name="robots"');
    const match = await app.inject({ url: '/matches/2026-09-12-wake-forest-at-duke-men', headers: HTML });
    expect(match.body).toContain('"@type":"SportsEvent"');
    for (const [url, h1] of [['/conferences/acc', 'Atlantic Coast Conference Soccer Standings 2026'], ['/rankings', 'College Soccer Rankings 2026'], ['/teams', 'NCAA Soccer Teams 2026'], ['/', 'NCAA College Soccer Stats']] as const) {
      const r = await app.inject({ url, headers: HTML });
      expect(r.statusCode, url).toBe(200);
      expect(r.body, url).toContain(`<h1>${h1}</h1>`);
    }
    expect((await app.inject({ url: '/rankings?view=leaders', headers: HTML })).body).toContain(`<link rel="canonical" href="${BASE}/rankings" />`);
  });

  it('noindexes a player without appearances', async () => {
    const d = new FixtureSeoData();
    d.player_ = { ...d.player_, seasons: d.player_.seasons.map((s) => ({ ...s, gp: 0 })) };
    const { app: a } = makeApp(d); await a.ready();
    const r = await a.inject({ url: '/players/jane-doe-222222', headers: HTML });
    expect(r.body).toContain('<meta name="robots" content="noindex,follow" />');
    await a.close();
  });

  it('serves sitemaps, robots.txt and the verification files', async () => {
    const idx = await app.inject({ url: '/sitemap.xml' });
    expect(idx.statusCode).toBe(200);
    expect(idx.headers['content-type']).toContain('application/xml');
    expect(idx.body).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const locs = [...idx.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${BASE}/sitemaps/core.xml`, `${BASE}/sitemaps/teams.xml`, `${BASE}/sitemaps/matches-2026-1.xml`, `${BASE}/sitemaps/players-2026-1.xml`, `${BASE}/sitemaps/players-2025-1.xml`]);
    const teams = await app.inject({ url: '/sitemaps/teams.xml' });
    expect(teams.body).toContain(`<url><loc>${BASE}/teams/duke/men</loc><lastmod>2026-09-20</lastmod></url>`);
    expect((await app.inject({ url: '/sitemaps/players-2026-9.xml' })).statusCode).toBe(404);
    const robots = await app.inject({ url: '/robots.txt' });
    expect(robots.headers['content-type']).toContain('text/plain');
    expect(robots.body).toContain('Allow: /api/');
    expect(robots.body).toContain(`Sitemap: ${BASE}/sitemap.xml`);
    expect((await app.inject({ url: '/google0123abcd.html' })).body).toBe('google-site-verification: google0123abcd.html');
    expect((await app.inject({ url: '/abcdef0123456789.txt' })).body).toBe('abcdef0123456789');
    expect((await app.inject({ url: '/googleffff.html', headers: HTML })).statusCode).toBe(404);
  });

  it('still serves static files next to the rendered routes', async () => {
    const r = await app.inject({ url: '/brand/og.png' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('image/png');
  });

  it('resolves slugs for the app', async () => {
    expect((await app.inject({ url: '/api/resolve?kind=team&key=duke/men' })).json()).toEqual({ id: TEAM_ID });
    expect((await app.inject({ url: '/api/resolve?kind=player&key=jane-doe-222222' })).json()).toEqual({ id: PLAYER_ID });
    expect((await app.inject({ url: '/api/resolve?kind=match&key=nope' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/resolve?kind=bogus&key=x' })).statusCode).toBe(400);
  });

  it('falls back to the shell with 503 when the data layer fails, and does not cache it', async () => {
    const d = new FixtureSeoData();
    d.team = async () => { throw new Error('db down'); };
    const { app: a } = makeApp(d); await a.ready();
    const r = await a.inject({ url: '/teams/duke/men', headers: HTML });
    expect(r.statusCode).toBe(503);
    expect(r.headers['retry-after']).toBe('120');
    expect(r.body).toContain('<div id="root"></div>');
    await a.close();
  });

  it('applies the site rate limit to rendered pages', async () => {
    const { app: a } = makeApp(new FixtureSeoData(), { limit: (_req, reply) => { reply.code(429).send({ error: 'rate_limited' }); return false; } });
    await a.ready();
    expect((await a.inject({ url: '/teams/duke/men', headers: HTML })).statusCode).toBe(429);
    await a.close();
  });
});
