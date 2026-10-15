// robots.txt, served from the SEO routes so the Sitemap line follows PUBLIC_URL. ui/public/robots.txt holds the
// same text for the production host (a test keeps the two identical).
import { trimBase } from './util.js';

/** Crawlers that collect training data for AI models: kept off the whole site. */
export const AI_TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Bytespider'];
/** Search engines' AI answer and user-triggered fetchers: welcome everywhere the public may go. */
export const AI_ANSWER_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User'];
export const DISALLOWED = ['/admin', '/console', '/jobs', '/quality', '/v1', '/api/console', '/api/quality', '/api/runs', '/api/jobs'];

/** Search engines that render pages with JavaScript, which reads the site's own /api: they may read it. */
export const SEARCH_ENGINES = ['Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot', 'YandexBot'];

export function robotsTxt(baseUrl: string): string {
  const pages = ['Allow: /', ...DISALLOWED.map((p) => `Disallow: ${p}`)];
  const withApi = ['Allow: /', 'Allow: /api/', ...DISALLOWED.map((p) => `Disallow: ${p}`)];
  return [
    '# Plaibook Stats. The pages are public. The /api reads behind them are for the site itself (search engines',
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
    ...withApi,
    '',
    ...AI_TRAINING_BOTS.map((b) => `User-agent: ${b}`),
    'Disallow: /',
    '',
    `Sitemap: ${trimBase(baseUrl)}/sitemap.xml`,
    '',
  ].join('\n');
}
