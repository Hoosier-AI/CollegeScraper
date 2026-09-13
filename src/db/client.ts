import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadConfig, assertWritable, type Config } from '../config.js';
import type { FetchCacheStore, FetchRecord } from '../http/client.js';
import { log } from '../log.js';

export type Db = SupabaseClient<any, 'public', any>;

let client: Db | null = null;

export function getDb(cfg: Config = loadConfig()): Db {
  if (client) return client;
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required');
  assertWritable(cfg);
  client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-client-info': 'plaibook-college-scraper' } },
  });
  log.info({ host: new URL(cfg.SUPABASE_URL).host }, 'database target');
  return client;
}

export function setDb(db: Db | null): void { client = db; }

export interface UpsertOptions { onConflict: string; ignoreDuplicates?: boolean; chunk?: number }

/** Upsert rows in chunks; throws on the first failed chunk with the PostgREST message. */
export async function upsertChunked<T extends Record<string, unknown>>(db: Db, table: string, rows: T[], opts: UpsertOptions): Promise<number> {
  const size = opts.chunk ?? 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await db.from(table).upsert(chunk as any[], { onConflict: opts.onConflict, ignoreDuplicates: opts.ignoreDuplicates ?? false });
    if (error) throw new Error(`upsert ${table} failed: ${error.message} (${error.details ?? ''})`);
    written += chunk.length;
  }
  return written;
}

/** Select all rows matching a filter, paging past PostgREST's 1000-row default. */
export async function selectAll<T>(db: Db, table: string, columns: string, apply?: (q: any) => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    let q = db.from(table).select(columns).range(from, from + pageSize - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`select ${table} failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export async function kvGet<T = unknown>(db: Db, key: string): Promise<T | null> {
  const { data, error } = await db.from('college_kv').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(`kv get ${key}: ${error.message}`);
  return (data?.value as T) ?? null;
}

export async function kvSet(db: Db, key: string, value: unknown): Promise<void> {
  const { error } = await db.from('college_kv').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(`kv set ${key}: ${error.message}`);
}

/** Fetch cache backed by college_source_fetches. HTML/JSON bodies are stored so re-runs can replay without network. */
export class DbFetchCache implements FetchCacheStore {
  constructor(private db: Db, private storeBodies = true) {}
  async get(url: string) {
    const { data, error } = await this.db.from('college_source_fetches').select('url,host,status,etag,last_modified,fetched_at,content_sha,error,attempts,body').eq('url', url).maybeSingle();
    if (error || !data) return null;
    const record: FetchRecord = {
      url: data.url, host: data.host, status: data.status, etag: data.etag, lastModified: data.last_modified,
      fetchedAt: data.fetched_at, contentSha: data.content_sha, error: data.error, attempts: data.attempts ?? 1,
    };
    return { record, body: (data.body as string | null) ?? null };
  }
  async put(record: FetchRecord, body: string | null) {
    const { error } = await this.db.from('college_source_fetches').upsert({
      url: record.url, host: record.host, status: record.status, etag: record.etag, last_modified: record.lastModified,
      fetched_at: record.fetchedAt, content_sha: record.contentSha, error: record.error, attempts: record.attempts,
      body: this.storeBodies ? body : null,
      next_retry_at: null,
    }, { onConflict: 'url' });
    if (error) log.warn({ url: record.url, err: error.message }, 'fetch cache write failed');
  }
}
