// Server-rendered entry points for search engines. Each public page answers with the single-page app's shell plus
// a page-specific <head> (title, canonical, Open Graph, JSON-LD) and an escaped summary in <section id="ssr">; the
// app then boots over it exactly as before. UUID addresses 301 to their slugs, the old client-side redirects are
// real 301s, unknown slugs and unknown paths are real 404s. Registered before @fastify/static, whose wildcard route
// loses to these specific ones. /api and /v1 are untouched apart from the small /api/resolve lookup the app uses
// to open slug addresses.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityKind, Gender, SeoData } from './types.js';
import type { Template } from './template.js';
import { LruCache } from './cache.js';
import { conferenceHead, homeHead, matchHead, notFoundHead, playerHead, rankingsHead, renderHead, teamHead, teamsHead, type HeadContext, type HeadMeta } from './head.js';
import { conferenceBody, homeBody, matchBody, notFoundBody, playerBody, rankingsBody, teamBody, teamsBody } from './body.js';
import { robotsTxt } from './robots.js';
import { Sitemaps } from './sitemaps.js';
import { genderFromSegment, genderSegment, matchPath, parseSeason, playerPath, SLUG, trimBase, UUID } from './util.js';
import type { ProSeoData } from './pro/data.js';
import { proCollegeBody, proCollegeHead, proCountriesBody, proCountriesHead, proCountryBody, proCountryHead, proDirectoryBody, proDirectoryHead, proTransfersBody, proTransfersHead, proHomeBody, proHomeHead, proMatchesBody, proMatchesHead, proLeagueBody, proLeagueHead, proLeaguesBody, proLeaguesHead, proMatchBody, proMatchHead, proPaths, proPlayerBody, proPlayerHead, proTeamBody, proTeamHead, proSourcesBody, proSourcesHead } from './pro/pages.js';
import { eastern } from '../jobs/seasons.js';

export const PAGE_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
const REDIRECT_CACHE_CONTROL = 'public, max-age=3600';
const NOT_FOUND_CACHE_CONTROL = 'public, max-age=60';
const SCHOOL = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

export interface SeoLogger { warn: (obj: unknown, msg?: string) => void }

export interface SeoOptions {
  data: SeoData;
  template: Template;
  /** PUBLIC_URL: canonical, Open Graph and sitemap URLs are absolute on this host. */
  baseUrl: string;
  /** The site rate limiter for rendered pages (cache misses only). Returns false when it already replied 429. */
  limit?: (req: FastifyRequest, reply: FastifyReply) => boolean | Promise<boolean>;
  /** GSC_VERIFICATION_FILE, e.g. "google1234abcd.html". */
  gscVerificationFile?: string | null;
  /** INDEXNOW_KEY: served at /<key>.txt. */
  indexNowKey?: string | null;
  /** Rendered pages: 500 entries, five minutes. */
  cache?: LruCache<CachedPage>;
  sitemaps?: Sitemaps;
  log?: SeoLogger;
  /** Plaibook Stats Pro pages (/pro/...) and their sitemaps. */
  pro?: ProSeoData | null;
}

export type CachedPage = { status: 200; html: string } | { status: 301; path: string };
type Outcome = { head: HeadMeta; body: string } | { redirect: string } | { shell: true } | null;

/** Single-page-app routes that the server does not render but must still answer with 200 and the shell. */
const SPA_ROUTE = /^\/(?:matches|search|admin|console|jobs|quality|teams|rankings|conferences|standings|leaders|pro\/matches|pro\/leagues|pro\/teams|pro\/players|pro\/compare)?\/?$/;
const API_PATH = /^\/(?:api|v1)(?:\/|$)|^\/health(?:\/|$)/;

