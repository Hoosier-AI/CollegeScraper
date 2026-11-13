// robots.txt, served from the SEO routes so the Sitemap line follows PUBLIC_URL. ui/public/robots.txt holds the
// same text for the production host (a test keeps the two identical).
import { trimBase } from './util.js';

/** Crawlers that collect training data for AI models: kept off the whole site. Meta and Amazon joined 2026-11-02
 * (about 210k requests a day between them, the Render bandwidth bill). src/seo/aiBots.ts refuses them too. */
export const AI_TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Bytespider', 'meta-externalagent', 'Amazonbot'];
/** Search engines' AI answer and user-triggered fetchers: welcome on every page, so they can cite it, but not on the
 * site's /api (they read the server-rendered page). src/seo/aiBots.ts holds each to AI_BOT_RATE_PER_MIN. */
export const AI_ANSWER_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User'];
/** Page requests a minute each AI answer bot is served (the /data-use limit); robots.txt asks for the matching
 * Crawl-delay. Perplexity alone sent ~480k a day on 2026-10-29. */
export const AI_BOT_RATE_PER_MIN = 20;
export const DISALLOWED = ['/admin', '/console', '/jobs', '/quality', '/v1', '/api/console', '/api/quality', '/api/runs', '/api/jobs'];

/** Search engines that render pages with JavaScript, which reads the site's own /api: they may read it. */
export const SEARCH_ENGINES = ['Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot', 'YandexBot'];

export function robotsTxt(baseUrl: string): string {
  const pages = ['Allow: /', ...DISALLOWED.map((p) => `Disallow: ${p}`)];
  const withApi = ['Allow: /', 'Allow: /api/', ...DISALLOWED.map((p) => `Disallow: ${p}`)];
  return [
    '# Plaibook Live. The pages are public. The /api reads behind them are for the site itself (search engines',
    '# that render pages may read them); the admin console, job routes and the bulk API are not for crawlers.',
    '# AI training crawlers are not welcome. Rules for bots and automated access: /data-use',
    'User-agent: *',
    ...pages,
    'Disallow: /api/',
    '',
    ...SEARCH_ENGINES.map((b) => `User-agent: ${b}`),
    ...withApi,
    '',
    ...AI_ANSWER_BOTS.map((b) => `User-agent: ${b}`),
    ...pages,
    'Disallow: /api/',
    `Crawl-delay: ${60 / AI_BOT_RATE_PER_MIN}`,
    '',
    ...AI_TRAINING_BOTS.map((b) => `User-agent: ${b}`),
    'Disallow: /',
    '',
    `Sitemap: ${trimBase(baseUrl)}/sitemap.xml`,
    '',
  ].join('\n');
}
