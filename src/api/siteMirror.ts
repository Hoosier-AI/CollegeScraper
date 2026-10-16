// /v1/site/*: everything the site shows, for Plaibook. A GET /v1/site/<path> runs the site's own GET /api/<path> in
// the same process (app.inject) and hands back its answer, so every page's data (college, pro, international, news)
// reaches Plaibook with the same validation, caching, takedown redaction and under-18 rule as the site, and a route
// the site adds tomorrow reaches it with no code here. /v1's hook has already checked the key and its limit; the
// inner request carries a per-process token so the site's per-visitor limit (src/ui/api.ts) lets it through.
//
// tests/api/site-parity.test.ts holds every GET /api route to either SITE_ROUTES in docs/plaibook-client.mjs (what
// Plaibook may ask for) or SITE_EXCLUDED below, so a new route is never silently missing from Plaibook.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** Site routes that are not data for Plaibook, by prefix, with the reason. Everything else under GET /api is mirrored. */
export const SITE_EXCLUDED: ReadonlyArray<{ prefix: string; why: string }> = [
  { prefix: '/api/console', why: 'admin console (trigger secret)' },
  { prefix: '/api/quality', why: 'admin crawl health' },
  { prefix: '/api/runs', why: 'admin crawl runs' },
  { prefix: '/api/jobs', why: 'admin job queue' },
  { prefix: '/api/legal/', why: "the site's own policy pages" },
  { prefix: '/api/t', why: 'analytics beacon (POST)' },
  { prefix: '/api/requests', why: 'corrections form (POST)' },
];

export const excluded = (path: string): boolean =>
  SITE_EXCLUDED.some((x) => path === x.prefix || path.startsWith(x.prefix.endsWith('/') ? x.prefix : `${x.prefix}/`) || path.startsWith(`${x.prefix}?`));

/** Records every GET /api/* route as it is registered; install before the site's routes. */
export function collectSiteRoutes(app: FastifyInstance): string[] {
  const routes: string[] = [];
  app.addHook('onRoute', (r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    if (methods.includes('GET') && r.url.startsWith('/api/') && !routes.includes(r.url)) routes.push(r.url);
  });
  return routes;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** '/api/programs/:id/elo' → a regex over a concrete path. */
export const patternOf = (route: string): RegExp => new RegExp(`^${route.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : escape(seg))).join('/')}$`);

/** The registered route a concrete path is served by: static segments win over parameters. */
export function matchRoute(routes: readonly string[], path: string): string | null {
  const hits = routes.filter((r) => patternOf(r).test(path));
  if (!hits.length) return null;
  return hits.sort((a, b) => (a.match(/:/g)?.length ?? 0) - (b.match(/:/g)?.length ?? 0))[0]!;
}

const SAFE_PATH = /^\/api\/[A-Za-z0-9._~@%:-]+(\/[A-Za-z0-9._~@%:-]+)*$/;

export interface SiteMirror {
  /** True for the inner request this mirror made (src/ui/api.ts skips its per-visitor limit for it). */
  internal: (req: FastifyRequest) => boolean;
}

export function registerSiteMirror(app: FastifyInstance, routes: readonly string[]): SiteMirror {
  const token = randomUUID();
  const tokenBuf = Buffer.from(token);
  const internal = (req: FastifyRequest) => {
    const got = req.headers['x-stats-internal'];
    return typeof got === 'string' && got.length === token.length && timingSafeEqual(Buffer.from(got), tokenBuf);
  };

  app.get<{ Params: { '*': string } }>('/v1/site/*', async (req, reply) => {
    // Plaibook's key (or the admin secret) only: the keyless tier never reaches the mirror.
    const principal = (req as FastifyRequest & { principal?: { kind: string } }).principal;
    if (!principal || principal.kind === 'anon') return reply.code(401).send({ error: 'unauthorized', message: 'An API key is required.' });
    const raw = req.url.slice('/v1/site'.length);
    const q = raw.indexOf('?');
    const path = `/api${q >= 0 ? raw.slice(0, q) : raw}`;
    const search = q >= 0 ? raw.slice(q) : '';
    if (!SAFE_PATH.test(path) || path.includes('..')) return reply.code(400).send({ error: 'bad_request', message: 'Not a site path.' });
    const route = excluded(path) ? null : matchRoute(routes.filter((r) => !excluded(r)), path);
    if (!route) return reply.code(404).send({ error: 'not_found', message: 'No such site data route.' });
    // A coach opening a page (x-plaibook-view: 1) counts as a visitor: the pro pages may fetch fresh detail for it, as
    // they do for the site. Everything else (Tekki, syncs, previews) reads as a bot, so it never spends that budget
    // or queues work.
    const view = req.headers['x-plaibook-view'] === '1';
    const res = await app.inject({
      method: 'GET', url: `${path}${search}`,
      headers: { host: String(req.headers.host ?? 'localhost'), 'user-agent': view ? 'Plaibook' : 'PlaibookBot', 'x-stats-internal': token, accept: 'application/json' },
    });
    reply.code(res.statusCode);
    for (const h of ['content-type', 'content-disposition'] as const) { const v = res.headers[h]; if (v) reply.header(h, String(v)); }
    // The site's answers are public; Plaibook's copy is per key.
    const cc = res.headers['cache-control'];
    reply.header('Cache-Control', cc ? String(cc).replace(/\bpublic\b/, 'private') : 'private, max-age=60');
    reply.header('x-stats-route', route);
    return reply.send(res.rawPayload);
  });

  return { internal };
}
