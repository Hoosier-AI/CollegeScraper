// Every site the pro crawl reads, for the hub's Crawling page: what it is, its licence, what it feeds, its jobs, and
// which league seasons it should have (so the page can say how far along each one is). Scraped and open sources come
// first; API-Football fills what they do not have and checks them.
import type { SourceId } from '../ops/sourceRequests.js';
import { ASA_LEAGUES } from '../sources/asa/leagues.js';
import { WIKI_TARGETS } from '../jobs/sources/wikipedia.js';
import { OF_LEAGUES } from '../sources/openfootball/leagues.js';
import { FD_LEAGUES } from '../sources/footballData/parse.js';

export type Feed = 'results' | 'tables' | 'players' | 'club stats' | 'bios' | 'careers' | 'squads' | 'transfers' | 'injuries' | 'xG and shots';

export interface CrawlSite {
  id: SourceId;
  name: string;
  url: string;
  license: string;
  /** True for the sources we read first; false for API-Football, which fills the gaps. */
  scraped: boolean;
  feeds: Feed[];
  /** Jobs that read this site (the first syncs it). */
  jobs: string[];
  cadence: string;
}

export const CRAWL_SITES: CrawlSite[] = [
  { id: 'asa', name: 'American Soccer Analysis', url: 'https://www.americansocceranalysis.com', license: 'free API, credited', scraped: true,
    feeds: ['results', 'players', 'club stats', 'xG and shots'], jobs: ['asa-sync', 'asa-shots', 'asa-fill'], cadence: 'daily 08:40 UTC; shots every 30 min' },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org', license: 'CC BY-SA 4.0', scraped: true,
    feeds: ['tables'], jobs: ['wikipedia-sync'], cadence: 'daily 08:35 UTC (seasons in play; finished seasons once)' },
  { id: 'openfootball', name: 'openfootball', url: 'https://github.com/openfootball', license: 'public domain (CC0)', scraped: true,
    feeds: ['results'], jobs: ['openfootball-sync'], cadence: 'daily 08:30 UTC (the season in play; finished seasons once)' },
  { id: 'football-data', name: 'football-data.co.uk', url: 'https://www.football-data.co.uk', license: 'free data, credited', scraped: true,
    feeds: ['results', 'club stats'], jobs: ['football-data-sync', 'football-data-fill'], cadence: 'daily 08:45 UTC (the season in play; finished seasons once)' },
  { id: 'wikidata', name: 'Wikidata', url: 'https://www.wikidata.org', license: 'CC0 (careers from Wikipedia, CC BY-SA 4.0)', scraped: true,
    feeds: ['bios', 'careers'], jobs: ['wikidata-sync', 'wikidata-fill'], cadence: 'every hour at :20 (US clubs first)' },
  { id: 'api-football', name: 'API-Football', url: 'https://www.api-football.com', license: 'paid plan, shown on our pages only', scraped: false,
    feeds: ['results', 'tables', 'players', 'club stats', 'bios', 'squads', 'transfers', 'injuries'], jobs: ['pro-crawl', 'pro-scoreboard', 'pro-live', 'pro-final-detail', 'pro-standings', 'pro-plan'],
    cadence: 'crawl every 10 min until the daily floor; scores every 3 min' },
];

/** Jobs that work across sources (matching, checks, history, worked-out tables). */
export const CHECK_JOBS = ['source-map', 'source-check', 'history-fill', 'results-tables', 'football-data-fill', 'wikidata-fill'];

/** The site a job belongs to (null for the cross-source jobs). */
export function siteOfJob(job: string): SourceId | null {
  if (job.startsWith('pro-')) return 'api-football';
  return CRAWL_SITES.find((s) => s.jobs.includes(job))?.id ?? null;
}

/** League seasons each scraped source should have, given each league's current season. */
export function expectedSeasons(currentOf: (league: number) => number): { source: SourceId; league_id: number; season: number }[] {
  const out: { source: SourceId; league_id: number; season: number }[] = [];
  for (const l of ASA_LEAGUES) for (let y = l.first; y <= currentOf(l.league); y += 1) out.push({ source: 'asa', league_id: l.league, season: y });
  for (const t of WIKI_TARGETS) {
    const last = t.current ? currentOf(t.league) : currentOf(t.league) - 1;
    for (let y = t.first; y <= last; y += 1) out.push({ source: 'wikipedia', league_id: t.league, season: y });
  }
  // openfootball: every league in OF_LEAGUES, from its first season to the one in play (a season it never published is
  // recorded as read with nothing in it).
  for (const l of OF_LEAGUES) for (let y = l.first; y <= currentOf(l.league); y += 1) out.push({ source: 'openfootball', league_id: l.league, season: y });
  for (const l of FD_LEAGUES) for (let y = l.first; y <= currentOf(l.league); y += 1) out.push({ source: 'football-data', league_id: l.league, season: y });
  return out;
}
