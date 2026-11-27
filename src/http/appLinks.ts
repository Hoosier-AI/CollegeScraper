// Universal links for the iOS app: the file Apple reads to learn which pages of the site open in the app.
// Apple fetches https://<domain>/.well-known/apple-app-site-association (through its own CDN) and wants JSON served
// directly: no redirect, no sign-in. Pages the app has (matches, teams, players, competitions) open in it; the API,
// the picture routes and the owner's console never do.
import type { FastifyInstance } from 'fastify';

/** Apple team id + the app's bundle id. */
export const APP_ID = 'NSYYJ2GK7A.live.plaibook.app';

const NOT_IN_APP = ['/api/*', '/card/*', '/og/*', '/admin*', '/console*'];
const IN_APP = ['/matches/*', '/teams/*', '/players/*', '/conferences/*', '/pro/*', '/intl/*', '/tournament', '/following'];

/** The association file. The first matching component wins, so the exclusions come first. */
export function appleAppSiteAssociation() {
  return {
    applinks: {
      details: [{
        appIDs: [APP_ID],
        components: [
          ...NOT_IN_APP.map((path) => ({ '/': path, exclude: true })),
          ...IN_APP.map((path) => ({ '/': path })),
        ],
      }],
    },
  };
}

export function registerAppLinks(app: FastifyInstance): void {
  const body = JSON.stringify(appleAppSiteAssociation());
  // The path has no extension, so the type is set here (the static file server would send application/octet-stream).
  app.get('/.well-known/apple-app-site-association', async (_req, reply) =>
    reply.header('Cache-Control', 'public, max-age=3600').type('application/json').send(body));
}
