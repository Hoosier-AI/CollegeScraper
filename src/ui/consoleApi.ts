// The owner's console: /api/console/* — every route is admin-only (the onRequest gate in src/ui/api.ts covers
// the prefix). Reads come from src/ops/consoleQueries.ts; writes are kv settings, job enqueues, API keys and the
// Render service.
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';
import { enqueue, jobNames } from '../jobs/runner.js';
import { SCHEDULE } from '../jobs/scheduler.js';
import { currentSeason } from '../jobs/seasons.js';
import { loadConfig } from '../config.js';
import * as cq from '../ops/consoleQueries.js';
import { fixFor } from '../ops/qualityFixes.js';
import { KV, forgetKv, normalizeLive, setKv, schedulerOverrides, type LiveSettings } from '../ops/settings.js';
import { RenderClient, maskEnv, mergeEnv } from '../ops/render.js';
import type { KeyStore } from '../api/keys.js';
import type { UsageMeter } from '../api/usage.js';

export interface ConsoleOptions {
  keyStore: KeyStore | null;
  usage: UsageMeter;
  envKeys: string[];
  corsOrigins: string[];
  limits: { key: number; anon: number; site: number };
  startedAt: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerConsoleApi(app: FastifyInstance, o: ConsoleOptions): void {
  const cfg = loadConfig();
  const render = () => (cfg.RENDER_API_KEY && cfg.RENDER_SERVICE_ID ? new RenderClient(cfg.RENDER_API_KEY, cfg.RENDER_SERVICE_ID) : null);
  const todayUsage = () => { const today = new Date().toISOString().slice(0, 10); return o.usage.pending().filter((u) => u.day === today); };

  app.get('/api/console/overview', async () => cq.overview(getDb(), o.startedAt, todayUsage()));

  app.get<{ Querystring: Record<string, string> }>('/api/console/runs', async (req) => cq.runsPage(getDb(), {
    job: req.query.job || undefined, status: req.query.status || undefined, since: req.query.since || undefined,
    hide_live: req.query.hide_live !== '0', limit: Number(req.query.limit) || 50, offset: Number(req.query.offset) || 0,
  }));
  app.get('/api/console/jobs/catalogue', async () => ({ jobs: cq.catalogue(), rollup: await cq.jobRollup(getDb()) }));

  app.get('/api/console/schedule', async () => cq.schedule(getDb()));
  app.put<{ Params: { job: string }; Body: { enabled?: boolean } | null }>('/api/console/schedule/:job', async (req, reply) => {
    if (!SCHEDULE.some((e) => e.job === req.params.job)) return reply.code(404).send({ error: 'not a scheduled job' });
    const db = getDb();
    const overrides = { ...(await schedulerOverrides(db)) };
    overrides[req.params.job] = { enabled: req.body?.enabled !== false };
    await setKv(db, KV.schedulerOverrides, overrides);
    return cq.schedule(db);
  });
  app.post<{ Params: { job: string } }>('/api/console/schedule/:job/run', async (req, reply) => {
    if (!SCHEDULE.some((e) => e.job === req.params.job)) return reply.code(404).send({ error: 'not a scheduled job' });
    return reply.code(202).send(await enqueue(getDb(), req.params.job, { season: currentSeason(), manual: true }));
  });

  app.get<{ Querystring: Record<string, string> }>('/api/console/quality', async (req) => cq.qualityHistory(getDb(), Number(req.query.season) || currentSeason()));
  app.post<{ Body: { season?: number } | null }>('/api/console/quality/run', async (req, reply) => reply.code(202).send(await enqueue(getDb(), 'quality', { season: Number(req.body?.season) || currentSeason() })));
  app.post<{ Body: { check?: string; season?: number } | null }>('/api/console/quality/fix', async (req, reply) => {
    const fix = fixFor(String(req.body?.check ?? ''), Number(req.body?.season) || currentSeason());
    if (!fix) return reply.code(400).send({ error: 'no fix for this check' });
    return reply.code(202).send({ ...(await enqueue(getDb(), fix.job, fix.params)), fix });
  });

  app.get('/api/console/crawl', async () => cq.crawlHealth(getDb()));

  app.get('/api/console/settings', async () => cq.settings(getDb()));
  app.put<{ Body: { live?: Partial<LiveSettings>; scheduler_paused?: boolean; crawl_paused?: boolean; contact_email?: string } | null }>('/api/console/settings', async (req) => {
    const db = getDb(); const b = req.body ?? {};
    if (b.live) await setKv(db, KV.live, normalizeLive(b.live));
    if (typeof b.scheduler_paused === 'boolean') await setKv(db, KV.schedulerPaused, b.scheduler_paused);
    if (typeof b.crawl_paused === 'boolean') await setKv(db, KV.crawlPaused, b.crawl_paused);
    if (typeof b.contact_email === 'string') await setKv(db, KV.contactEmail, b.contact_email.trim() || null);
    forgetKv();
    return cq.settings(db);
  });

  app.get('/api/console/api', async () => {
    const db = getDb();
    const stored = o.keyStore ? await o.keyStore.list() : [];
    const usage = await cq.usageStored(db, 7);
    const pending = todayUsage();
    const plaibookName = ['plaibook', ...o.envKeys].find((n) => n === 'plaibook') ?? o.envKeys[0] ?? null;
    const lastSeen = (name: string) => usage.filter((u) => u.principal === name).map((u) => u.last_seen_at).filter(Boolean).sort().pop() ?? null;
    return {
      keys: [
        ...o.envKeys.map((name) => ({ id: null, name, source: 'env', prefix: null, note: 'From COLLEGE_API_KEYS on the service', created_at: null, revoked_at: null, last_used_at: lastSeen(name) })),
        ...stored.map((k) => ({ ...k, source: 'db', key_hash: undefined })),
      ],
      usage, pending,
      limits: o.limits, cors_origins: o.corsOrigins, public_url: cfg.PUBLIC_URL ?? null,
      plaibook: plaibookName ? { name: plaibookName, last_seen_at: lastSeen(plaibookName), today: (usage.find((u) => u.principal === plaibookName && u.day === new Date().toISOString().slice(0, 10))?.requests ?? 0) + (pending.find((u) => u.principal === plaibookName)?.requests ?? 0) } : null,
      generated_at: new Date().toISOString(),
    };
  });
  app.post<{ Body: { name?: string; note?: string } | null }>('/api/console/api/keys', async (req, reply) => {
    if (!o.keyStore) return reply.code(501).send({ error: 'no database' });
    const name = String(req.body?.name ?? '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(name)) return reply.code(400).send({ error: 'name: 2–40 characters, letters, digits, - or _' });
    if (o.envKeys.includes(name)) return reply.code(409).send({ error: 'that name is used by an env key' });
    try { return reply.code(201).send(await o.keyStore.create(name, req.body?.note?.trim() || null)); }
    catch (err) { return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) }); }
  });
  app.post<{ Params: { id: string } }>('/api/console/api/keys/:id/revoke', async (req, reply) => {
    if (!o.keyStore) return reply.code(501).send({ error: 'no database' });
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'bad id' });
    await o.keyStore.revoke(req.params.id);
    return { ok: true };
  });

  app.get('/api/console/deploy', async () => {
    const r = render();
    if (!r) return { configured: false, service_id: cfg.RENDER_SERVICE_ID ?? null };
    const [service, deploys, env] = await Promise.all([r.service(), r.deploys(10), r.envVars()]);
    return { configured: true, service, deploys, env: maskEnv(env), generated_at: new Date().toISOString() };
  });
  app.post('/api/console/deploy/deploy', async (_req, reply) => { const r = render(); if (!r) return reply.code(501).send({ error: 'RENDER_API_KEY / RENDER_SERVICE_ID not set' }); return reply.code(202).send(await r.deploy()); });
  app.post('/api/console/deploy/restart', async (_req, reply) => { const r = render(); if (!r) return reply.code(501).send({ error: 'RENDER_API_KEY / RENDER_SERVICE_ID not set' }); await r.restart(); return reply.code(202).send({ ok: true }); });
  app.put<{ Body: { set?: Record<string, string>; remove?: string[] } | null }>('/api/console/deploy/env', async (req, reply) => {
    const r = render(); if (!r) return reply.code(501).send({ error: 'RENDER_API_KEY / RENDER_SERVICE_ID not set' });
    let merged;
    try { merged = mergeEnv(await r.envVars(), req.body ?? {}); } catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) }); }
    await r.putEnvVars(merged);
    return { ok: true, env: maskEnv(merged), note: 'Render redeploys the service when its environment changes.' };
  });

  // Anything under the prefix that is not a route above.
  app.get('/api/console/jobs', async () => ({ jobs: jobNames() }));
}
