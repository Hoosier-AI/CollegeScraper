// Verified Googlebot/Bingbot skip the site rate limiter: User-Agent and hostname rules, reverse + forward DNS
// with a mocked resolver (no real DNS in tests).
import { describe, it, expect } from 'vitest';
import { BotVerifier, claimedBot, hostnameMatches, type DnsLike } from '../src/seo/bots.js';

describe('search crawler verification', () => {
  it('recognises the crawlers by User-Agent', () => {
    expect(claimedBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe('google');
    expect(claimedBot('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe('bing');
    expect(claimedBot('Mozilla/5.0 (Macintosh) Safari/605')).toBeNull();
    expect(claimedBot(undefined)).toBeNull();
  });
  it('matches only the documented hostnames', () => {
    expect(hostnameMatches('google', 'crawl-66-249-66-1.googlebot.com')).toBe(true);
    expect(hostnameMatches('google', 'rate-limited-proxy-66-249-90-77.google.com.')).toBe(true);
    expect(hostnameMatches('google', 'googlebot.com.evil.net')).toBe(false);
    expect(hostnameMatches('google', 'evilgooglebot.com')).toBe(false);
    expect(hostnameMatches('bing', 'msnbot-157-55-39-1.search.msn.com')).toBe(true);
    expect(hostnameMatches('bing', 'crawl.googlebot.com')).toBe(false);
  });

  const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
  const dns = (rev: Record<string, string[]>, fwd: Record<string, string[]>): DnsLike & { calls: number } => {
    const d = { calls: 0, reverse: async (ip: string) => { d.calls += 1; if (!rev[ip]) throw new Error('ENOTFOUND'); return rev[ip]!; }, lookup: async (h: string) => fwd[h] ?? [] };
    return d;
  };
  it('needs reverse and forward DNS to agree, and caches the answer', async () => {
    const d = dns({ '66.249.66.1': ['crawl-66-249-66-1.googlebot.com'] }, { 'crawl-66-249-66-1.googlebot.com': ['66.249.66.1'] });
    const v = new BotVerifier(d);
    expect(await v.isVerified('66.249.66.1', UA)).toBe(true);
    expect(await v.isVerified('::ffff:66.249.66.1', UA)).toBe(true);
    expect(d.calls).toBe(1);
  });
  it('rejects forged User-Agents, foreign hostnames, mismatched forward lookups and DNS failures', async () => {
    const d = dns(
      { '1.2.3.4': ['host.example.net'], '5.6.7.8': ['crawl-5-6-7-8.googlebot.com'] },
      { 'crawl-5-6-7-8.googlebot.com': ['66.249.66.9'] },
    );
    const v = new BotVerifier(d);
    expect(await v.isVerified('66.249.66.1', 'curl/8.0')).toBe(false);
    expect(d.calls).toBe(0); // no DNS for requests that do not claim to be a crawler
    expect(await v.isVerified('1.2.3.4', UA)).toBe(false);
    expect(await v.isVerified('5.6.7.8', UA)).toBe(false);
    expect(await v.isVerified('9.9.9.9', UA)).toBe(false);
  });
  it('times out a slow resolver', async () => {
    const slow: DnsLike = { reverse: () => new Promise(() => {}), lookup: async () => [] };
    const v = new BotVerifier(slow, { timeoutMs: 20 });
    expect(await v.isVerified('66.249.66.1', UA)).toBe(false);
  });
});
