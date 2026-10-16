// HTTP surface for Render: health, enqueue, run listing, cancel. Starts the worker loop.
import { registerLegalApi } from './legal/routes.js';
import { adsTxt, ADS_OFF, buildCsp } from './money/config.js';
import { adsSettings } from './ops/settings.js';
import { makeExtraSeo } from './seo/extra.js';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.js';
import { getDb } from './db/client.js';
import { jobNames, workerLoop } from './jobs/runner.js';
import { registerAllJobs } from './jobs/index.js';
import { startScheduler } from './jobs/scheduler.js';
import { flushRequests, startRequestFlush } from './ops/sourceRequests.js';
import { CHECK_JOBS } from './pro/crawlSites.js';
import { registerUiApi } from './ui/api.js';
import { registerPublicApi } from './api/v1.js';
import { collectSiteRoutes, registerSiteMirror } from './api/siteMirror.js';
import { anonPrincipal, makeAuthenticator, parseApiKeys, RateLimiter } from './api/auth.js';
import { KeyStore } from './api/keys.js';
import { UsageMeter } from './api/usage.js';
import { AnalyticsMeter } from './api/analytics.js';
import { isBot } from './pro/onView.js';
import { registerConsoleApi } from './ui/consoleApi.js';
import { evaluateHealth } from './ops/health.js';
import { heartbeats, LANES } from './ops/consoleQueries.js';
import { AUX_JOBS, PRO_BULK_JOBS, PRO_LANE_JOBS, SOURCE_JOBS } from './jobs/catalogue.js';
import { runningJobs, type WorkerHeartbeat } from './jobs/runner.js';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { PerformanceObserver } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';
import { registerSeo } from './seo/routes.js';
import { DbSeoData } from './seo/data.js';
import { DbProSeoData } from './seo/pro/data.js';
import { DbIntlSeoData } from './seo/intl/data.js';
import { feed as newsFeed } from './news/queries.js';
import { fileTemplate } from './seo/template.js';
import { BotVerifier } from './seo/bots.js';
import { DEFAULT_PUBLIC_URL } from './seo/util.js';
import { AiBotCounter, canonicalRedirect } from './seo/aiBots.js';

const cfg = loadConfig();
registerAllJobs();
// trustProxy: Render terminates TLS in front of us, so without it req.ip is the proxy for every caller and
// the whole free tier would share one rate-limit bucket. A request gets 60 s (the slowest console reads take 25).
const app = Fastify({ logger: false, trustProxy: true, requestTimeout: 60_000, bodyLimit: 256 * 1024 });
// Every GET /api route, as registered below, for Plaibook's mirror of the site (/v1/site, src/api/siteMirror.ts).
const siteRoutes = collectSiteRoutes(app);

// The visitor's real address. Every request reaches us through Render's Cloudflare edge, which sets
// CF-Connecting-IP and refuses a request that brings its own (403, checked 2026-10-15). X-Forwarded-For alone is not
// safe: its first entry is whatever the caller sent, and a forged one gave a fresh rate-limit bucket. req.ip reads
// X-Forwarded-For, so the edge's value goes there, before any limiter runs.
app.addHook('onRequest', async (req) => {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) req.headers['x-forwarded-for'] = cf;
});

// Security headers on every response. The page loads only its own scripts, styles and fonts; pictures come from
// school, league and provider sites (https). No page may be framed.
const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
};
// The page's Content-Security-Policy: our own scripts only, plus Google's ad hosts while ads are on (src/money/config.ts).
// A failed settings read keeps the strict policy.
const adsOn = async () => { try { return (await adsSettings(getDb())).enabled; } catch { return false; } };
app.addHook('onSend', async (_req, reply, payload) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!reply.hasHeader(k)) reply.header(k, v);
  if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', buildCsp(await adsOn()));
  return payload;
});

// ads.txt: names the site's one ad seller (Google AdSense) once a publisher id is set; 404 until then.
app.get('/ads.txt', async (_req, reply) => {
  const body = adsTxt(await adsSettings(getDb()).catch(() => ADS_OFF));
  if (!body) return reply.code(404).type('text/plain').send('not found');
  return reply.header('cache-control', 'public, max-age=3600').type('text/plain; charset=utf-8').send(body);
});

