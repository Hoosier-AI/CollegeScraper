// The International section's sources, for the hub's Stats -> International -> Crawling: what each site is, its
// licence, what it feeds, the jobs that read it, and what it has given us. Open and scraped sources first; API-Football
// (shared with Pro, one crawl) fills lineups, events, player lines and live scores and checks the others.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import type { SourceId } from './sourceRequests.js';

export interface IntlSite {
  id: SourceId;
  name: string;
  url: string;
  license: string;
  /** What the page credits on every block that shows this source's data. */
  credit: string;
  scraped: boolean;
  feeds: string[];
  jobs: string[];
  cadence: string;
  /** Read by Pro's jobs too (its requests are counted together). */
  shared?: boolean;
}

export const INTL_SITES: IntlSite[] = [
  { id: 'intl-results', name: 'International results (martj42)', url: 'https://github.com/martj42/international_results', license: 'public domain (CC0)', credit: 'Mart Jürisoo, international_results (CC0)',
    scraped: true, feeds: ["men's results since 1872", 'scorers', 'shootouts', 'World Cup assists'], jobs: ['intl-results-sync'], cadence: 'daily 10:30 UTC' },
  { id: 'openfootball-wc', name: 'openfootball World Cups', url: 'https://github.com/openfootball/worldcup', license: 'public domain (CC0)', credit: 'openfootball (CC0)',
    scraped: true, feeds: ["men's World Cups 1930-2026", 'scorers'], jobs: ['intl-wc-sync'], cadence: 'Mondays 10:40 UTC; daily during a World Cup' },
  { id: 'worldcup-db', name: 'The Fjelstul World Cup Database', url: 'https://github.com/jfjelstul/worldcup', license: 'CC BY-SA 4.0', credit: 'Joshua C. Fjelstul, Ph.D., The Fjelstul World Cup Database (CC BY-SA 4.0)',
    scraped: true, feeds: ["men's and women's World Cups", 'squads', 'goals', 'bookings', 'awards'], jobs: ['intl-wcdb-sync'], cadence: 'Mondays 10:50 UTC (a new release is read once)' },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org', license: 'CC BY-SA 4.0', credit: 'Wikipedia (CC BY-SA 4.0)',
    scraped: true, feeds: ["women's and youth results", 'national team records'], jobs: ['intl-wiki-sync'], cadence: 'Mondays 11:00 UTC', shared: true },
  { id: 'wikidata', name: 'Wikidata', url: 'https://www.wikidata.org', license: 'CC0', credit: 'Wikidata (CC0)',
    scraped: true, feeds: ['caps and international goals'], jobs: ['intl-caps-sync'], cadence: 'daily 11:20 UTC', shared: true },
  { id: 'rsssf', name: 'RSSSF', url: 'https://www.rsssf.org', license: 'free to copy with credit to the RSSSF', credit: 'RSSSF (the Rec.Sport.Soccer Statistics Foundation)',
    scraped: true, feeds: ['most caps and goals per nation'], jobs: ['intl-rsssf-sync'], cadence: 'Mondays 11:30 UTC' },
  { id: 'api-football', name: 'API-Football', url: 'https://www.api-football.com', license: 'paid plan, shown on our pages only', credit: 'API-Football',
    scraped: false, feeds: ['live scores', 'lineups', 'events', 'player match stats', 'squads'], jobs: ['pro-crawl', 'pro-live', 'pro-scoreboard'], cadence: 'with Pro (one crawl)', shared: true },
];
export const INTL_SCRAPED = INTL_SITES.filter((s) => s.scraped).map((s) => s.id as string);

/** Rows a source has given (missing tables, before migration 164, count as none). */
async function count(db: Db, table: string, f?: (q: any) => any): Promise<number | null> {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  if (f) q = f(q);
  const r = await q;
  return r.error ? null : r.count ?? 0;
}

export async function intlSourcesBlock(db: Db) {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const requests = await selectAll<{ day: string; source: string; requests: number; errors: number; bytes: number; last_at: string | null; last_error: string | null }>(db, 'pro_source_requests', 'day,source,requests,errors,bytes,last_at,last_error',
    (q) => q.gte('day', since).in('source', INTL_SITES.map((s) => s.id))).catch(() => []);
  const per = await Promise.all(INTL_SITES.map(async (s) => {
    const rq = requests.filter((r) => r.source === s.id);
    const [matches, goals, extra] = s.id === 'api-football' ? [null, null, null] : await Promise.all([
      count(db, 'intl_src_matches', (q) => q.eq('source', s.id)),
      count(db, 'intl_src_goals', (q) => q.eq('source', s.id)),
      s.id === 'wikidata' ? count(db, 'intl_caps', (q) => q.eq('source', 'wikidata')) : s.id === 'rsssf' ? count(db, 'intl_caps', (q) => q.eq('source', 'rsssf')) : s.id === 'worldcup-db' ? count(db, 'intl_squads', (q) => q.eq('source', 'worldcup-db')) : Promise.resolve(null),
    ]);
    const last = rq.map((r) => r.last_at).filter(Boolean).sort().pop() ?? null;
    return { ...s, requests_7d: rq.reduce((n, r) => n + r.requests, 0), errors_7d: rq.reduce((n, r) => n + r.errors, 0), bytes_7d: rq.reduce((n, r) => n + Number(r.bytes), 0), last_at: last,
      last_error: rq.find((r) => r.last_error)?.last_error ?? null, rows: { matches, goals, extra } };
  }));
  const agreement = await db.rpc('intl_source_agreement').then((r) => (r.error ? [] : (r.data ?? [])) as { source: string; compared: number; agree: number }[]);
  return { sites: per.map((s) => { const a = agreement.find((x) => x.source === s.id); return { ...s, compared: a?.compared ?? 0, agree: a?.agree ?? 0, rate: a?.compared ? Math.round((a.agree / a.compared) * 1000) / 1000 : null }; }) };
}
