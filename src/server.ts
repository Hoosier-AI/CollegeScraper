// HTTP surface for Render: health, enqueue, run listing, cancel. Starts the worker loop.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
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
import { heartbeats, LANES } from './ops/consoleQueries.js';
import { PRO_BULK_JOBS, PRO_LANE_JOBS } from './jobs/catalogue.js';
import type { WorkerHeartbeat } from './jobs/runner.js';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';
import { registerSeo } from './seo/routes.js';
import { DbSeoData } from './seo/data.js';
import { DbProSeoData } from './seo/pro/data.js';
import { fileTemplate } from './seo/template.js';
import { BotVerifier } from './seo/bots.js';
import { DEFAULT_PUBLIC_URL } from './seo/util.js';
import { AiBotCounter, canonicalRedirect } from './seo/aiBots.js';

const cfg = loadConfig();
registerAllJobs();
// trustProxy: Render terminates TLS in front of us, so without it req.ip is the proxy for every caller and
// the whole free tier would share one rate-limit bucket.
const app = Fastify({ logger: false, trustProxy: true });

// Old onrender.com page URLs move to the Stats domain (301) once PUBLIC_URL is set to it.
// AI crawler visits are counted for the hub's SEO dashboard.
const aiBots = new AiBotCounter({ url: cfg.SEO_BOT_URL ?? null, secret: cfg.SEO_BOT_SECRET ?? null, onError: (msg) => log.warn({ msg }, 'ai bot counts not sent') });
aiBots.start();
app.addHook('onRequest', async (req, reply) => {
  const to = canonicalRedirect(cfg.PUBLIC_URL, req.headers.host, req.url);
  if (to) return reply.code(301).header('location', to).send();
  aiBots.hit(req.headers['user-agent']);
});

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
// Googlebot and Bingbot, proven by reverse + forward DNS, are not held to the site limit (sitemap crawls).
const bots = new BotVerifier();
const limitSite = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
  if (await bots.isVerified(req.ip, req.headers['user-agent'])) { usage.hit('site', false); return true; }
  const r = siteLimiter.take(anonPrincipal(req.ip).name);
  usage.hit('site', !r.ok);
  reply.header('X-RateLimit-Limit', String(siteLimiter.max));
  reply.header('X-RateLimit-Remaining', String(r.remaining));
  if (!r.ok) { reply.header('Retry-After', String(Math.ceil(r.resetMs / 1000))); reply.code(429).send({ error: 'rate_limited', retry_after_seconds: Math.ceil(r.resetMs / 1000) }); return false; }
  return true;
};

// The site's read routes are public; enqueueing work, cancelling runs and the crawl-health pages are not.
// Usage per principal (keys, admin, anon, site) for the console; flushed to the database once a minute.
const usage = new UsageMeter(cfg.SUPABASE_URL ? getDb() : null);
usage.start();
registerUiApi(app, { authorized, limitAnonymous: limitSite });

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

// Server-rendered public pages (titles, canonicals, JSON-LD, a text summary), slug redirects, sitemaps, robots.txt
// and real 404s. Registered before the static files so its specific routes win over the static wildcard.
const uiDist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'dist');
const seo = cfg.SUPABASE_URL ? registerSeo(app, {
  data: new DbSeoData(getDb()),
  template: fileTemplate(resolve(uiDist, 'index.html')),
  baseUrl: cfg.PUBLIC_URL ?? DEFAULT_PUBLIC_URL,
  limit: limitSite,
  gscVerificationFile: cfg.GSC_VERIFICATION_FILE ?? null,
  indexNowKey: cfg.INDEXNOW_KEY ?? null,
  pro: new DbProSeoData(getDb()),
  log,
}) : null;

// Built stats viewer (ui/dist); API and health routes are registered above it.
if (existsSync(uiDist)) {
  // wildcard: true serves whatever is on disk at request time, so a UI rebuild does not need a restart.
  app.register(fastifyStatic, { root: uiDist, prefix: '/', wildcard: true });
}
app.setNotFoundHandler((req, reply) => {
  if (seo) return seo.notFound(req, reply);
  if (req.url.startsWith('/api/') || req.url.startsWith('/v1/') || req.url.startsWith('/health') || !existsSync(uiDist)) return reply.code(404).send({ error: 'not found' });
  return reply.sendFile('index.html');
});

// Liveness for Render: the database answers and both worker lanes have beaten recently (see src/ops/health.ts).
let dbLastOkAt: number | null = null;
app.get('/health', async (_req, reply) => {
  const db = getDb();
  let dbOk = false;
  try { const { error } = await db.from('college_kv').select('key').limit(1); dbOk = !error; } catch { dbOk = false; }
  if (dbOk) dbLastOkAt = Date.now();
  const hb: Record<string, WorkerHeartbeat | null> = dbOk ? await heartbeats(db) : Object.fromEntries(LANES.map((l) => [l, null]));
  const h = evaluateHealth({ now: Date.now(), startedAt, dbOk, dbLastOkAt, heartbeats: hb, lanes: LANES });
  reply.code(h.ok ? 200 : 503);
  return { ...h, jobs: jobNames().length, api: '/v1', time: new Date().toISOString() };
});

const port = cfg.PORT;
app.listen({ port, host: '0.0.0.0' }).then(() => {
  log.info({ port }, 'http listening');
  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort());
  process.on('SIGINT', () => controller.abort());
  // Three lanes: the crawl (minutes to hours per run), the live scoreboard (seconds, every minute in game hours) and short side jobs.
  if (cfg.WORKERS_ENABLED !== '0') {
  workerLoop(getDb(), { signal: controller.signal, exclude: ['live', 'weather', 'h2h-detail', 'final-detail', ...PRO_LANE_JOBS, ...PRO_BULK_JOBS], lane: 'crawl' }).catch((err) => { log.error({ err: String(err) }, 'worker crashed'); process.exit(1); });
  workerLoop(getDb(), { signal: controller.signal, jobs: ['live'], idleMs: 10_000, lane: 'live' }).catch((err) => { log.error({ err: String(err) }, 'live worker crashed'); process.exit(1); });
  // A third lane for short side jobs (weather) so they never wait hours behind the nightly crawl.
  workerLoop(getDb(), { signal: controller.signal, jobs: ['final-detail', 'weather', 'h2h-detail'], idleMs: 15_000, lane: 'aux' }).catch((err) => { log.error({ err: String(err) }, 'aux worker crashed'); process.exit(1); });
  // A fourth for Plaibook Stats Pro's everyday jobs (scores, detail, tables): seconds each, all year, never behind a college crawl.
  workerLoop(getDb(), { signal: controller.signal, jobs: PRO_LANE_JOBS, idleMs: 10_000, lane: 'pro' }).catch((err) => { log.error({ err: String(err) }, 'pro worker crashed'); process.exit(1); });
  // A fifth for the pro bulk crawl (minutes per run): never behind the college crawl, never in front of live pro scores.
  workerLoop(getDb(), { signal: controller.signal, jobs: PRO_BULK_JOBS, idleMs: 15_000, lane: 'pro-bulk' }).catch((err) => { log.error({ err: String(err) }, 'pro-bulk worker crashed'); process.exit(1); });
  }
  if (cfg.SCHEDULER_ENABLED === '1') startScheduler(getDb(), { signal: controller.signal });
}).catch((err) => { log.error({ err: String(err) }, 'listen failed'); process.exit(1); });
