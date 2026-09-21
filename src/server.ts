// HTTP surface for Render: health, enqueue, run listing, cancel. Starts the worker loop.
import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.js';
import { getDb } from './db/client.js';
import { jobNames, workerLoop } from './jobs/runner.js';
import { registerAllJobs } from './jobs/index.js';
import { startScheduler } from './jobs/scheduler.js';
import { registerUiApi } from './ui/api.js';
import { registerPublicApi } from './api/v1.js';
import { anonPrincipal, makeAuthenticator, parseApiKeys, RateLimiter } from './api/auth.js';
import { KeyStore } from './api/keys.js';
import { UsageMeter } from './api/usage.js';
import { registerConsoleApi } from './ui/consoleApi.js';
import { evaluateHealth } from './ops/health.js';
import { heartbeats } from './ops/consoleQueries.js';
import type { WorkerHeartbeat } from './jobs/runner.js';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';

const cfg = loadConfig();
registerAllJobs();
// trustProxy: Render terminates TLS in front of us, so without it req.ip is the proxy for every caller and
// the whole free tier would share one rate-limit bucket.
const app = Fastify({ logger: false, trustProxy: true });

function authorized(header: string | undefined): boolean {
  const secret = cfg.COLLEGE_TRIGGER_SECRET;
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const got = String(header ?? '');
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// One limiter for the keyless free tier (per client IP), one for named keys and the admin secret, and a
// roomier one for the site's own reads: a single page view costs several /api calls and a whole office can
// share one address, so browsing must not run into the API's budget. It is still metered, so /api cannot be
// used to sidestep the /v1 limit.
const anonLimiter = new RateLimiter(cfg.API_ANON_RATE_LIMIT_PER_MIN);
const keyLimiter = new RateLimiter(cfg.API_RATE_LIMIT_PER_MIN);
const siteLimiter = new RateLimiter(cfg.API_ANON_RATE_LIMIT_PER_MIN * 5);

// The site's read routes are public; enqueueing work, cancelling runs and the crawl-health pages are not.
// Usage per principal (keys, admin, anon, site) for the console; flushed to the database once a minute.
const usage = new UsageMeter(cfg.SUPABASE_URL ? getDb() : null);
usage.start();
registerUiApi(app, {
  authorized,
  limitAnonymous: (req, reply) => {
    const r = siteLimiter.take(anonPrincipal(req.ip).name);
    usage.hit('site', !r.ok);
    reply.header('X-RateLimit-Limit', String(siteLimiter.max));
    reply.header('X-RateLimit-Remaining', String(r.remaining));
    if (!r.ok) { reply.header('Retry-After', String(Math.ceil(r.resetMs / 1000))); reply.code(429).send({ error: 'rate_limited', retry_after_seconds: Math.ceil(r.resetMs / 1000) }); return false; }
    return true;
  },
});

// Public read API: open to anyone at the free-tier limit, higher for named keys (env list + keys made in the console).
const apiKeys = parseApiKeys(cfg.COLLEGE_API_KEYS);
const keyStore = cfg.SUPABASE_URL ? new KeyStore(getDb()) : null;
if (keyStore) { void keyStore.load(); keyStore.start(); }
const corsOrigins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
registerPublicApi(app, {
  authenticate: makeAuthenticator({ adminSecret: cfg.COLLEGE_TRIGGER_SECRET ?? null, keys: apiKeys, lookup: keyStore ? (t) => keyStore.lookup(t) : undefined }),
  limiter: keyLimiter,
  anonLimiter,
  corsOrigins,
  publicUrl: cfg.PUBLIC_URL,
  contact: cfg.contactEmail,
  onRequest: (principal, limited) => usage.hit(principal.kind === 'anon' ? 'anon' : principal.name, limited),
});
log.info({ keys: apiKeys.map((k) => k.name), anonPerMin: cfg.API_ANON_RATE_LIMIT_PER_MIN }, 'public api keys loaded');

// The owner's console: everything behind the trigger secret.
const startedAt = Date.now();
registerConsoleApi(app, { keyStore, usage, envKeys: apiKeys.map((k) => k.name), corsOrigins, limits: { key: cfg.API_RATE_LIMIT_PER_MIN, anon: cfg.API_ANON_RATE_LIMIT_PER_MIN, site: cfg.API_ANON_RATE_LIMIT_PER_MIN * 5 }, startedAt });

// Built stats viewer (ui/dist) with SPA fallback; API and health routes are registered above it.
const uiDist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'dist');
if (existsSync(uiDist)) {
  // wildcard: true serves whatever is on disk at request time, so a UI rebuild does not need a restart.
  app.register(fastifyStatic, { root: uiDist, prefix: '/', wildcard: true });
  app.setNotFoundHandler((req, reply) => {
    // API-ish paths 404 as JSON; everything else gets index.html.
    if (req.url.startsWith('/api/') || req.url.startsWith('/v1/') || req.url.startsWith('/health')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

// Liveness for Render: the database answers and both worker lanes have beaten recently (see src/ops/health.ts).
let dbLastOkAt: number | null = null;
app.get('/health', async (_req, reply) => {
  const db = getDb();
  let dbOk = false;
  try { const { error } = await db.from('college_kv').select('key').limit(1); dbOk = !error; } catch { dbOk = false; }
  if (dbOk) dbLastOkAt = Date.now();
  const hb: Record<string, WorkerHeartbeat | null> = dbOk ? await heartbeats(db) : { crawl: null, live: null };
  const h = evaluateHealth({ now: Date.now(), startedAt, dbOk, dbLastOkAt, heartbeats: hb, lanes: ['crawl', 'live'] });
  reply.code(h.ok ? 200 : 503);
  return { ...h, jobs: jobNames().length, api: '/v1', time: new Date().toISOString() };
});

const port = cfg.PORT;
app.listen({ port, host: '0.0.0.0' }).then(() => {
  log.info({ port }, 'http listening');
  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort());
  process.on('SIGINT', () => controller.abort());
  // Two lanes: the crawl (minutes to hours per run) and the live scoreboard (seconds, every three minutes in season).
  workerLoop(getDb(), { signal: controller.signal, exclude: ['live'], lane: 'crawl' }).catch((err) => { log.error({ err: String(err) }, 'worker crashed'); process.exit(1); });
  workerLoop(getDb(), { signal: controller.signal, jobs: ['live'], idleMs: 10_000, lane: 'live' }).catch((err) => { log.error({ err: String(err) }, 'live worker crashed'); process.exit(1); });
  if (cfg.SCHEDULER_ENABLED === '1') startScheduler(getDb(), { signal: controller.signal });
}).catch((err) => { log.error({ err: String(err) }, 'listen failed'); process.exit(1); });