// Errors: logged with the route; a visitor sees a plain message, never a database error or a stack.
app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  if (status >= 500) log.error({ err: String(err), url: req.url, method: req.method }, 'request failed');
  reply.code(status).send(status >= 500 ? { error: 'Something went wrong on our side. Please try again.' } : { error: err.message });
});
process.on('unhandledRejection', (err) => log.error({ err: String(err) }, 'unhandled rejection'));
process.on('uncaughtException', (err) => { log.error({ err: String(err), stack: err.stack }, 'uncaught exception'); process.exit(1); });

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
// The mirror is registered after /v1's key check (below); its inner requests skip the per-visitor limit.
let siteMirror: ReturnType<typeof registerSiteMirror> | null = null;
registerUiApi(app, { authorized, limitAnonymous: limitSite, internal: (req) => siteMirror?.internal(req) ?? false });
// Policy pages and the corrections / removal form (src/legal).
registerLegalApi(app, { salt: cfg.COLLEGE_TRIGGER_SECRET ?? cfg.SUPABASE_URL ?? 'plaibook-stats' });

// Cookie-free site analytics (src/api/analytics.ts): the viewer's beacon on every page change and settled search.
// Bots are not counted; the viewer itself skips the owner (an admin token in the browser).
const ownHosts = ['plaibook.live', 'onrender.com', 'localhost', ...(cfg.PUBLIC_URL ? [new URL(cfg.PUBLIC_URL).hostname.replace(/^www\./, '')] : [])];
const analytics = new AnalyticsMeter(cfg.SUPABASE_URL ? getDb() : null, ownHosts);
analytics.start();
const beaconLimiter = new RateLimiter(120);
app.post('/api/t', async (req, reply) => {
  const ua = req.headers['user-agent'];
  if (isBot(ua) || !beaconLimiter.take(anonPrincipal(req.ip).name).ok) return reply.code(204).send();
  let b: any = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  if (b && b.t === 'view') analytics.view({ path: String(b.path ?? ''), ref: typeof b.ref === 'string' ? b.ref : null, ua, ip: req.ip });
  else if (b && b.t === 'search' && (b.scope === 'pro' || b.scope === 'college' || b.scope === 'all')) analytics.search(b.scope, String(b.q ?? ''), Number(b.n) || 0);
  return reply.code(204).send();
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
// Plaibook's mirror of every site read (/v1/site/*): behind /v1's key check and limit.
siteMirror = registerSiteMirror(app, siteRoutes);

// The owner's console: everything behind the trigger secret.
const startedAt = Date.now();
registerConsoleApi(app, { keyStore, usage, analytics, envKeys: apiKeys.map((k) => k.name), corsOrigins, limits: { key: cfg.API_RATE_LIMIT_PER_MIN, anon: cfg.API_ANON_RATE_LIMIT_PER_MIN, site: cfg.API_ANON_RATE_LIMIT_PER_MIN * 5 }, startedAt });

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
  intl: new DbIntlSeoData(getDb()),
  news: (area) => newsFeed(getDb(), { scope: area, limit: 40 }),
  extra: makeExtraSeo(getDb()),
  log,
}) : null;

// Built stats viewer (ui/dist); API and health routes are registered above it.
if (existsSync(uiDist)) {
  // wildcard: true serves whatever is on disk at request time, so a UI rebuild does not need a restart.
  // Vite's /assets files carry a content hash in their name, so they never change: a year in the browser and at
  // Cloudflare's edge (max-age=0 had every page view re-ask the server for every script).
  // (An onSend hook: @fastify/static's own max-age=0 header is written after its setHeaders option.)
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/assets/') && reply.statusCode === 200) reply.header('cache-control', 'public, max-age=31536000, immutable');
    return payload;
  });
  app.register(fastifyStatic, { root: uiDist, prefix: '/', wildcard: true });
}
app.setNotFoundHandler((req, reply) => {
  if (seo) return seo.notFound(req, reply);
  if (req.url.startsWith('/api/') || req.url.startsWith('/v1/') || req.url.startsWith('/health') || !existsSync(uiDist)) return reply.code(404).send({ error: 'not found' });
  return reply.sendFile('index.html');
});

