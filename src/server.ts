// HTTP surface for Render: health, enqueue, run listing, cancel. Starts the worker loop.
import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.js';
import { getDb } from './db/client.js';
import { enqueue, jobNames, workerLoop } from './jobs/runner.js';
import { registerAllJobs } from './jobs/index.js';
import { startScheduler } from './jobs/scheduler.js';
import { registerUiApi } from './ui/api.js';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';

const cfg = loadConfig();
registerAllJobs();
const app = Fastify({ logger: false });

function authorized(header: string | undefined): boolean {
  const secret = cfg.COLLEGE_TRIGGER_SECRET;
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const got = String(header ?? '');
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

registerUiApi(app, authorized);

// Built stats viewer (ui/dist) with SPA fallback; API and health routes are registered above it.
const uiDist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'dist');
if (existsSync(uiDist)) {
  // wildcard: true serves whatever is on disk at request time, so a UI rebuild does not need a restart.
  app.register(fastifyStatic, { root: uiDist, prefix: '/', wildcard: true });
  app.setNotFoundHandler((req, reply) => {
    // API-ish paths 404 as JSON; everything else (including the SPA's /jobs page) gets index.html.
    if (req.url.startsWith('/api/') || /^\/jobs\/(enqueue|runs|[^/?]+\/cancel)/.test(req.url) || req.url.startsWith('/health')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

app.get('/health', async () => ({ ok: true, jobs: jobNames(), time: new Date().toISOString() }));

app.post<{ Querystring: { job?: string }; Body: Record<string, unknown> | null }>('/jobs/enqueue', async (req, reply) => {
  if (!authorized(req.headers.authorization)) return reply.code(401).send({ error: 'unauthorized' });
  const job = req.query.job;
  if (!job || !jobNames().includes(job)) return reply.code(400).send({ error: 'unknown job', jobs: jobNames() });
  const params = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const r = await enqueue(getDb(), job, params);
  return reply.code(r.existing ? 200 : 202).send(r);
});

app.get('/jobs/runs', async (req, reply) => {
  if (!authorized(req.headers.authorization)) return reply.code(401).send({ error: 'unauthorized' });
  const { data, error } = await getDb().from('college_crawl_runs').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return reply.code(500).send({ error: error.message });
  return data;
});

app.post<{ Params: { id: string } }>('/jobs/:id/cancel', async (req, reply) => {
  if (!authorized(req.headers.authorization)) return reply.code(401).send({ error: 'unauthorized' });
  const { error } = await getDb().from('college_crawl_runs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', req.params.id).in('status', ['queued', 'running']);
  if (error) return reply.code(500).send({ error: error.message });
  return { ok: true };
});

const port = cfg.PORT;
app.listen({ port, host: '0.0.0.0' }).then(() => {
  log.info({ port }, 'http listening');
  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort());
  process.on('SIGINT', () => controller.abort());
  workerLoop(getDb(), { signal: controller.signal }).catch((err) => { log.error({ err: String(err) }, 'worker crashed'); process.exit(1); });
  if (cfg.SCHEDULER_ENABLED === '1') startScheduler(getDb(), { signal: controller.signal });
}).catch((err) => { log.error({ err: String(err) }, 'listen failed'); process.exit(1); });
