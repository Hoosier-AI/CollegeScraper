import { describe, expect, it } from 'vitest';
import { AnalyticsMeter, deviceOf, normalizePath, normalizeQuery, pageKind, referrerHost } from '../src/api/analytics.js';
import { isBot } from '../src/pro/onView.js';
import { attentionFrom, type AttentionInput } from '../src/ops/insights.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';

describe('page templates', () => {
  it('normalises addresses and skips the owner pages', () => {
    expect(normalizePath('/Pro/Players/Christian-Pulisic-123/?tab=stats#x')).toBe('/pro/players/christian-pulisic-123');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('/console')).toBeNull();
    expect(normalizePath('/admin/x')).toBeNull();
    expect(normalizePath('https://evil.example/x')).toBeNull();
    expect(normalizePath('/' + 'a'.repeat(200))).toBeNull();
  });
  it('knows every page type of the viewer', () => {
    expect(pageKind('/')).toMatchObject({ group: 'Home', section: 'other', keep: true });
    expect(pageKind('/pro/matches')).toMatchObject({ group: 'Pro matches', section: 'pro' });
    expect(pageKind('/teams/indiana/m')).toMatchObject({ group: 'College team' });
    expect(pageKind('/teams/0b6c1f9e-0000-4000-8000-000000000000')).toMatchObject({ group: 'College team' });
    expect(pageKind('/pro/players/christian-pulisic')).toMatchObject({ group: 'Pro player', section: 'pro' });
    expect(pageKind('/pro/abroad')).toMatchObject({ group: 'Americans abroad', section: 'pro' });
    expect(pageKind('/wp-login.php')).toMatchObject({ group: 'Other', keep: false });
  });
});

describe('devices, referrers, bots, queries', () => {
  it('classifies devices', () => {
    expect(deviceOf(IPHONE)).toBe('mobile');
    expect(deviceOf(IPAD)).toBe('tablet');
    expect(deviceOf(ANDROID_TAB)).toBe('tablet');
    expect(deviceOf(MAC)).toBe('desktop');
    expect(deviceOf(undefined)).toBe('desktop');
  });
  it('keeps the referring host only, and folds the big sites', () => {
    const own = ['plaibook.live'];
    expect(referrerHost('https://www.google.com/search?q=x', own)).toBe('google');
    expect(referrerHost('https://news.google.co.uk/', own)).toBe('google');
    expect(referrerHost('https://l.facebook.com/l.php?u=x', own)).toBe('facebook');
    expect(referrerHost('https://t.co/abc', own)).toBe('x');
    expect(referrerHost('https://www.plaibook.live/pro', own)).toBeNull();
    expect(referrerHost('https://www.topdrawersoccer.com/x', own)).toBe('topdrawersoccer.com');
    expect(referrerHost('not a url', own)).toBeNull();
  });
  it('leaves bots out', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBot('GPTBot/1.0')).toBe(true);
    expect(isBot(undefined)).toBe(true);
    expect(isBot(IPHONE)).toBe(false);
  });
  it('normalises searches', () => {
    expect(normalizeQuery('  Christian   PULISIC ')).toBe('christian pulisic');
    expect(normalizeQuery('a')).toBeNull();
  });
});