// Event-loop watchdog: the site and eleven worker lanes share one process, so a job that holds the CPU stalls every
// page. A tick late by over a second is logged with the jobs running then, and /health reports the last hour's stalls.
const stalls: { at: number; ms: number; jobs: Record<string, string> }[] = [];
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), lag = now - lastTick - 500;
  lastTick = now;
  if (lag < 1000) return;
  const jobs = Object.fromEntries(runningJobs);
  stalls.push({ at: now, ms: lag, jobs });
  while (stalls.length > 200 || (stalls[0] && now - stalls[0].at > 3600_000)) stalls.shift();
  log.warn({ lag_ms: lag, jobs }, 'event loop stalled');
}, 500).unref();
// Garbage collection pauses, to tell a full heap from a job's own work when the loop stalls.
const gcs: { at: number; ms: number }[] = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (e.duration >= 200) { gcs.push({ at: Date.now(), ms: Math.round(e.duration) }); if (gcs.length > 200) gcs.shift(); }
}).observe({ entryTypes: ['gc'] });
const loopStats = () => {
  const recent = stalls.filter((x) => Date.now() - x.at < 3600_000);
  const gc = gcs.filter((x) => Date.now() - x.at < 3600_000);
  const heap = getHeapStatistics(), mem = process.memoryUsage();
  return { stalls_1h: recent.length, max_ms_1h: recent.reduce((m, x) => Math.max(m, x.ms), 0), last: recent.slice(-5).map((x) => ({ at: new Date(x.at).toISOString(), ms: x.ms, jobs: x.jobs })),
    gc_over_200ms_1h: gc.length, gc_ms_1h: gc.reduce((n, x) => n + x.ms, 0), gc_max_ms_1h: gc.reduce((m, x) => Math.max(m, x.ms), 0),
    heap_mb: Math.round(heap.used_heap_size / 1e6), heap_limit_mb: Math.round(heap.heap_size_limit / 1e6), rss_mb: Math.round(mem.rss / 1e6) };
};

// Liveness for Render's health check: the process answers and its event loop is not stuck. Kept apart from /health,
// so a late worker lane or a slow database never gets the site restarted.
app.get('/healthz', async (_req, reply) => {
  const lag = Date.now() - lastTick;
  reply.header('Cache-Control', 'no-store');
  return lag < 10_000 ? { ok: true } : reply.code(503).send({ ok: false, lag_ms: lag });
});

// The full picture for the console: the database answers and both worker lanes have beaten recently (src/ops/health.ts).
let dbLastOkAt: number | null = null;
app.get('/health', async (_req, reply) => {
  const db = getDb();
  let dbOk = false;
  try { const { error } = await db.from('college_kv').select('key').limit(1); dbOk = !error; } catch { dbOk = false; }
  if (dbOk) dbLastOkAt = Date.now();
  const hb: Record<string, WorkerHeartbeat | null> = dbOk ? await heartbeats(db) : Object.fromEntries(LANES.map((l) => [l, null]));
  const h = evaluateHealth({ now: Date.now(), startedAt, dbOk, dbLastOkAt, heartbeats: hb, lanes: LANES });
  reply.code(h.ok ? 200 : 503);
  return { ...h, jobs: jobNames().length, api: '/v1', time: new Date().toISOString(), loop: loopStats() };
});

