import { describe, expect, it } from 'vitest';
import { MAX_CRAWL_DELAY_MS, parseRobots, RobotsCache, UNREACHABLE_RETRY_MS } from '../src/http/robots.js';

const UA = 'Mozilla/5.0 PlaibookCollege/1.0';
const fake = (status: number, body = '', throws = false, type = 'text/html') => {
  let calls = 0;
  const f = (async () => { calls++; if (throws) throw new Error('down'); return { ok: status < 400, status, headers: new Headers({ 'content-type': type }), text: async () => body }; }) as any;
  return { f, calls: () => calls };
};

describe('robots.txt', () => {
  it('reads Crawl-delay for our group, capped', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: 3\nDisallow: /x', UA).delayMs).toBe(3000);
    expect(parseRobots('User-agent: *\nCrawl-delay: 60', UA).delayMs).toBe(MAX_CRAWL_DELAY_MS);
    expect(parseRobots('User-agent: *\nDisallow:', UA).delayMs).toBeUndefined();
  });
  it('a missing robots.txt allows everything', async () => {
    const r = new RobotsCache(UA, fake(404).f);
    expect(await r.allowed('https://a.example/page')).toBe(true);
  });
  it('an unreachable robots.txt keeps the site off-limits for a while, then is read again', async () => {
    let now = 1_000_000;
    const down = fake(503);
    const r = new RobotsCache(UA, down.f, () => now);
    expect(await r.allowed('https://a.example/page')).toBe(false);
    expect(await r.allowed('https://a.example/other')).toBe(false);
    expect(down.calls()).toBe(1);
    now += UNREACHABLE_RETRY_MS + 1;
    expect(await r.allowed('https://a.example/page')).toBe(false);
    expect(down.calls()).toBe(2);
    const err = new RobotsCache(UA, fake(0, '', true).f);
    expect(await err.allowed('https://b.example/')).toBe(false);
  });
  it('an API host answering robots.txt with a JSON error has no robots.txt (NCAA sdataprod)', async () => {
    const r = new RobotsCache(UA, fake(500, '{"errors":[]}', false, 'application/json; charset=utf-8').f);
    expect(await r.allowed('https://sdataprod.example/?extensions=x')).toBe(true);
  });
  it('gives the delay once the file has been read', async () => {
    const r = new RobotsCache(UA, fake(200, 'User-agent: *\nCrawl-delay: 2').f);
    expect(r.crawlDelayMs('https://c.example/x')).toBeUndefined();
    await r.allowed('https://c.example/x');
    expect(r.crawlDelayMs('https://c.example/y')).toBe(2000);
  });
});