const pathOf = (url: string) => url.split('?')[0] ?? url;
const queryOf = (url: string) => { const i = url.indexOf('?'); return i >= 0 ? url.slice(i) : ''; };
/** Browsers and crawlers ask for HTML (or anything); a client asking only for JSON gets the plain shell. */
const wantsHtml = (req: FastifyRequest) => { const a = String(req.headers.accept ?? ''); return !a || /text\/html|\*\/\*|application\/xhtml/i.test(a); };

export function registerSeo(app: FastifyInstance, opts: SeoOptions) {
  const { data, template } = opts;
  const baseUrl = trimBase(opts.baseUrl);
  const cache = opts.cache ?? new LruCache<CachedPage>(500, 5 * 60_000);
  const sitemaps = opts.sitemaps ?? new Sitemaps(data, baseUrl, {}, opts.pro ?? null);
  const warn = (obj: unknown, msg: string) => opts.log?.warn(obj, msg);
  const ctx = (): HeadContext => ({ baseUrl, currentSeason: data.currentSeason() });

  const html = (head: HeadMeta, body: string) => template.render(renderHead(head), body);
  const sendHtml = (reply: FastifyReply, status: number, body: string, cacheControl: string) =>
    reply.code(status).header('Cache-Control', cacheControl).type('text/html; charset=utf-8').send(body);

  const notFoundPage = (reply: FastifyReply) => { const c = ctx(); return sendHtml(reply, 404, html(notFoundHead(c), notFoundBody()), NOT_FOUND_CACHE_CONTROL); };
  const shell = (reply: FastifyReply, status = 200) => sendHtml(reply, status, template.shell(), 'no-cache');

  /** Cache, rate limit, build, render. Failures fall back to the app shell with 503 so crawlers retry later. */
  async function serve(req: FastifyRequest, reply: FastifyReply, key: string, build: () => Promise<Outcome>) {
    if (!wantsHtml(req)) return shell(reply);
    const cached = cache.get(key);
    if (cached) {
      reply.header('X-SSR-Cache', 'hit');
      if (cached.status === 301) return reply.code(301).header('Cache-Control', REDIRECT_CACHE_CONTROL).redirect(cached.path + queryOf(req.url), 301);
      return sendHtml(reply, 200, cached.html, PAGE_CACHE_CONTROL);
    }
    if (opts.limit && !(await opts.limit(req, reply))) return reply;
    let out: Outcome;
    try {
      out = await build();
    } catch (err) {
      warn({ err: String(err), url: req.url }, 'ssr render failed');
      reply.header('Retry-After', '120');
      return shell(reply, 503);
    }
    if (!out) return notFoundPage(reply);
    if ('shell' in out) return shell(reply);
    if ('redirect' in out) {
      cache.set(key, { status: 301, path: out.redirect });
      return reply.header('Cache-Control', REDIRECT_CACHE_CONTROL).redirect(out.redirect + queryOf(req.url), 301);
    }
    const page = html(out.head, out.body);
    cache.set(key, { status: 200, html: page });
    return sendHtml(reply, 200, page, PAGE_CACHE_CONTROL);
  }

  const seasonParam = (req: FastifyRequest) => parseSeason((req.query as Record<string, unknown> | undefined)?.season);
  const keyOf = (req: FastifyRequest) => `${pathOf(req.url)}|${seasonParam(req) ?? ''}`;
  type P<T> = FastifyRequest<{ Params: T }>;

  // ---------- pages ----------
  app.get('/', (req, reply) => serve(req, reply, keyOf(req), async () => {
    const c = ctx(); const h = await data.home(seasonParam(req) ?? c.currentSeason);
    return { head: homeHead(h, c), body: homeBody(h, c) };
  }));

  app.get('/teams', (req, reply) => serve(req, reply, keyOf(req), async () => {
    const c = ctx(); const t = await data.teams(seasonParam(req) ?? c.currentSeason);
    return { head: teamsHead(t, c), body: teamsBody(t, c) };
  }));

  app.get('/rankings', (req, reply) => serve(req, reply, keyOf(req), async () => {
    const c = ctx(); const r = await data.rankings(seasonParam(req) ?? c.currentSeason);
    return { head: rankingsHead(r, c), body: rankingsBody(r, c) };
  }));

  app.get('/teams/:school/:gender', (req: P<{ school: string; gender: string }>, reply) => serve(req, reply, keyOf(req), async () => {
    const { school, gender } = req.params;
    const g = genderFromSegment(gender.toLowerCase());
    if (!g || !SCHOOL.test(school)) return null;
    if (school !== school.toLowerCase() || gender !== gender.toLowerCase()) return { redirect: `/teams/${encodeURIComponent(school.toLowerCase())}/${genderSegment(g)}` };
    const c = ctx(); const t = await data.team(school, g, seasonParam(req));
    return t ? { head: teamHead(t, c), body: teamBody(t, c) } : null;
  }));

  app.get('/teams/:id', (req: P<{ id: string }>, reply) => serve(req, reply, keyOf(req), async () => {
    if (!req.params.id) return { shell: true }; // "/teams/"
    if (!UUID.test(req.params.id)) return null;
    const k = await data.teamKeyById(req.params.id.toLowerCase());
    return k ? { redirect: `/teams/${encodeURIComponent(k.school_seo)}/${genderSegment(k.gender)}` } : null;
  }));

  app.get('/players/:slug', (req: P<{ slug: string }>, reply) => serve(req, reply, keyOf(req), async () => {
    const s = req.params.slug;
    if (UUID.test(s)) { const slug = await data.playerSlugById(s.toLowerCase()); return slug ? { redirect: playerPath(slug) } : null; }
    if (!SLUG.test(s)) return null;
    const p = await data.player(s);
    if (p) { const c = ctx(); return { head: playerHead(p, c), body: playerBody(p) }; }
    const moved = await data.renamedSlug('player', s);
    return moved ? { redirect: playerPath(moved) } : null;
  }));

  app.get('/matches/:slug', (req: P<{ slug: string }>, reply) => serve(req, reply, keyOf(req), async () => {
    const s = req.params.slug;
    if (!s) return { shell: true }; // "/matches/"
    if (UUID.test(s)) { const slug = await data.matchSlugById(s.toLowerCase()); return slug ? { redirect: matchPath(slug) } : null; }
    if (!SLUG.test(s)) return null;
    const m = await data.match(s);
    if (m) { const c = ctx(); return { head: matchHead(m, c), body: matchBody(m, c) }; }
    const moved = await data.renamedSlug('game', s);
    return moved ? { redirect: matchPath(moved) } : null;
  }));

  app.get('/conferences/:seo', (req: P<{ seo: string }>, reply) => serve(req, reply, keyOf(req), async () => {
    const s = req.params.seo;
    if (!s) return { shell: true };
    if (UUID.test(s)) { const seo = await data.conferenceSeoById(s.toLowerCase()); return seo ? { redirect: `/conferences/${encodeURIComponent(seo)}` } : null; }
    if (!SCHOOL.test(s)) return null;
    const c = ctx(); const conf = await data.conference(s, seasonParam(req) ?? c.currentSeason);
    return conf ? { head: conferenceHead(conf, c), body: conferenceBody(conf, c) } : null;
  }));

  // ---------- Plaibook Stats Pro ----------
  const pro = opts.pro;
  if (pro) {
    app.get('/pro', (req, reply) => serve(req, reply, keyOf(req), async () => {
      const c = ctx(); const h = await pro.home(eastern().date);
      return { head: proHomeHead(h, c), body: proHomeBody(h) };
    }));
    // Today's scoreboard; another day (?date=) is the app's own view of the same page.
    app.get('/pro/matches', (req, reply) => serve(req, reply, keyOf(req), async () => {
      const c = ctx(); const h = await pro.home(eastern().date);
      return { head: proMatchesHead(h, c), body: proMatchesBody(h) };
    }));
    app.get('/pro/leagues', (req, reply) => serve(req, reply, keyOf(req), async () => {
      const c = ctx(); const ls = await pro.leagues();
      return { head: proLeaguesHead(ls, c), body: proLeaguesBody(ls) };
    }));
    app.get('/pro/players', (req, reply) => serve(req, reply, keyOf(req), async () => { const p = await pro.leaders({ stat: 'minutes', limit: 50 }); return { head: proDirectoryHead('players', p, ctx()), body: proDirectoryBody('players', p) }; }));
    app.get('/pro/leaders', (req, reply) => serve(req, reply, keyOf(req), async () => { const p = await pro.leaders({ stat: 'goals', limit: 50 }); return { head: proDirectoryHead('leaders', p, ctx()), body: proDirectoryBody('leaders', p) }; }));
    app.get('/pro/countries', (req, reply) => serve(req, reply, keyOf(req), async () => { const cs = await pro.countries(); return { head: proCountriesHead(cs, ctx()), body: proCountriesBody(cs) }; }));
    app.get('/pro/countries/:slug', (req: P<{ slug: string }>, reply) => serve(req, reply, keyOf(req), async () => {
      if (!SLUG.test(req.params.slug)) return null;
      const c = await pro.country(req.params.slug);
      return c ? { head: proCountryHead(c, ctx()), body: proCountryBody(c) } : null;
    }));
    app.get('/pro/college', (req, reply) => serve(req, reply, keyOf(req), async () => { const h = await pro.college(); return { head: proCollegeHead(h, ctx()), body: proCollegeBody(h) }; }));
    app.get('/pro/sources', (req, reply) => serve(req, reply, keyOf(req), async () => ({ head: proSourcesHead(ctx()), body: proSourcesBody() })));
    app.get('/pro/transfers', (req, reply) => serve(req, reply, keyOf(req), async () => { const t = await pro.transfers(); return { head: proTransfersHead(t, ctx()), body: proTransfersBody(t) }; }));
    // A slug page, or a 301 when the slug was renamed, or a real 404.
    const proPage = <T>(kind: 'league' | 'team' | 'player' | 'match', load: (slug: string, req: FastifyRequest) => Promise<T | null>, render: (page: T) => { head: HeadMeta; body: string }, path: (slug: string) => string) =>
      (req: P<{ slug: string }>, reply: FastifyReply) => serve(req, reply, keyOf(req), async () => {
        const s = req.params.slug;
        if (!s) return { shell: true };
        if (!SLUG.test(s)) return null;
        const page = await load(s, req);
        if (page) return render(page);
        const moved = await pro.renamedSlug(kind, s);
        return moved ? { redirect: path(moved) } : null;
      });
    app.get('/pro/leagues/:slug', proPage('league', (s, req) => pro.league(s, seasonParam(req)), (p) => ({ head: proLeagueHead(p, ctx()), body: proLeagueBody(p) }), (s) => proPaths.league(s)));
    app.get('/pro/teams/:slug', proPage('team', (s, req) => pro.team(s, seasonParam(req)), (p) => ({ head: proTeamHead(p, ctx()), body: proTeamBody(p) }), (s) => proPaths.team(s)));
    app.get('/pro/players/:slug', proPage('player', (s) => pro.player(s), (p) => ({ head: proPlayerHead(p, ctx()), body: proPlayerBody(p) }), (s) => proPaths.player(s)));
    app.get('/pro/matches/:slug', proPage('match', (s) => pro.match(s), (p) => ({ head: proMatchHead(p, ctx()), body: proMatchBody(p) }), (s) => proPaths.match(s)));
  }

  // ---------- old addresses (were client-side redirects only) ----------
  const moved = (to: string, extra?: string) => (req: FastifyRequest, reply: FastifyReply) => {
    const q = queryOf(req.url).replace(/^\?/, '');
    const qs = [q, extra].filter(Boolean).join('&');
    return reply.header('Cache-Control', REDIRECT_CACHE_CONTROL).redirect(`${to}${qs ? `?${qs}` : ''}`, 301);
  };
  app.get('/standings', moved('/rankings'));
  app.get('/leaders', moved('/rankings', 'view=leaders'));
  app.get('/conferences', moved('/rankings', 'view=standings'));
  app.get('/games/:id', async (req: P<{ id: string }>, reply) => {
    const id = req.params.id;
    // Straight to the slug when we know it, so crawlers do not follow two hops.
    const slug = UUID.test(id) ? await data.matchSlugById(id.toLowerCase()).catch(() => null) : null;
    return moved(slug ? matchPath(slug) : `/matches/${encodeURIComponent(id)}`)(req, reply);
  });

  // ---------- crawler files ----------
  app.get('/robots.txt', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=3600').type('text/plain; charset=utf-8').send(robotsTxt(baseUrl)));

  const sitemap = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const xml = await sitemaps.get(pathOf(req.url));
      if (xml == null) return reply.code(404).type('text/plain; charset=utf-8').send('not found');
      return reply.header('Cache-Control', 'public, max-age=3600').type('application/xml; charset=utf-8').send(xml);
    } catch (err) {
      warn({ err: String(err), url: req.url }, 'sitemap failed');
      return reply.code(503).header('Retry-After', '300').type('text/plain; charset=utf-8').send('temporarily unavailable');
    }
  };
  app.get('/sitemap.xml', sitemap);
  app.get('/sitemaps/:file', sitemap);

  if (opts.gscVerificationFile && /^google[0-9a-z]+\.html$/i.test(opts.gscVerificationFile)) {
    const file = opts.gscVerificationFile;
    app.get(`/${file}`, async (_req, reply) => reply.type('text/html; charset=utf-8').send(`google-site-verification: ${file}`));
  }
  if (opts.indexNowKey && /^[A-Za-z0-9-]{8,128}$/.test(opts.indexNowKey)) {
    const key = opts.indexNowKey;
    app.get(`/${key}.txt`, async (_req, reply) => reply.type('text/plain; charset=utf-8').send(key));
  }

  // ---------- slug lookup for the single-page app ----------
  app.get<{ Querystring: Record<string, string> }>('/api/resolve', async (req, reply) => {
    const kind = req.query.kind as EntityKind; const key = String(req.query.key ?? '');
    if (!['team', 'player', 'match', 'conference'].includes(kind) || !key || key.length > 200) return reply.code(400).send({ error: 'kind and key required' });
    if (kind === 'team') {
      const [school = '', seg = ''] = key.split('/');
      const g: Gender | null = genderFromSegment(seg) ?? (seg === 'm' || seg === 'w' ? seg : null);
      if (!g || !SCHOOL.test(school)) return reply.code(404).send({ error: 'not found' });
      const id = await data.resolve('team', `${school}/${g}`);
      return id ? reply.header('Cache-Control', 'public, max-age=300').send({ id }) : reply.code(404).send({ error: 'not found' });
    }
    if (!SLUG.test(key) && !SCHOOL.test(key)) return reply.code(404).send({ error: 'not found' });
    const id = await data.resolve(kind, key);
    return id ? reply.header('Cache-Control', 'public, max-age=300').send({ id }) : reply.code(404).send({ error: 'not found' });
  });

  /** For app.setNotFoundHandler: JSON for API paths, the shell for app routes, a real 404 page for the rest. */
  const notFound = (req: FastifyRequest, reply: FastifyReply) => {
    const path = pathOf(req.url);
    if (API_PATH.test(path)) return reply.code(404).send({ error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(404).send({ error: 'not found' });
    if (SPA_ROUTE.test(path)) return shell(reply);
    return notFoundPage(reply);
  };
  return { notFound, cache, sitemaps };
}
