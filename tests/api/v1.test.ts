// Route-level checks that need no database: the keyless free tier, keys, rate limits, CORS, validation, the spec.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerPublicApi } from '../../src/api/v1.js';
import { makeAuthenticator, parseApiKeys, RateLimiter } from '../../src/api/auth.js';

const key = '0123456789abcdef0123456789abcdef';

function makeApp(anonPerMin = 100, keyPerMin = 3) {
  // trustProxy so x-forwarded-for decides the anonymous bucket, exactly as it does behind Render.
  const app = Fastify({ trustProxy: true });
  registerPublicApi(app, {
    authenticate: makeAuthenticator({ adminSecret: 'adm', keys: parseApiKeys(`plaibook:${key}`) }),
    limiter: new RateLimiter(keyPerMin, 60_000),
    anonLimiter: new RateLimiter(anonPerMin, 60_000),
    corsOrigins: ['https://www.plaibook.soccer'],
    publicUrl: 'https://college.example',
    contact: 'hello@example.com',
  });
  return app;
}

describe('public api /v1', () => {
  let app: ReturnType<typeof Fastify>;
  beforeAll(async () => { app = makeApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('serves anonymous callers and only rejects a key that is wrong', async () => {
    // No credentials: the request reaches validation (400) instead of being turned away at the door.
    const anon = await app.inject({ method: 'GET', url: '/v1/programs' });
    expect(anon.statusCode).toBe(400);
    expect(anon.headers['x-ratelimit-limit']).toBe('100');
    expect((await app.inject({ method: 'GET', url: '/v1/programs', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/programs', headers: { 'x-api-key': 'wrong' } })).statusCode).toBe(401);
  });
  it('validates input before touching the database', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/programs', headers: { 'x-api-key': key } });
    expect(r.statusCode).toBe(400); expect(r.json().error).toBe('bad_request');
    expect((await app.inject({ method: 'GET', url: '/v1/players/not-a-uuid' })).statusCode).toBe(400);
  });
  it('rate limits per key with headers', async () => {
    // Its own app so the budget does not depend on what the other tests spent.
    const limited = makeApp(100, 2); await limited.ready();
    const call = () => limited.inject({ method: 'GET', url: '/v1/search?q=a', headers: { 'x-api-key': key } });
    expect((await call()).statusCode).toBe(400); // q too short, but it counts against the limit
    expect((await call()).statusCode).toBe(400);
    const last = await call();
    expect(last.statusCode).toBe(429);
    expect(last.headers['retry-after']).toBeTruthy();
    expect(last.headers['x-ratelimit-limit']).toBe('2');
    await limited.close();
  });
  it('serves the spec without a key and documents that no key is needed', async () => {
    const spec = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().openapi).toBe('3.1.0');
    expect(Object.keys(spec.json().paths)).toContain('/v1/standings');
    expect(spec.json().security).toContainEqual({}); // anonymous is a supported security option
  });
});

describe('/v1 free tier', () => {
  let app: ReturnType<typeof Fastify>;
  beforeAll(async () => { app = makeApp(2); await app.ready(); });
  afterAll(async () => { await app.close(); });
  const anon = (ip: string) => app.inject({ method: 'GET', url: '/v1/programs', headers: { 'x-forwarded-for': ip } });

  it('limits anonymous callers per IP, not globally', async () => {
    expect((await anon('1.1.1.1')).statusCode).toBe(400);
    expect((await anon('1.1.1.1')).statusCode).toBe(400);
    const over = await anon('1.1.1.1');
    expect(over.statusCode).toBe(429);
    expect(over.headers['retry-after']).toBeTruthy();
    expect(over.json().message).toMatch(/free tier/i);
    // A different address still has its own budget.
    expect((await anon('2.2.2.2')).statusCode).toBe(400);
  });
});

describe('/v1 CORS', () => {
  let app: ReturnType<typeof Fastify>;
  beforeAll(async () => { app = makeApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  const preflight = (origin: string, requestHeaders?: string) =>
    app.inject({ method: 'OPTIONS', url: '/v1/programs', headers: { origin, ...(requestHeaders ? { 'access-control-request-headers': requestHeaders } : {}) } });

  it('opens keyless reads to any origin', async () => {
    const r = await preflight('https://evil.example');
    expect(r.statusCode).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('*');
  });
  it('restricts credentialed calls to the configured origins', async () => {
    expect((await preflight('https://www.plaibook.soccer', 'authorization')).headers['access-control-allow-origin']).toBe('https://www.plaibook.soccer');
    expect((await preflight('https://evil.example', 'x-api-key')).headers['access-control-allow-origin']).toBeUndefined();
  });
});
