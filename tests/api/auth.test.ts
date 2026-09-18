import { describe, it, expect } from 'vitest';
import { parseApiKeys, makeAuthenticator, bearerOf, RateLimiter, anonPrincipal } from '../../src/api/auth.js';

describe('api keys', () => {
  it('parses name:key pairs and ignores junk', () => {
    expect(parseApiKeys('plaibook:0123456789abcdef0123, bad, :nokey, short:abc')).toEqual([{ name: 'plaibook', key: '0123456789abcdef0123' }]);
    expect(parseApiKeys(undefined)).toEqual([]);
  });
  it('authenticates keys and the admin secret in constant time', () => {
    const auth = makeAuthenticator({ adminSecret: 'admin-secret-1', keys: parseApiKeys('plaibook:0123456789abcdef0123') });
    expect(auth('0123456789abcdef0123')).toEqual({ kind: 'key', name: 'plaibook' });
    expect(auth('admin-secret-1')).toEqual({ kind: 'admin', name: 'admin' });
    expect(auth('0123456789abcdef0124')).toBeNull();
    expect(auth('')).toBeNull();
    expect(auth(null)).toBeNull();
  });
  it('reads bearer and x-api-key headers', () => {
    expect(bearerOf({ authorization: 'Bearer abc' })).toBe('abc');
    expect(bearerOf({ 'x-api-key': 'xyz' })).toBe('xyz');
    expect(bearerOf({})).toBeNull();
  });
  it('buckets anonymous callers by ip', () => {
    expect(anonPrincipal('203.0.113.9')).toEqual({ kind: 'anon', name: 'ip:203.0.113.9' });
    expect(anonPrincipal(undefined)).toEqual({ kind: 'anon', name: 'ip:unknown' });
  });
  it('rate limits per principal', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.take('a', 0).ok).toBe(true); expect(rl.take('a', 1).ok).toBe(true); expect(rl.take('a', 2).ok).toBe(true);
    const fourth = rl.take('a', 3); expect(fourth.ok).toBe(false); expect(fourth.resetMs).toBeGreaterThan(0);
    expect(rl.take('b', 3).ok).toBe(true);
    expect(rl.take('a', 1001).ok).toBe(true);
  });
  it('drops cold buckets so anonymous ip keys cannot grow without bound', () => {
    const rl = new RateLimiter(10, 1000);
    for (let i = 0; i < 500; i++) rl.take(`ip:10.0.0.${i}`, 0);
    expect(rl.size).toBe(500);
    // One call a window later sweeps everything that has gone quiet.
    rl.take('ip:10.0.0.0', 5000);
    expect(rl.size).toBe(1);
  });
});
