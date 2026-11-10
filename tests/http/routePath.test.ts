// A gate must judge the route a request was matched to, not the text of its URL.
// The router percent-decodes a path before matching: `/api/%63onsole/requests` runs the `/api/console/requests`
// handler, and `/%61pi/jobs/enqueue` runs `/api/jobs/enqueue`. Gates that tested the raw text let both through
// with no secret (admin reads, and admin writes: enqueue a job, change deploy settings).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { decodedPath, hasDisguisedPath, routedPath } from '../../src/http/routePath.js';

describe('routePath helpers', () => {
  it('decodes a pathname and leaves the query alone', () => {
    expect(decodedPath('/api/%63onsole/requests?x=%41')).toBe('/api/console/requests');
    expect(decodedPath('/api/search?q=a%20b')).toBe('/api/search');
    expect(decodedPath('/api/%E0%A4%A')).toBe('/api/%E0%A4%A'); // malformed: the raw text
  });
  it('spots a path that encodes a character that never needs it', () => {
    for (const p of ['/api/%63onsole/requests', '/%61pi/jobs/enqueue', '/v%31/meta', '/%761/meta', '/api/%71uality', '/og/players/sl%75g.png', '/api/runs%2Dx', '/api/a%7Eb'])
      expect(hasDisguisedPath(p), p).toBe(true);
    for (const p of ['/api/console/requests', '/api/search?q=%63', '/api/players/jos%C3%A9', '/teams/a%20b', '/api/x%2Fy', '/', ''])
      expect(hasDisguisedPath(p), p).toBe(false);
  });
});

describe('gates on a real router', () => {
  let app: FastifyInstance;
  const SECRET = 'Bearer s3cret';
  beforeAll(async () => {
    app = Fastify();
    // The two hooks as the service registers them: the disguise refusal first, then a gate on the matched route.
    app.addHook('onRequest', async (req, reply) => { if (hasDisguisedPath(req.url)) return reply.code(400).send({ error: 'bad request' }); });
    app.addHook('onRequest', async (req, reply) => {
      const path = routedPath(req);
      if (!path.startsWith('/api/')) return;
      const admin = req.method !== 'GET' || path.startsWith('/api/console') || /^\/api\/runs(\/|$)/.test(path);
      if (admin && req.headers.authorization !== SECRET) return reply.code(401).send({ error: 'unauthorized' });
    });
    app.get('/api/console/requests', async () => ({ emails: ['a@example.com'] }));
    app.get('/api/runs/:id', async () => ({ run: true }));
    app.post('/api/jobs/enqueue', async () => ({ queued: true }));
    app.get('/api/programs', async () => ({ ok: true }));
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  const hit = (method: 'GET' | 'POST', url: string, auth?: string) => app.inject({ method, url, headers: auth ? { authorization: auth } : {} });

  it('plain admin paths need the secret', async () => {
    expect((await hit('GET', '/api/console/requests')).statusCode).toBe(401);
    expect((await hit('POST', '/api/jobs/enqueue')).statusCode).toBe(401);
    expect((await hit('GET', '/api/runs/abc')).statusCode).toBe(401);
    expect((await hit('GET', '/api/console/requests', SECRET)).statusCode).toBe(200);
    expect((await hit('GET', '/api/programs')).statusCode).toBe(200);
  });

  it('an encoded letter no longer walks past the gate', async () => {
    for (const [m, u] of [['GET', '/api/%63onsole/requests'], ['GET', '/%61pi/console/requests'], ['POST', '/%61pi/jobs/enqueue'], ['GET', '/api/%72uns/abc']] as const) {
      const r = await hit(m, u);
      expect(r.statusCode, u).toBe(400);
      expect(r.body, u).not.toContain('emails');
    }
  });

  it('the gate holds on its own, without the disguise refusal', async () => {
    const bare = Fastify();
    bare.addHook('onRequest', async (req, reply) => {
      const path = routedPath(req);
      if (path.startsWith('/api/') && (req.method !== 'GET' || path.startsWith('/api/console')) && req.headers.authorization !== SECRET) return reply.code(401).send({});
    });
    bare.get('/api/console/requests', async () => ({ emails: ['a@example.com'] }));
    bare.post('/api/jobs/enqueue', async () => ({ queued: true }));
    await bare.ready();
    expect((await bare.inject({ method: 'GET', url: '/api/%63onsole/requests' })).statusCode).toBe(401);
    expect((await bare.inject({ method: 'GET', url: '/%61pi/console/requests' })).statusCode).toBe(401);
    expect((await bare.inject({ method: 'POST', url: '/%61pi/jobs/enqueue' })).statusCode).toBe(401);
    await bare.close();
  });
});
