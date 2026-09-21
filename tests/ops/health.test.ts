import { describe, it, expect } from 'vitest';
import { evaluateHealth } from '../../src/ops/health.js';

const now = Date.parse('2026-09-21T23:00:00Z');
const hb = (agoS: number) => ({ at: new Date(now - agoS * 1000).toISOString(), pid: 1, host: 'h', run_id: null, job: null, started_at: '' });

describe('evaluateHealth', () => {
  it('is healthy with a fresh heartbeat per lane and a reachable database', () => {
    expect(evaluateHealth({ now, startedAt: now - 600_000, dbOk: true, dbLastOkAt: now, heartbeats: { crawl: hb(10), live: hb(40) }, lanes: ['crawl', 'live'] })).toMatchObject({ ok: true, problems: [] });
  });
  it('fails on a stale lane after the boot grace', () => {
    const h = evaluateHealth({ now, startedAt: now - 600_000, dbOk: true, dbLastOkAt: now, heartbeats: { crawl: hb(200), live: null }, lanes: ['crawl', 'live'] });
    expect(h.ok).toBe(false);
    expect(h.problems).toEqual(['crawl worker heartbeat 200s old', 'live worker heartbeat missing']);
  });
  it('tolerates missing heartbeats while booting and a brief database blip', () => {
    expect(evaluateHealth({ now, startedAt: now - 30_000, dbOk: true, dbLastOkAt: now, heartbeats: { crawl: null, live: null }, lanes: ['crawl', 'live'] }).ok).toBe(true);
    expect(evaluateHealth({ now, startedAt: now - 600_000, dbOk: false, dbLastOkAt: now - 30_000, heartbeats: { crawl: hb(5), live: hb(5) }, lanes: ['crawl', 'live'] }).ok).toBe(true);
    expect(evaluateHealth({ now, startedAt: now - 600_000, dbOk: false, dbLastOkAt: now - 300_000, heartbeats: { crawl: hb(5), live: hb(5) }, lanes: ['crawl', 'live'] }).problems).toContain('database unreachable');
  });
});
