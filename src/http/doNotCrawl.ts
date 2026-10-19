// Sites we have agreed not to crawl. PrestoSports asked us (email, 2026-10-19) to stop crawling the athletics and
// conference sites they host: no request goes to a Presto site from now on. Data already stored is kept.
//
// Three locks: the HTTP client refuses every request to a listed host (and to anything on prestosports.com); a page
// that turns out to be served by Presto adds its host to the list on the spot (one request, never a second); and the
// jobs skip Presto schools and conferences before they ask (adapterFor, detect-sites, compute-standings).
import type { Db } from '../db/client.js';

/** Platforms whose sites we never crawl. */
export const DO_NOT_CRAWL_PLATFORMS = new Set(['presto']);
/** Presto-hosted conference sites (data/conference-sites.json) and the platform's own domain. */
const STATIC_HOSTS = ['amccsports.org', 'thegnac.com', 'mascac.com', 'miac-online.org', 'scacsports.com'];
const PLATFORM_DOMAINS = [/(^|\.)prestosports\.com$/i];

const hosts = new Set<string>(STATIC_HOSTS);
const bare = (host: string) => host.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');

export function addDoNotCrawlHost(host: string | null | undefined): void { if (host) hosts.add(bare(host)); }

/** Why this URL must not be fetched, or null when it may be. */
export function doNotCrawlReason(url: string): string | null {
  let host: string;
  try { host = bare(new URL(url).host); } catch { return null; }
  if (PLATFORM_DOMAINS.some((re) => re.test(host))) return `${host} is on PrestoSports (we do not crawl it)`;
  return hosts.has(host) ? `${host} is a PrestoSports site (we do not crawl it)` : null;
}

/** A fetched page that is a Presto site: its host joins the list (pages fingerprinted as Presto markup). */
export function looksLikePrestoPage(html: string): boolean {
  return /(?:cdn|theme-assets|www)\.prestosports\.com/i.test(html.slice(0, 200000));
}

/** Every school the database knows as a Presto site joins the list; called when the fetcher is made and hourly. */
export async function loadDoNotCrawl(db: Db): Promise<number> {
  const { data, error } = await db.from('college_schools').select('athletics_host').in('site_platform', [...DO_NOT_CRAWL_PLATFORMS]);
  if (error) return hosts.size;
  for (const r of (data ?? []) as { athletics_host: string | null }[]) addDoNotCrawlHost(r.athletics_host);
  return hosts.size;
}

export const doNotCrawlHosts = (): string[] => [...hosts].sort();
