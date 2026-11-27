import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Http2Server } from 'node:http2';
import { generateKeyPairSync, verify } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { ApnsClient, apnsBody, classify, collapseId, providerToken, readP8, type ApnsNotification } from '../../src/push/apns.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const cfg = { keyP8: p8, keyId: 'ABC123DEFG', teamId: 'TEAM123456', bundleId: 'live.plaibook.app' };
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());
const note: ApnsNotification = { title: 'Goal', body: 'Home FC 1-0 Away FC', matchKey: 'p:1001', to: '/pro/matches/home-fc-away-fc', expiresAt: 1_800_000_000 };

describe('provider token', () => {
  it('is an ES256 JWT with kid, iss and iat, signed with the key', () => {
    const now = Date.parse('2026-11-28T20:00:00Z');
    const jwt = providerToken(cfg, readP8(p8), now);
    const [head, claims, sig] = jwt.split('.');
    expect(decode(head!)).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(decode(claims!)).toEqual({ iss: 'TEAM123456', iat: Math.floor(now / 1000) });
    const raw = Buffer.from(sig!, 'base64url');
    expect(raw).toHaveLength(64); // r and s, 32 bytes each (not DER)
    expect(verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw)).toBe(true);
    expect(verify('sha256', Buffer.from(`${head}.${claims}x`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw)).toBe(false);
  });
  it('reads a key written on one line with \\n, or as bare base64', () => {
    expect(readP8(p8.replace(/\n/g, '\\n')).asymmetricKeyType).toBe('ec');
    expect(readP8(p8.replace(/-----[A-Z ]+-----/g, '').trim()).asymmetricKeyType).toBe('ec');
  });
  it('is reused for 50 minutes, then made again', () => {
    const c = new ApnsClient(cfg);
    const t0 = Date.parse('2026-11-28T20:00:00Z');
    const first = c.bearer(t0);
    expect(c.bearer(t0 + 49 * 60_000)).toBe(first);
    const second = c.bearer(t0 + 51 * 60_000);
    expect(second).not.toBe(first);
    expect(decode(second.split('.')[1]!).iat).toBe(Math.floor((t0 + 51 * 60_000) / 1000));
  });
});

describe('what Apple\'s answer means', () => {
  it('ok, gone, retry, other', () => {
    expect(classify(200, '')).toEqual({ kind: 'ok', status: 200 });
    expect(classify(410, 'Unregistered').kind).toBe('gone');
    expect(classify(400, 'BadDeviceToken').kind).toBe('gone');
    expect(classify(400, 'BadCollapseId').kind).toBe('other');
    expect(classify(400, 'DeviceTokenNotForTopic').kind).toBe('other');
    expect(classify(403, 'InvalidProviderToken').kind).toBe('other');
    expect(classify(403, 'ExpiredProviderToken').kind).toBe('retry');
    expect(classify(429, 'TooManyRequests').kind).toBe('retry');
    expect(classify(500, 'InternalServerError').kind).toBe('retry');
    expect(classify(503, 'ServiceUnavailable').kind).toBe('retry');
  });
  it('the body and the collapse id', () => {
    expect(apnsBody(note)).toEqual({ aps: { alert: { title: 'Goal', body: 'Home FC 1-0 Away FC' }, sound: 'default', 'thread-id': 'p:1001' }, to: '/pro/matches/home-fc-away-fc' });
    expect(apnsBody({ ...note, passive: true })).toEqual({ aps: { alert: { title: 'Goal', body: 'Home FC 1-0 Away FC' }, 'thread-id': 'p:1001', 'interruption-level': 'passive' }, to: '/pro/matches/home-fc-away-fc' });
    expect(collapseId('c:7f0c2a9e-0000-4000-8000-000000000001')).toBe('c:7f0c2a9e-0000-4000-8000-000000000001');
    expect(Buffer.byteLength(collapseId('p:' + 'é'.repeat(60)))).toBeLessThanOrEqual(64);
  });
});

describe('sender against a local http2 server', () => {
  let server: Http2Server; let host = '';
  const seen: Array<{ headers: Record<string, any>; body: any }> = [];
  beforeAll(async () => {
    server = createServer();
    server.on('stream', (stream, headers) => {
      let text = '';
      stream.setEncoding('utf8');
      stream.on('data', (c) => { text += c; });
      stream.on('end', () => {
        seen.push({ headers: { ...headers }, body: JSON.parse(text || 'null') });
        const path = String(headers[':path']);
        if (path.endsWith('/gone')) { stream.respond({ ':status': 410, 'content-type': 'application/json' }); stream.end(JSON.stringify({ reason: 'Unregistered', timestamp: 1 })); }
        else if (path.endsWith('/busy')) { stream.respond({ ':status': 429, 'content-type': 'application/json' }); stream.end(JSON.stringify({ reason: 'TooManyRequests' })); }
        else if (path.endsWith('/wrongenv')) { stream.respond({ ':status': 400, 'content-type': 'application/json' }); stream.end(JSON.stringify({ reason: 'BadDeviceToken' })); }
        else { stream.respond({ ':status': 200 }); stream.end(); }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('200 is ok, with the headers and body Apple expects', async () => {
    const c = new ApnsClient(cfg, { hosts: { production: host, sandbox: host } });
    expect(await c.send('production', 'abc123', note)).toEqual({ kind: 'ok', status: 200 });
    const got = seen[seen.length - 1]!;
    expect(got.headers[':method']).toBe('POST');
    expect(got.headers[':path']).toBe('/3/device/abc123');
    expect(got.headers['apns-topic']).toBe('live.plaibook.app');
    expect(got.headers['apns-push-type']).toBe('alert');
    expect(got.headers['apns-priority']).toBe('10');
    expect(got.headers['apns-collapse-id']).toBe('p:1001');
    expect(got.headers['apns-expiration']).toBe('1800000000');
    const [head, claims, sig] = String(got.headers.authorization).replace(/^bearer /, '').split('.');
    expect(String(got.headers.authorization)).toMatch(/^bearer /);
    expect(verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url'))).toBe(true);
    expect(got.body).toEqual(apnsBody(note));
    c.close();
  });
  it('410 and a bad device token are gone; 429 is retry', async () => {
    const c = new ApnsClient(cfg, { hosts: { production: host, sandbox: host } });
    expect(await c.send('production', 'gone', note)).toEqual({ kind: 'gone', status: 410, reason: 'Unregistered' });
    expect(await c.send('sandbox', 'wrongenv', note)).toEqual({ kind: 'gone', status: 400, reason: 'BadDeviceToken' });
    expect(await c.send('production', 'busy', note)).toEqual({ kind: 'retry', status: 429, reason: 'TooManyRequests' });
    c.close();
  });
  it('many at once share one session', async () => {
    const c = new ApnsClient(cfg, { hosts: { production: host } });
    const before = seen.length;
    const out = await Promise.all(Array.from({ length: 30 }, (_, i) => c.send('production', `tok${i}`, note)));
    expect(out.every((r) => r.kind === 'ok')).toBe(true);
    expect(seen.length - before).toBe(30);
    c.close();
  });
  it('a host that is down is a retry, not a throw; an unreadable key is ours to fix', async () => {
    const down = new ApnsClient(cfg, { hosts: { production: 'http://127.0.0.1:1' } });
    expect((await down.send('production', 'abc', note)).kind).toBe('retry');
    down.close();
    const badKey = new ApnsClient({ ...cfg, keyP8: 'not a key' }, { hosts: { production: host } });
    const r = await badKey.send('production', 'abc', note);
    expect(r.kind).toBe('other');
    badKey.close();
  });
});
