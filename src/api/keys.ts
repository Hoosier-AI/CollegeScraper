// API keys the console creates live in college_api_keys as sha256 hashes; the env list (COLLEGE_API_KEYS) still
// works. The store refreshes itself once a minute and batches last_used_at writes, so authentication never waits
// on the database.
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/client.js';
import { log } from '../log.js';

export interface StoredKey { id: string; name: string; key_hash: string; prefix: string; note: string | null; created_at: string; revoked_at: string | null; last_used_at: string | null }

export const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex');

/** A fresh key: `pk_` + 32 random bytes, base64url (43 chars). The prefix shown in the console is the first 10 chars. */
export function generateKey(): { key: string; prefix: string; hash: string } {
  const key = `pk_${randomBytes(32).toString('base64url')}`;
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}

export class KeyStore {
  private active = new Map<string, { name: string; id: string }>(); // hash → key
  private loadedAt = 0;
  private touched = new Map<string, string>(); // id → iso
  private timer: NodeJS.Timeout | null = null;
  constructor(private db: Db, private refreshMs = 60_000) {}

  async load(): Promise<void> {
    const { data, error } = await this.db.from('college_api_keys').select('id,name,key_hash').is('revoked_at', null);
    if (error) { log.warn({ err: error.message }, 'api keys load failed'); return; }
    this.active = new Map((data ?? []).map((r: any) => [r.key_hash, { name: r.name, id: r.id }]));
    this.loadedAt = Date.now();
  }

  /** The key's name when the token matches an active stored key, else null. Refreshes lazily. */
  lookup(token: string): string | null {
    if (Date.now() - this.loadedAt > this.refreshMs) void this.load();
    const hit = this.active.get(hashKey(token));
    if (!hit) return null;
    this.touched.set(hit.id, new Date().toISOString());
    return hit.name;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.flush(); }, this.refreshMs);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    const pending = [...this.touched]; this.touched.clear();
    for (const [id, at] of pending) await this.db.from('college_api_keys').update({ last_used_at: at }).eq('id', id).then(({ error }) => { if (error) log.warn({ err: error.message }, 'api key touch failed'); });
  }

  async list(): Promise<StoredKey[]> {
    const { data, error } = await this.db.from('college_api_keys').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as StoredKey[];
  }

  /** Creates a key and returns the plaintext once; it is never stored or shown again. */
  async create(name: string, note: string | null): Promise<{ key: string; row: StoredKey }> {
    const g = generateKey();
    const { data, error } = await this.db.from('college_api_keys').insert({ name, key_hash: g.hash, prefix: g.prefix, note }).select('*').single();
    if (error) throw new Error(error.message);
    await this.load();
    return { key: g.key, row: data as StoredKey };
  }

  async revoke(id: string): Promise<void> {
    const { error } = await this.db.from('college_api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null);
    if (error) throw new Error(error.message);
    await this.load();
  }
}
