import { describe, it, expect } from 'vitest';
import { parseApiKeys, makeAuthenticator, bearerOf, RateLimiter } from '../../src/api/auth.js';

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
  it('rate limits per principal', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.take('a', 0).ok).toBe(true); expect(rl.take('a', 1).ok).toBe(true); expect(rl.take('a', 2).ok).toBe(true);
    const fourth = rl.take('a', 3); expect(fourth.ok).toBe(false); expect(fourth.resetMs).toBeGreaterThan(0);
    expect(rl.take('b', 3).ok).toBe(true);
    expect(rl.take('a', 1001).ok).toBe(true);
  });
});
