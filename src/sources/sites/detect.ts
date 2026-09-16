// Classify a school's athletics site and pick the adapter.
import type { Fetcher, SiteAdapter, SitePlatform } from '../../model.js';
import { sidearmAdapter, looksLikeSidearm } from './sidearm/index.js';
import { prestoAdapter, looksLikePresto } from './presto/index.js';
import { wmtAdapter, looksLikeWmt } from './wmt/index.js';

export function adapterFor(platform: SitePlatform): SiteAdapter | null {
  if (platform === 'sidearm') return sidearmAdapter;
  if (platform === 'presto') return prestoAdapter;
  if (platform === 'wmt') return wmtAdapter;
  return null;
}

export function classifyHtml(html: string): SitePlatform {
  if (looksLikeSidearm(html)) return 'sidearm';
  if (looksLikePresto(html)) return 'presto';
  if (looksLikeWmt(html)) return 'wmt';
  return 'other';
}

/** Fetch the athletics home page and classify it. Returns the final base URL too (sites redirect to www / new domains). */
export async function detectSite(fetcher: Fetcher, athleticsUrl: string): Promise<{ platform: SitePlatform; baseUrl: string; host: string }> {
  const start = athleticsUrl.startsWith('http') ? athleticsUrl : `https://${athleticsUrl}`;
  try {
    // One attempt: a dead host should not cost the full retry/backoff cycle during discovery.
    const res = await fetcher.get(start, { attempts: 1 });
    const u = new URL(res.url || start);
    return { platform: classifyHtml(res.text), baseUrl: `${u.protocol}//${u.host}`, host: u.host.replace(/^www\./, '') };
  } catch {
    const u = new URL(start);
    return { platform: 'unknown', baseUrl: `${u.protocol}//${u.host}`, host: u.host.replace(/^www\./, '') };
  }
}
