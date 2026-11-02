import { describe, it, expect } from 'vitest';
import { AiBotCounter, aiBotGate, canonicalRedirect, classifyAiBot } from '../src/seo/aiBots.js';

describe('classifyAiBot', () => {
  it('recognizes AI crawlers and ignores browsers and search engines', () => {
    expect(classifyAiBot('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)')).toBe('OAI-SearchBot');
    expect(classifyAiBot('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')).toBe('ClaudeBot');
    expect(classifyAiBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBeNull();
    expect(classifyAiBot('Mozilla/5.0 (Macintosh) Safari/605')).toBeNull();
    expect(classifyAiBot(undefined)).toBeNull();
  });
});

describe('aiBotGate', () => {
  it('refuses training crawlers everywhere but robots.txt', () => {
    for (const ua of ['meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)', 'Mozilla/5.0 (compatible; Amazonbot/0.1)', 'GPTBot/1.1', 'CCBot/2.0']) {
      const bot = classifyAiBot(ua)!;
      expect(aiBotGate(bot, '/teams/duke/men')).toBe('refuse');
      expect(aiBotGate(bot, '/')).toBe('refuse');
      expect(aiBotGate(bot, '/robots.txt')).toBe('serve');
    }
  });
  it('limits answer bots on pages and refuses them on /api', () => {
    for (const bot of ['PerplexityBot', 'Claude-SearchBot', 'OAI-SearchBot', 'ChatGPT-User', 'Perplexity-User']) {
      expect(aiBotGate(bot, '/players/123')).toBe('limit');
      expect(aiBotGate(bot, '/sitemap.xml')).toBe('limit');
      expect(aiBotGate(bot, '/api/college/teams')).toBe('refuse');
      expect(aiBotGate(bot, '/api')).toBe('refuse');
      expect(aiBotGate(bot, '/robots.txt?x=1')).toBe('serve');
    }
    expect(aiBotGate('PerplexityBot', '/apis-of-the-week')).toBe('limit');
  });
});

describe('AiBotCounter', () => {
  it('batches counts and sends them once', async () => {
    const sent: any[] = [];
    const c = new AiBotCounter({ url: 'https://hub.test/api/seo/bot-hits', secret: 's'.repeat(40), post: async (_u, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; } });
    c.hit('GPTBot/1.1'); c.hit('GPTBot/1.1'); c.hit('PerplexityBot/1.0'); c.hit('Safari');
    expect(await c.flush()).toBe(2);
    expect(sent).toEqual([{ hits: [{ site: 'stats', bot: 'GPTBot', count: 2 }, { site: 'stats', bot: 'PerplexityBot', count: 1 }] }]);
    expect(await c.flush()).toBe(0);
  });
  it('does nothing without a hub url or secret, and survives a failing hub', async () => {
    expect(new AiBotCounter({ url: null, secret: null }).hit('GPTBot')).toBe('GPTBot');
    const errors: string[] = [];
    const c = new AiBotCounter({ url: 'https://hub.test', secret: 'x', post: async () => { throw new Error('down'); }, onError: (m) => errors.push(m) });
    c.hit('GPTBot');
    await c.flush();
    expect(errors).toEqual(['down']);
  });
});

describe('canonicalRedirect', () => {
  const pub = 'https://stats.example.com';
  it('moves page requests from onrender.com to the public domain, keeping path and query', () => {
    expect(canonicalRedirect(pub, 'plaibook-college-scraper.onrender.com', '/teams/duke/men?season=2025')).toBe('https://stats.example.com/teams/duke/men?season=2025');
    expect(canonicalRedirect(pub, 'plaibook-college-scraper.onrender.com', '/')).toBe('https://stats.example.com/');
  });
  it('leaves the API, health check, the public host itself and unset PUBLIC_URL alone', () => {
    expect(canonicalRedirect(pub, 'plaibook-college-scraper.onrender.com', '/api/v1/teams')).toBeNull();
    expect(canonicalRedirect(pub, 'plaibook-college-scraper.onrender.com', '/v1/teams')).toBeNull();
    expect(canonicalRedirect(pub, 'plaibook-college-scraper.onrender.com', '/health')).toBeNull();
    expect(canonicalRedirect(pub, 'stats.example.com', '/teams')).toBeNull();
    expect(canonicalRedirect(undefined, 'plaibook-college-scraper.onrender.com', '/teams')).toBeNull();
    expect(canonicalRedirect('https://plaibook-college-scraper.onrender.com', 'plaibook-college-scraper.onrender.com', '/teams')).toBeNull();
  });
});