describe('AnalyticsMeter', () => {
  it('counts views per page, visitors once a day, referrers and devices', () => {
    const m = new AnalyticsMeter(null, ['plaibook.live']);
    const t = Date.parse('2026-10-13T12:00:00Z');
    expect(m.view({ path: '/pro/matches', ref: 'https://www.google.com/', ua: IPHONE, ip: '1.1.1.1' }, t)).toBe(true);
    m.view({ path: '/pro/players/christian-pulisic', ua: IPHONE, ip: '1.1.1.1' }, t + 1000);
    m.view({ path: '/pro/matches', ua: MAC, ip: '2.2.2.2' }, t + 2000);
    m.view({ path: '/wp-login.php', ua: MAC, ip: '2.2.2.2' }, t + 3000);
    expect(m.view({ path: '/console', ua: MAC, ip: '2.2.2.2' }, t + 4000)).toBe(false);
    const p = m.pending();
    expect(p.views).toContainEqual({ day: '2026-10-13', path: '/pro/matches', group: 'Pro matches', n: 2 });
    expect(p.views).toContainEqual({ day: '2026-10-13', path: '(other)', group: 'Other', n: 1 });
    expect(p.visitors.map((v) => ({ day: v.day, uniques: v.who.length, views: v.views }))).toEqual([{ day: '2026-10-13', uniques: 2, views: 4 }]);
    expect(p.refs).toEqual([{ day: '2026-10-13', host: 'google', n: 1 }]);
    expect(p.devices).toContainEqual({ day: '2026-10-13', device: 'mobile', n: 2 });
    // Nothing that identifies a visitor leaves the meter.
    expect(JSON.stringify(p)).not.toMatch(/1\.1\.1\.1|iPhone|Macintosh/);
  });
  it('counts a visitor again on a new day', () => {
    const m = new AnalyticsMeter(null);
    m.view({ path: '/', ua: MAC, ip: '3.3.3.3' }, Date.parse('2026-10-13T23:59:00Z'));
    m.view({ path: '/', ua: MAC, ip: '3.3.3.3' }, Date.parse('2026-10-14T00:01:00Z'));
    expect(m.pending().visitors.map((v) => v.who.length)).toEqual([1, 1]);
  });
  it('a visitor has the same code across restarts on a day (same secret), a different one the next day', () => {
    const a = new AnalyticsMeter(null, [], 60_000, 's3cret'); const b = new AnalyticsMeter(null, [], 60_000, 's3cret');
    expect(a.codeOf('2026-10-20', '4.4.4.4', MAC)).toBe(b.codeOf('2026-10-20', '4.4.4.4', MAC));
    expect(a.codeOf('2026-10-20', '4.4.4.4', MAC)).not.toBe(a.codeOf('2026-10-21', '4.4.4.4', MAC));
    expect(a.codeOf('2026-10-20', '4.4.4.4', MAC)).not.toMatch(/4\.4\.4\.4/);
  });
  it('counts searches and the ones that found nothing', () => {
    const m = new AnalyticsMeter(null);
    const t = Date.parse('2026-10-13T12:00:00Z');
    m.search('pro', 'Pulisic', 3, t); m.search('pro', 'pulisic ', 3, t); m.search('college', 'zzzz', 0, t);
    expect(m.search('pro', 'x', 0, t)).toBe(false);
    expect(m.pending().searches).toEqual([
      { day: '2026-10-13', scope: 'pro', query: 'pulisic', n: 2, zero: 0 },
      { day: '2026-10-13', scope: 'college', query: 'zzzz', n: 1, zero: 1 },
    ]);
  });
});

