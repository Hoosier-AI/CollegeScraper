// Cross-origin access for the phone app.
//
// The app's pages are a bundled copy of the site served from capacitor://localhost; they read /api, /card and /og on
// https://www.plaibook.live, which is another origin to the WebView. The website itself is same-origin and needs
// none of this.
//
//   /api/*   The app's origin (and the UI dev server outside production) is echoed in Access-Control-Allow-Origin.
//            Every other origin gets no header, so a browser on another site still cannot read the API.
//            A preflight (OPTIONS) is answered here with 204: it carries no credentials by design, and the hooks
//            after this one would refuse it (src/ui/api.ts treats every non-GET /api request as admin-only).
//   /card/*, /og/*   Pictures made to be shared, public to everyone: any origin may read them.
//
// Must be registered BEFORE registerUiApi (hooks run in the order they are added). The headers are set in onRequest
// so a refusal later on (401, 429, a 500) carries them too; without them the app sees only "Load failed".
import type { FastifyInstance } from 'fastify';
import { routedPath } from './routePath.js';

/** The app's WebView origin (Capacitor on iOS). */
export const APP_ORIGIN = 'capacitor://localhost';
/** The UI dev server (ui/vite.config.ts), allowed outside production only. */
export const DEV_ORIGIN = 'http://localhost:5174';

export const CORS_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
export const CORS_HEADERS = 'Content-Type, Authorization';
export const CORS_MAX_AGE_SECONDS = 600;

export interface CorsOptions {
  /** Defaults to NODE_ENV === 'production'. */
  production?: boolean;
}

export function allowedOrigins(production: boolean): string[] {
  return production ? [APP_ORIGIN] : [APP_ORIGIN, DEV_ORIGIN];
}

export function registerCors(app: FastifyInstance, opts: CorsOptions = {}): void {
  const allowed = new Set(allowedOrigins(opts.production ?? process.env.NODE_ENV === 'production'));
  app.addHook('onRequest', async (req, reply) => {
    // The route the request matched, as every other gate here judges it (src/http/routePath.ts). A preflight matches
    // no route (there are no OPTIONS routes) and falls back to its decoded pathname.
    const path = routedPath(req);
    if (path.startsWith('/card/') || path.startsWith('/og/')) {
      reply.header('Access-Control-Allow-Origin', '*');
      return;
    }
    if (!path.startsWith('/api/')) return;
    // The answer depends on who asks: a cache must not hand one origin's copy to another.
    reply.header('Vary', 'Origin');
    const origin = req.headers.origin;
    if (typeof origin === 'string' && allowed.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Methods', CORS_METHODS);
      reply.header('Access-Control-Allow-Headers', CORS_HEADERS);
    }
    if (req.method === 'OPTIONS') {
      reply.header('Access-Control-Max-Age', String(CORS_MAX_AGE_SECONDS));
      return reply.code(204).send();
    }
  });
}
