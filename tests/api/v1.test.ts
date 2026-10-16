// Route-level checks that need no database: Plaibook-only access (named keys and the admin secret, no keyless tier, no
// browser access), rate limits per key, validation, the private spec.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerPublicApi } from '../../src/api/v1.js';
import { makeAuthenticator, parseApiKeys, RateLimiter } from '../../src/api/auth.js';

const key = '0123456789abcdef0123456789abcdef';

function makeApp(keyPerMin = 100) {
  const app = Fastify({ trustProxy: true });
  registerPublicApi(app, {
    authenticate: makeAuthenticator({ adminSecret: 'adm', keys: parseApiKeys(`plaibook:${key}`) }),
    limiter: new RateLimiter(keyPerMin, 60_000),
    publicUrl: 'https://college.example',
  });
  return app;
}

describe('/v1 is Plaibook-only', () => {
  let app: ReturnType<typeof Fastify>;
  beforeAll(async () => { app = makeApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('refuses callers without a key, and wrong keys', async () => {
    const anon = await app.inject({ method: 'GET', url: '/v1/programs' });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error).toBe('unauthorized');
    expect((await app.inject({ method: 'GET', url: '/v1/search?q=duke', headers: { 'x-forwarded-for': '1.1.1.1' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/programs', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/programs', headers: { 'x-api-key': 'wrong' } })).statusCode).toBe(401);
  });
  it('lets a named key and the admin secret through to validation', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/programs', headers: { 'x-api-key': key } });
    expect(r.statusCode).toBe(400); expect(r.json().error).toBe('bad_request');
    expect((await app.inject({ method: 'GET', url: '/v1/players/not-a-uuid', headers: { authorization: `Bearer ${key}` } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/programs', headers: { authorization: 'Bearer adm' } })).statusCode).toBe(400);
  });
  it('refuses a conference filter that is not an id', async () => {
    for (const path of ['/v1/programs', '/v1/leaders', '/v1/standings']) {
      const r = await app.inject({ method: 'GET', url: `${path}?season=2026&conference=acc`, headers: { 'x-api-key': key } });
      expect(r.statusCode).toBe(400);
    }
  });
  it('is not callable from a browser: no preflight, no CORS headers', async () => {
    const pre = await app.inject({ method: 'OPTIONS', url: '/v1/programs', headers: { origin: 'https://www.plaibook.soccer', 'access-control-request-headers': 'x-api-key' } });
    expect(pre.statusCode).toBe(405);
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    const keyed = await app.inject({ method: 'GET', url: '/v1/programs', headers: { origin: 'https://www.plaibook.soccer', 'x-api-key': key } });
    expect(keyed.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('serves the spec to key holders only, and it documents a required key and /v1/site', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/openapi.json' })).statusCode).toBe(401);
    const spec = await app.inject({ method: 'GET', url: '/v1/openapi.json', headers: { 'x-api-key': key } });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().openapi).toBe('3.1.0');
    expect(Object.keys(spec.json().paths)).toEqual(expect.arrayContaining(['/v1/standings', '/v1/site/{path}']));
    expect(spec.json().security).not.toContainEqual({});
    expect(spec.json().info.description).toMatch(/Private to Plaibook/);
  });
});

describe('/v1 rate limits per key', () => {
  it('counts every request against the key, with headers', async () => {
    const app = makeApp(2); await app.ready();
    const call = () => app.inject({ method: 'GET', url: '/v1/search?q=a', headers: { 'x-api-key': key } });
    expect((await call()).statusCode).toBe(400); // q too short, but it counts against the limit
    expect((await call()).statusCode).toBe(400);
    const last = await call();
    expect(last.statusCode).toBe(429);
    expect(last.headers['retry-after']).toBeTruthy();
    expect(last.headers['x-ratelimit-limit']).toBe('2');
    await app.close();
  });
});