describe('attention rules', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const base = (): AttentionInput => ({
    now, health: { ok: true, problems: [], lanes: {} },
    scheduler: { enabled: true, paused: false, tick_at: iso(30_000), entries: [{ job: 'nightly', label: 'Nightly crawl', enabled: true, next: iso(-3600_000) }] },
    rollup: { nightly: { last_done: { finished_at: iso(3600_000) }, last_failed: null, queued: 0, running: 0 }, live: { last_done: { finished_at: iso(60_000) }, last_failed: null, queued: 0, running: 0 } },
    crawl_paused: false, running: [],
    quota: { key_set: true, remaining: 90_000, limit: 150_000, blocked_until: null, floor: 1500 },
    live: { games_live: 0, with_fresh_stats: 0 }, quality: [], sources: [], deploy: { status: 'live', commit: 'abc1234', at: iso(60_000) },
    traffic: { views_7d: 100, views_prev_7d: 100, zero_searches_7d: 0 },
  });
  it('is quiet when all is well', () => { expect(attentionFrom(base())).toEqual([]); });
  it('warns when live US matches have no events after 15 minutes', () => {
    const i = base(); i.pro_live_stale = { count: 2, live: 5, names: ['real salt lake vs san jose earthquakes', 'la galaxy vs portland timbers'] };
    expect(attentionFrom(i).map((a) => a.id)).toEqual(['pro:live-detail']);
    i.pro_live_stale = { count: 0, live: 5, names: [] };
    expect(attentionFrom(i)).toEqual([]);
  });
  it('warns when a stat check falls below its target, with enough compared', () => {
    const i = base(); i.audits = [
      { check_key: 'ncaa:Total Assists', label: 'Players: Total Assists vs NCAA.com', rate: 0.82, target: 0.88, compared: 1500 },
      { check_key: 'ncaa:Total Goals', label: 'Players: Total Goals vs NCAA.com', rate: 0.96, target: 0.95, compared: 1500 },
      { check_key: 'pro-us:asa_goals', label: 'Pro US: goals vs ASA', rate: 0.5, target: 0.9, compared: 4 },
    ];
    const out = attentionFrom(i);
    expect(out.map((a) => a.id)).toEqual(['audit:ncaa:Total Assists']);
    expect(out[0]!.detail).toContain('82.0% agree of 1,500');
  });
  it('warns when the heap is near its limit', () => {
    const i = base(); i.memory = { heap_mb: 600, heap_limit_mb: 1100 };
    expect(attentionFrom(i)).toEqual([]);
    i.memory = { heap_mb: 1000, heap_limit_mb: 1100 };
    expect(attentionFrom(i)).toEqual([expect.objectContaining({ id: 'health:memory', level: 'warn', href: '/stats/service#health' })]);
  });
  it('flags computed data left behind its cadence, in season, unless switched off or never run', () => {
    const i = base(); // 2026-10-13: in season
    i.rollup['college-sims'] = { last_done: { finished_at: iso(7 * 3600_000) }, last_failed: null, queued: 0, running: 0 };
    i.rollup['college-elo'] = { last_done: { finished_at: iso(20 * 3600_000) }, last_failed: null, queued: 0, running: 0 };
    i.rollup['pro-leaders'] = { last_done: { finished_at: iso(5 * 3600_000) }, last_failed: null, queued: 0, running: 0 };
    i.scheduler.entries.push({ job: 'pro-leaders', label: 'Pro leaders', enabled: false, next: null });
    const out = attentionFrom(i);
    expect(out.map((a) => a.id)).toEqual(['computed:stale:college-sims']);
    expect(out[0]!.detail).toBe('Last worked 7 h ago; it runs every 3 h.');
    // Out of season the in-season-only jobs rest; the sims run daily.
    const off = base(); off.now = Date.parse('2026-03-01T12:00:00Z');
    off.rollup['college-ratings'] = { last_done: { finished_at: new Date(off.now - 30 * 86400_000).toISOString() }, last_failed: null, queued: 0, running: 0 };
    off.scheduler.tick_at = new Date(off.now - 30_000).toISOString(); off.scheduler.entries[0]!.next = new Date(off.now + 3600_000).toISOString();
    off.rollup.nightly!.last_done = { finished_at: new Date(off.now - 3600_000).toISOString() };
    off.deploy!.at = new Date(off.now).toISOString();
    expect(attentionFrom(off).map((a) => a.id)).toEqual([]);
  });
  it('sends open requests and stale live stats to the right hub tab', () => {
    const i = base(); i.requests = { open: 2, oldest: iso(3600_000), removal: 1 };
    i.live = { games_live: 4, with_fresh_stats: 0 };
    const out = attentionFrom(i);
    expect(out.find((a) => a.id === 'requests:open')).toMatchObject({ level: 'warn', href: '/stats/requests' });
    expect(out.find((a) => a.id === 'live:stale')!.href).toBe('/stats/crawling?part=college');
  });
  it('flags a failed job, an overdue job and a stalled scheduler, worst first', () => {
    const i = base();
    i.rollup.nightly = { last_done: { finished_at: iso(2 * 86400_000) }, last_failed: { finished_at: iso(3600_000), error: 'boom' }, queued: 0, running: 0 };
    i.scheduler.entries.push({ job: 'weekly', label: 'Weekly', enabled: true, next: iso(2 * 3600_000) });
    i.scheduler.tick_at = iso(20 * 60_000);
    const ids = attentionFrom(i).map((a) => a.id);
    expect(ids[0]).toBe('scheduler:stalled');
    expect(ids).toContain('job:failed:nightly');
    expect(ids).toContain('job:overdue:weekly');
  });
  it('does not call a job overdue while it is queued or running, or while paused', () => {
    const i = base();
    i.scheduler.entries[0]!.next = iso(2 * 3600_000);
    i.rollup.nightly!.running = 1;
    expect(attentionFrom(i).map((a) => a.id)).not.toContain('job:overdue:nightly');
    i.rollup.nightly!.running = 0; i.scheduler.paused = true;
    expect(attentionFrom(i).map((a) => a.id)).toEqual(['scheduler:paused']);
  });
  it('flags the quota, a failed deploy, stale live games, quality jumps, traffic drops and empty searches', () => {
    const i = base();
    i.quota!.remaining = 900;
    i.deploy = { status: 'build_failed', commit: 'abcdef1234', at: iso(60_000) };
    i.live = { games_live: 4, with_fresh_stats: 0 };
    i.quality = [{ id: 'no_box', label: 'Finals without box score', count: 140, previous: 100 }, { id: 'small', count: 3, previous: 1 }];
    i.traffic = { views_7d: 40, views_prev_7d: 100, zero_searches_7d: 7 };
    i.sources = [{ source: 'asa', league: 'MLS', season: 2025, rate: 0.8, compared: 200 }, { source: 'asa', league: 'NWSL', season: 2025, rate: 0.5, compared: 3 }];
    const got = attentionFrom(i);
    const ids = got.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['deploy', 'quota:floor', 'live:stale', 'quality:no_box', 'traffic:drop', 'search:zero', 'sources:disagree']));
    expect(ids).not.toContain('quality:small');
    expect(got.find((a) => a.id === 'sources:disagree')!.title).toMatch(/^1 source season/);
    expect(got[0]!.level).toBe('error');
  });
  it('folds dead lanes into one item and tells cut-off runs from stalled ones', () => {
    const i = base();
    i.health = { ok: false, problems: ['crawl worker heartbeat 900s old', 'live worker heartbeat missing'], lanes: { crawl: {} as any, live: {} as any, aux: {} as any } };
    i.running = [{ id: 'a', job: 'backfill', heartbeat_at: iso(4 * 3600_000) }, { id: 'b', job: 'backfill', heartbeat_at: iso(30_000) }, { id: 'c', job: 'weekly', heartbeat_at: iso(3600_000) }];
    const got = attentionFrom(i);
    expect(got.filter((a) => a.id.startsWith('health'))).toEqual([expect.objectContaining({ id: 'health:lanes', title: '2 of 3 worker lanes not running', detail: 'crawl, live' })]);
    expect(got.find((a) => a.id === 'runs:waiting:backfill')).toMatchObject({ level: 'info', title: '1 backfill run waiting to resume' });
    expect(got.find((a) => a.id === 'runs:stalled:weekly')).toMatchObject({ level: 'warn' });
  });
  it('flags live scores that stopped, and ignores schools without live stats', () => {
    const i = base();
    i.live = { games_live: 15, with_fresh_stats: 4 };
    expect(attentionFrom(i)).toEqual([]);
    i.rollup.live!.last_done = { finished_at: iso(20 * 60_000) };
    expect(attentionFrom(i).map((a) => a.id)).toEqual(['live:stopped']);
  });
  it('flags news sources that keep failing, and school feeds only at scale', () => {
    const i = base();
    i.news = [{ kind: 'publisher', name: 'ESPN', on: 1, failing: 1 }, { kind: 'school', name: 'School', on: 1500, failing: 40 }];
    expect(attentionFrom(i).map((a) => a.id)).toEqual(['news:publisher']);
    i.news = [{ kind: 'school', name: 'School', on: 1500, failing: 400 }];
    expect(attentionFrom(i)[0]).toMatchObject({ id: 'news:schools', title: '400 of 1500 school news feeds failing' });
  });
  it('reports a block instead of the floor', () => {
    const i = base();
    i.quota = { ...i.quota!, remaining: 0, blocked_until: iso(-3600_000) };
    expect(attentionFrom(i).map((a) => a.id)).toEqual(['quota:blocked']);
  });
});
