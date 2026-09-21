import { describe, it, expect } from 'vitest';
import { generateKey, hashKey } from '../../src/api/keys.js';
import { makeAuthenticator } from '../../src/api/auth.js';
import { UsageMeter } from '../../src/api/usage.js';

describe('api keys', () => {
  it('generates a pk_ key whose stored form is a hash', () => {
    const g = generateKey();
    expect(g.key).toMatch(/^pk_[A-Za-z0-9_-]{43}$/);
    expect(g.prefix).toBe(g.key.slice(0, 10));
    expect(g.hash).toBe(hashKey(g.key));
    expect(g.hash).not.toContain(g.key.slice(3, 20));
  });
  it('the authenticator falls back to the store after the env keys', () => {
    const auth = makeAuthenticator({ adminSecret: 'admin-secret-1234567', keys: [{ name: 'plaibook', key: 'plaibook-key-1234567' }], lookup: (t) => (t === 'stored-key' ? 'partner' : null) });
    expect(auth('admin-secret-1234567')).toEqual({ kind: 'admin', name: 'admin' });
    expect(auth('plaibook-key-1234567')).toEqual({ kind: 'key', name: 'plaibook' });
    expect(auth('stored-key')).toEqual({ kind: 'key', name: 'partner' });
    expect(auth('nope')).toBeNull();
  });
});

describe('usage meter', () => {
  it('accumulates per day and principal, including limited hits', () => {
    const m = new UsageMeter(null);
    const t = Date.parse('2026-09-21T10:00:00Z');
    m.hit('plaibook', false, t); m.hit('plaibook', true, t + 1000); m.hit('anon', false, t); m.hit('anon', false, t + 86400_000);
    expect(m.pending().sort((a, b) => a.principal.localeCompare(b.principal) || a.day.localeCompare(b.day))).toEqual([
      { day: '2026-09-21', principal: 'anon', requests: 1, limited: 0, seen: '2026-09-21T10:00:00.000Z' },
      { day: '2026-09-22', principal: 'anon', requests: 1, limited: 0, seen: '2026-09-22T10:00:00.000Z' },
      { day: '2026-09-21', principal: 'plaibook', requests: 2, limited: 1, seen: '2026-09-21T10:00:01.000Z' },
    ]);
  });
});
