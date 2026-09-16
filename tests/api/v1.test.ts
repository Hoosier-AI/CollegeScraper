// Route-level checks that need no database: auth, rate limit, CORS, validation, the OpenAPI document.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerPublicApi } from '../../src/api/v1.js';
import { makeAuthenticator, parseApiKeys, RateLimiter } from '../../src/api/auth.js';

describe('public api /v1', () => {
  let app: ReturnType<typeof Fastify>;
  const key = '0123456789abcdef0123456789abcdef';
  beforeAll(async () => {
    app = Fastify();
    registerPublicApi(app, { authenticate: makeAuthenticator({ adminSecret: 'adm', keys: parseApiKeys(`plaibook:${key}`) }), limiter: new RateLimiter(3, 60_000), corsOrigins: ['https://www.plaibook.soccer'], publicUrl: 'https://college.example' });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('rejects requests without a valid key', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/programs?season=2026' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/programs?season=2026', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
  });
  it('validates input before touching the database', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/programs', headers: { 'x-api-key': key } });
    expect(r.statusCode).toBe(400); expect(r.json().error).toBe('bad_request');
    expect((await app.inject({ method: 'GET', url: '/v1/players/not-a-uuid', headers: { 'x-api-key': key } })).statusCode).toBe(400);
  });
  it('rate limits per key with headers', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/search?q=a', headers: { 'x-api-key': key } });
    expect(r.statusCode).toBe(400); // q too short, but it counts
    const last = await app.inject({ method: 'GET', url: '/v1/search?q=a', headers: { 'x-api-key': key } });
    expect(last.statusCode).toBe(429); expect(last.headers['retry-after']).toBeTruthy();
  });
  it('answers CORS preflight for an allowed origin and serves the spec without a key', async () => {
    const pre = await app.inject({ method: 'OPTIONS', url: '/v1/programs', headers: { origin: 'https://www.plaibook.soccer' } });
    expect(pre.statusCode).toBe(204); expect(pre.headers['access-control-allow-origin']).toBe('https://www.plaibook.soccer');
    const other = await app.inject({ method: 'OPTIONS', url: '/v1/programs', headers: { origin: 'https://evil.example' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    const spec = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(spec.statusCode).toBe(200); expect(spec.json().openapi).toBe('3.1.0'); expect(Object.keys(spec.json().paths)).toContain('/v1/standings');
  });
});
