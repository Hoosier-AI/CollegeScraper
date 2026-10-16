// Plaibook gets everything the site shows: every GET /api route is either in the Plaibook client's SITE_ROUTES
// (docs/plaibook-client.mjs, copied into Plaibook) or deliberately excluded (src/api/siteMirror.ts SITE_EXCLUDED).
// A new site route fails here until it is classified; Plaibook's client-sync test then fails until it copies the file.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { registerUiApi } from '../../src/ui/api.js';
import { registerLegalApi } from '../../src/legal/routes.js';
import { registerSeo } from '../../src/seo/routes.js';
import { stringTemplate } from '../../src/seo/template.js';
import { registerPublicApi } from '../../src/api/v1.js';
import { makeAuthenticator, parseApiKeys, RateLimiter } from '../../src/api/auth.js';
import { collectSiteRoutes, excluded, matchRoute, registerSiteMirror, SITE_EXCLUDED } from '../../src/api/siteMirror.js';
import { FixtureSeoData } from '../helpers/seoFixtures.js';
// @ts-expect-error plain ESM client without types
import { SITE_ROUTES, matchSiteRoute } from '../../docs/plaibook-client.mjs';

const shell = readFileSync(new URL('../../ui/index.html', import.meta.url), 'utf8');
const key = '0123456789abcdef0123456789abcdef';

describe('site parity: every site read reaches Plaibook', () => {
  let app: FastifyInstance; let routes: string[];
  beforeAll(async () => {
    app = Fastify();
    routes = collectSiteRoutes(app);
    registerUiApi(app, { authorized: () => false });
    registerLegalApi(app, { salt: 'x' });
    registerSeo(app, { data: new FixtureSeoData(), template: stringTemplate(shell), baseUrl: 'https://www.plaibook.live' });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('found the site routes', () => {
    expect(routes.length).toBeGreaterThan(80);
    expect(routes).toContain('/api/resolve');
    expect(routes).toContain('/api/pro/players/:slug');
  });
  it('classifies every GET /api route: in SITE_ROUTES or excluded', () => {
    const listed = new Set((SITE_ROUTES as Array<{ path: string }>).map((r) => r.path));
    const missing = routes.filter((r) => !listed.has(r) && !excluded(r));
    expect(missing, `site routes Plaibook cannot read; add them to SITE_ROUTES in docs/plaibook-client.mjs (and copy it to Plaibook) or to SITE_EXCLUDED: ${missing.join(', ')}`).toEqual([]);
  });
  it('lists no route the site does not have, and none that is excluded', () => {
    const stale = (SITE_ROUTES as Array<{ path: string }>).map((r) => r.path).filter((p) => !routes.includes(p));
    expect(stale, `SITE_ROUTES entries with no site route: ${stale.join(', ')}`).toEqual([]);
    expect((SITE_ROUTES as Array<{ path: string }>).filter((r) => excluded(r.path))).toEqual([]);
  });
  it('gives every route an area and a gender rule', () => {
    for (const r of SITE_ROUTES as Array<{ path: string; area: string; gender: string }>) {
      expect(['college', 'pro', 'intl', 'news']).toContain(r.area);
      expect(r.gender).toMatch(/^(none|query|path:[a-z]+|program:[a-z]+|result:[a-z0-9_.|]+)$/);
      if (r.gender.startsWith('path:')) expect(r.path).toContain(`:${r.gender.slice(5)}`);
    }
  });
  it('matches concrete paths the same way on both sides', () => {
    const cases = ['/api/programs/9b8e1f0e-0000-4000-8000-000000000000/elo', '/api/pro/compare/teams', '/api/pro/leagues/253/table', '/api/pro/leagues/major-league-soccer', '/api/teams/x/calendar.ics', '/api/intl/teams/usa/history'];
    for (const p of cases) expect(matchSiteRoute(p)?.path).toBe(matchRoute(routes.filter((r) => !excluded(r)), p));
  });
  it('excludes only admin and non-data routes', () => {
    for (const x of SITE_EXCLUDED) expect(x.why).toBeTruthy();
    expect(excluded('/api/console/pro')).toBe(true);
    expect(excluded('/api/runs')).toBe(true);
    expect(excluded('/api/runs/1')).toBe(true);
    expect(excluded('/api/legal/terms')).toBe(true);
    expect(excluded('/api/rankings')).toBe(false);
    expect(excluded('/api/transfers')).toBe(false);
    expect(excluded('/api/team-of-the-week')).toBe(false);
  });
});

describe('/v1/site mirror', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    const routes = collectSiteRoutes(app);
    let mirror: ReturnType<typeof registerSiteMirror> | null = null;
    // A per-visitor limit that refuses everyone: the mirror's inner request must not be held to it.
    registerUiApi(app, { authorized: () => false, limitAnonymous: (_req, reply) => { reply.code(429).send({ error: 'rate_limited' }); return false; }, internal: (req) => mirror?.internal(req) ?? false });
    registerPublicApi(app, {
      authenticate: makeAuthenticator({ adminSecret: 'adm', keys: parseApiKeys(`plaibook:${key}`) }),
      limiter: new RateLimiter(100), anonLimiter: new RateLimiter(100), corsOrigins: [],
    });
    mirror = registerSiteMirror(app, routes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  const get = (url: string, headers: Record<string, string> = { 'x-api-key': key }) => app.inject({ method: 'GET', url, headers });

  it('needs a key', async () => {
    expect((await get('/v1/site/h2h', {})).statusCode).toBe(401);
    expect((await get('/v1/site/h2h', { 'x-api-key': 'nope' })).statusCode).toBe(401);
  });
  it("runs the site's route and returns its answer, past the per-visitor limit", async () => {
    expect((await get('/api/h2h')).statusCode).toBe(429);
    const r = await get('/v1/site/h2h');
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/two program ids/);
    expect(r.headers['x-stats-route']).toBe('/api/h2h');
    const t = await get('/v1/site/pro/compare/teams?a=Bad!&b=x');
    expect(t.statusCode).toBe(400);
    expect(t.headers['x-stats-route']).toBe('/api/pro/compare/teams');
  });
  it('refuses admin, unknown and malformed paths', async () => {
    expect((await get('/v1/site/console/pro')).statusCode).toBe(404);
    expect((await get('/v1/site/runs')).statusCode).toBe(404);
    expect((await get('/v1/site/quality?season=2025')).statusCode).toBe(404);
    expect((await get('/v1/site/nope/nothing')).statusCode).toBe(404);
    expect([400, 404]).toContain((await get('/v1/site/../console/pro')).statusCode);
  });
  it('a forged internal header does not skip the limit', async () => {
    expect((await get('/api/h2h', { 'x-stats-internal': '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(429);
  });
});