const port = cfg.PORT;
app.listen({ port, host: '0.0.0.0' }).then(() => {
  log.info({ port }, 'http listening');
  const controller = new AbortController();
  // A deploy or restart: workers stop taking jobs and the server stops taking connections while open requests
  // finish (Render waits 30 s before it ends the process).
  const stop = () => { controller.abort(); void app.close().catch(() => {}); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  // Three lanes: the crawl (minutes to hours per run), the live scoreboard (seconds, every minute in game hours) and short side jobs.
  if (cfg.WORKERS_ENABLED !== '0') {
  workerLoop(getDb(), { signal: controller.signal, exclude: ['live', 'h2h-detail', 'backfill', 'weekly', ...AUX_JOBS, ...PRO_LANE_JOBS, ...PRO_BULK_JOBS, ...SOURCE_JOBS], lane: 'crawl' }).catch((err) => { log.error({ err: String(err) }, 'worker crashed'); process.exit(1); });
  workerLoop(getDb(), { signal: controller.signal, jobs: ['live'], idleMs: 10_000, lane: 'live' }).catch((err) => { log.error({ err: String(err) }, 'live worker crashed'); process.exit(1); });
  // A third lane for short side jobs (finals' box scores, weather, ratings, sims, RPI, Elo, the stat audit) so they
  // never wait hours behind the nightly crawl. They also keep running while the college crawl is paused.
  workerLoop(getDb(), { signal: controller.signal, jobs: AUX_JOBS, idleMs: 15_000, lane: 'aux' }).catch((err) => { log.error({ err: String(err) }, 'aux worker crashed'); process.exit(1); });
  // A second worker for finished college matches' box scores (since the 2 GB instance, 2026-10-15): a busy night's
  // finals no longer queue for hours behind one worker. Each run claims its own games.
  workerLoop(getDb(), { signal: controller.signal, jobs: ['final-detail'], idleMs: 15_000, lane: 'aux-b' }).catch((err) => { log.error({ err: String(err) }, 'aux-b worker crashed'); process.exit(1); });
  // A fourth for Plaibook Stats Pro's everyday jobs (scores, detail, tables): seconds each, all year, never behind a college crawl.
  workerLoop(getDb(), { signal: controller.signal, jobs: PRO_LANE_JOBS, idleMs: 10_000, lane: 'pro' }).catch((err) => { log.error({ err: String(err) }, 'pro worker crashed'); process.exit(1); });
  // A fifth for the pro bulk crawl (minutes per run): never behind the college crawl, never in front of live pro scores.
  workerLoop(getDb(), { signal: controller.signal, jobs: PRO_BULK_JOBS, idleMs: 15_000, lane: 'pro-bulk' }).catch((err) => { log.error({ err: String(err) }, 'pro-bulk worker crashed'); process.exit(1); });
  // A past season's full backfill (2024, 2025: days of school-site pages): its own lane, so hourly, nightly and the
  // standings never wait behind it. School sites keep their per-host limits in the shared fetch client.
  // The weekly full pass takes about a day: its own lane, so the nightly, hourly and standings runs never queue behind it.
  workerLoop(getDb(), { signal: controller.signal, jobs: ['weekly'], idleMs: 60_000, lane: 'weekly' }).catch((err) => { log.error({ err: String(err) }, 'weekly worker crashed'); process.exit(1); });
  workerLoop(getDb(), { signal: controller.signal, jobs: ['backfill'], idleMs: 30_000, lane: 'history' }).catch((err) => { log.error({ err: String(err) }, 'history worker crashed'); process.exit(1); });
  // Box scores for earlier meetings a match page asked for: their own lane, so a backlog never holds up final-detail.
  workerLoop(getDb(), { signal: controller.signal, jobs: ['h2h-detail'], idleMs: 15_000, lane: 'h2h' }).catch((err) => { log.error({ err: String(err) }, 'h2h worker crashed'); process.exit(1); });
  // The scraped and open sources (ASA, Wikipedia, openfootball ...): two workers that download, side by side (each
  // site keeps its own per-host limit in the shared client), and one that matches, checks and fills, one job at a
  // time so a check never runs in the middle of a matching pass. Never on API-Football's quota.
  const fetchJobs = SOURCE_JOBS.filter((j) => !CHECK_JOBS.includes(j) && j !== 'asa-fill');
  const checkJobs = SOURCE_JOBS.filter((j) => !fetchJobs.includes(j));
  for (const lane of ['sources-a', 'sources-b']) workerLoop(getDb(), { signal: controller.signal, jobs: fetchJobs, idleMs: 15_000, lane }).catch((err) => { log.error({ err: String(err), lane }, 'sources worker crashed'); process.exit(1); });
  workerLoop(getDb(), { signal: controller.signal, jobs: checkJobs, idleMs: 15_000, lane: 'sources' }).catch((err) => { log.error({ err: String(err) }, 'sources worker crashed'); process.exit(1); });
  }
  if (cfg.SCHEDULER_ENABLED === '1') startScheduler(getDb(), { signal: controller.signal });
  // Requests per site for the hub's Crawling page (pro_source_requests).
  startRequestFlush(getDb());
  // The hub's Crawling tab reads take 10-25 s to build: build them once a minute after boot (a deploy empties the
  // cache), so the first visit after a deploy does not time out.
  setTimeout(() => {
    const warm = (path: string) => app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${cfg.COLLEGE_TRIGGER_SECRET ?? ''}` } }).catch(() => {});
    void (async () => { for (const path of ['/api/console/pro', '/api/console/pro?parts=summary', '/api/console/pro/leagues?scope=us&seasons=current', '/api/console/insights?days=30']) await warm(path); })();
  }, 60_000).unref();
  controller.signal.addEventListener('abort', () => { void flushRequests(getDb()); void analytics.flush(); void usage.flush(); });
}).catch((err) => { log.error({ err: String(err) }, 'listen failed'); process.exit(1); });
