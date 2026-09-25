// robots.txt, served from the SEO routes so the Sitemap line follows PUBLIC_URL. ui/public/robots.txt holds the
// same text for the production host (a test keeps the two identical).
import { trimBase } from './util.js';

/** Crawlers that collect training data for AI models: kept off the whole site. */
export const AI_TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Bytespider'];
/** Search engines' AI answer and user-triggered fetchers: welcome everywhere the public may go. */
export const AI_ANSWER_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User'];
export const DISALLOWED = ['/admin', '/console', '/jobs', '/quality', '/v1', '/api/console', '/api/quality', '/api/runs', '/api/jobs'];

export function robotsTxt(baseUrl: string): string {
  const rules = ['Allow: /', 'Allow: /api/', ...DISALLOWED.map((p) => `Disallow: ${p}`)];
  return [
    '# Plaibook Stats: the stats pages (and the /api reads they render from) are public; the admin console,',
    '# the job routes and the bulk API are not for crawlers. AI training crawlers are not welcome.',
    'User-agent: *',
    ...rules,
    '',
    ...AI_ANSWER_BOTS.map((b) => `User-agent: ${b}`),
    ...rules,
    '',
    ...AI_TRAINING_BOTS.map((b) => `User-agent: ${b}`),
    'Disallow: /',
    '',
    `Sitemap: ${trimBase(baseUrl)}/sitemap.xml`,
    '',
  ].join('\n');
}
