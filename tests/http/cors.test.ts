// Cross-origin access for the phone app (src/http/cors.ts) and the universal-links file (src/http/appLinks.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerCors, APP_ORIGIN, DEV_ORIGIN } from '../../src/http/cors.js';
import { registerAppLinks, appleAppSiteAssociation, APP_ID } from '../../src/http/appLinks.js';

/** The same shape as the server: cors first, then a gate that refuses every non-GET /api request (src/ui/api.ts). */
async function build(production: boolean): Promise<FastifyInstance> {
  const app = Fastify();
  registerCors(app, { production });
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/') && req.method !== 'GET') return reply.code(401).send({ error: 'unauthorized' });
  });
  app.get('/api/x', async () => ({ ok: true }));
  app.post('/api/x', async () => ({ ok: true }));
  app.get('/api/boom', async () => { throw new Error('boom'); });
  app.get('/card/*', async (_req, reply) => reply.type('image/png').send(Buffer.from('png')));
  app.get('/og/*', async (_req, reply) => reply.type('image/png').send(Buffer.from('png')));
  app.get('/teams', async () => 'page');
  registerAppLinks(app);
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not found' }));
  await app.ready();
  return app;
}

describe('cors for the phone app', () => {
  let prod: FastifyInstance, dev: FastifyInstance;
  beforeAll(async () => { prod = await build(true); dev = await build(false); });
  afterAll(async () => { await prod.close(); await dev.close(); });

  it('echoes the app origin on /api reads', async () => {
    const r = await prod.inject({ method: 'GET', url: '/api/x', headers: { origin: APP_ORIGIN } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe('capacitor://localhost');
    expect(String(r.headers.vary)).toMatch(/origin/i);
    expect(r.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
    expect(r.headers['access-control-allow-headers']).toBe('Content-Type, Authorization');
  });

  it('gives another origin no allow header', async () => {
    for (const origin of ['https://evil.example', 'capacitor://localhost.evil.example', 'http://localhost', 'null', 'https://www.plaibook.live']) {
      const r = await prod.inject({ method: 'GET', url: '/api/x', headers: { origin } });
      expect(r.statusCode).toBe(200);
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
      // Still varies by origin, so a shared cache never hands this copy to the app.
      expect(String(r.headers.vary)).toMatch(/origin/i);
    }
    const none = await prod.inject({ method: 'GET', url: '/api/x' });
    expect(none.statusCode).toBe(200);
    expect(none.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows the UI dev server outside production only', async () => {
    expect((await dev.inject({ method: 'GET', url: '/api/x', headers: { origin: DEV_ORIGIN } })).headers['access-control-allow-origin']).toBe('http://localhost:5174');
    expect((await dev.inject({ method: 'GET', url: '/api/x', headers: { origin: APP_ORIGIN } })).headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect((await prod.inject({ method: 'GET', url: '/api/x', headers: { origin: DEV_ORIGIN } })).headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight with 204 before the auth check', async () => {
    const r = await prod.inject({ method: 'OPTIONS', url: '/api/x', headers: { origin: APP_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe('');
    expect(r.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect(r.headers['access-control-max-age']).toBe('600');
    expect(r.headers['access-control-allow-methods']).toContain('POST');
    // A path with no route at all (and a query string) is answered the same way.
    const other = await prod.inject({ method: 'OPTIONS', url: '/api/requests?x=1', headers: { origin: APP_ORIGIN, 'access-control-request-method': 'POST' } });
    expect(other.statusCode).toBe(204);
    // A preflight from elsewhere gets no permission.
    const evil = await prod.inject({ method: 'OPTIONS', url: '/api/x', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('leaves the auth check in place for the real request, with the headers on the refusal', async () => {
    const r = await prod.inject({ method: 'POST', url: '/api/x', headers: { origin: APP_ORIGIN } });
    expect(r.statusCode).toBe(401);
    expect(r.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    const boom = await prod.inject({ method: 'GET', url: '/api/boom', headers: { origin: APP_ORIGIN } });
    expect(boom.statusCode).toBe(500);
    expect(boom.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
  });

  it('opens the picture routes to every origin', async () => {
    for (const url of ['/card/players/x.png', '/og/teams/x.png']) {
      for (const headers of [{ origin: APP_ORIGIN }, { origin: 'https://evil.example' }, {}]) {
        const r = await prod.inject({ method: 'GET', url, headers });
        expect(r.statusCode).toBe(200);
        expect(r.headers['access-control-allow-origin']).toBe('*');
      }
    }
  });

  it('adds nothing to pages', async () => {
    const r = await prod.inject({ method: 'GET', url: '/teams', headers: { origin: APP_ORIGIN } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(r.headers.vary).toBeUndefined();
    // OPTIONS outside /api is not answered here.
    expect((await prod.inject({ method: 'OPTIONS', url: '/teams', headers: { origin: APP_ORIGIN } })).statusCode).toBe(404);
  });
});

describe('apple-app-site-association', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await build(true); });
  afterAll(async () => { await app.close(); });

  it('is served as JSON, directly, cacheable for an hour', async () => {
    const r = await app.inject({ method: 'GET', url: '/.well-known/apple-app-site-association' });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['content-type'])).toMatch(/^application\/json/);
    expect(r.headers['cache-control']).toBe('public, max-age=3600');
    expect(r.headers.location).toBeUndefined();
    expect(r.json()).toEqual(appleAppSiteAssociation());
  });

  it('names the app and opens its pages, never the API, pictures or console', () => {
    const { details } = appleAppSiteAssociation().applinks;
    expect(details).toHaveLength(1);
    expect(details[0]!.appIDs).toEqual(['NSYYJ2GK7A.live.plaibook.app']);
    expect(APP_ID).toBe('NSYYJ2GK7A.live.plaibook.app');
    const comps = details[0]!.components as { '/': string; exclude?: boolean }[];
    const included = comps.filter((c) => !c.exclude).map((c) => c['/']);
    const excluded = comps.filter((c) => c.exclude).map((c) => c['/']);
    expect(included).toEqual(['/matches/*', '/teams/*', '/players/*', '/conferences/*', '/pro/*', '/intl/*', '/tournament', '/following']);
    expect(excluded).toEqual(['/api/*', '/card/*', '/og/*', '/admin*', '/console*']);
    // The first match wins: every exclusion sits before the first inclusion.
    const firstIncluded = comps.findIndex((c) => !c.exclude);
    expect(comps.slice(firstIncluded).every((c) => !c.exclude)).toBe(true);
  });
});
