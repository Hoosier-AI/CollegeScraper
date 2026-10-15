// Where news comes from. School athletics feeds (each program's own sport feed), publishers' public RSS feeds, GDELT
// (the open global news index), the Guardian's Content API, and official club and federation feeds found weekly.
// We show the headline, link and publisher only. A publisher feed ships switched on only when its published terms
// allow that use (`terms` says what they allow and `on` is the starting state); the others start off, so the owner
// can review the terms and switch them on in the hub (Stats, Settings).
import type { Scope } from './entities.js';

export interface PublisherFeed {
  id: string;
  name: string;
  url: string;
  scope: Scope;
  gender?: 'm' | 'w';
  terms: string;
  termsUrl: string;
  /** Starting state; afterwards the hub's switch decides. */
  on: boolean;
}

export const PUBLISHER_FEEDS: PublisherFeed[] = [
  { id: 'feed:bbc-football', name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', scope: 'pro', terms: 'Headlines and summaries on other sites with a credit and a link back; no charging for them', termsUrl: 'https://www.bbc.co.uk/news/10628494', on: true },
  { id: 'feed:bbc-womens', name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/womens/rss.xml', scope: 'pro', gender: 'w', terms: 'Headlines and summaries on other sites with a credit and a link back; no charging for them', termsUrl: 'https://www.bbc.co.uk/news/10628494', on: true },
  { id: 'feed:espn-soccer', name: 'ESPN', url: 'https://www.espn.com/espn/rss/soccer/news', scope: 'pro', terms: 'Feed content shown unmodified with a credit and a link to espn.com; no ads inside it', termsUrl: 'https://www.espn.com/espn/news/story?id=3437834', on: true },
  { id: 'feed:ncaa-msoc-d1', name: 'NCAA.com', url: 'https://www.ncaa.com/news/soccer-men/d1/rss.xml', scope: 'college', gender: 'm', terms: 'Not published for feeds: review before switching on', termsUrl: 'https://www.ncaa.com/tos', on: false },
  { id: 'feed:ncaa-wsoc-d1', name: 'NCAA.com', url: 'https://www.ncaa.com/news/soccer-women/d1/rss.xml', scope: 'college', gender: 'w', terms: 'Not published for feeds: review before switching on', termsUrl: 'https://www.ncaa.com/tos', on: false },
  { id: 'feed:topdrawer', name: 'TopDrawerSoccer', url: 'https://www.topdrawersoccer.com/rss', scope: 'college', terms: 'Not published for feeds: review before switching on', termsUrl: 'https://www.topdrawersoccer.com/', on: false },
  { id: 'feed:soccer-america', name: 'Soccer America', url: 'https://www.socceramerica.com/rss/', scope: 'college', terms: 'Not published for feeds: review before switching on', termsUrl: 'https://www.socceramerica.com/', on: false },
  { id: 'feed:united-soccer-coaches', name: 'United Soccer Coaches', url: 'https://unitedsoccercoaches.org/feed/', scope: 'college', terms: 'Not published for feeds: review before switching on', termsUrl: 'https://unitedsoccercoaches.org/', on: false },
  { id: 'feed:equalizer', name: 'The Equalizer', url: 'https://equalizersoccer.com/feed/', scope: 'pro', gender: 'w', terms: 'Not published for feeds: review before switching on', termsUrl: 'https://equalizersoccer.com/', on: false },
  { id: 'feed:cbs-soccer', name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/soccer/', scope: 'pro', terms: 'Not published for feeds: review before switching on', termsUrl: 'https://www.cbssports.com/', on: false },
  { id: 'feed:yahoo-soccer', name: 'Yahoo Sports', url: 'https://sports.yahoo.com/soccer/rss/', scope: 'pro', terms: 'Not published for feeds: review before switching on', termsUrl: 'https://legal.yahoo.com/', on: false },
  { id: 'feed:sky-football', name: 'Sky Sports', url: 'https://www.skysports.com/rss/12040', scope: 'pro', terms: 'Not published for feeds: review before switching on', termsUrl: 'https://www.skysports.com/', on: false },
];

/**
 * GDELT DOC 2.0 queries (headline, link, outlet, date from thousands of outlets; free for any use with a credit).
 * GDELT asks for one request every 5 s, so a run reads one query and the queries take turns.
 */
export const GDELT_QUERIES: { id: string; name: string; query: string; scope: Scope; gender?: 'm' | 'w' }[] = [
  { id: 'gdelt:college-mens', name: 'College soccer (men)', query: '("men\'s soccer" OR "college soccer") (NCAA OR college OR university)', scope: 'college', gender: 'm' },
  { id: 'gdelt:college-womens', name: 'College soccer (women)', query: '"women\'s soccer" (NCAA OR college OR university)', scope: 'college', gender: 'w' },
  { id: 'gdelt:usmnt', name: 'USMNT', query: '(USMNT OR "U.S. men\'s national team")', scope: 'international', gender: 'm' },
  { id: 'gdelt:uswnt', name: 'USWNT', query: '(USWNT OR "U.S. women\'s national team")', scope: 'international', gender: 'w' },
  { id: 'gdelt:mls', name: 'MLS', query: '("MLS" OR "Major League Soccer") soccer', scope: 'pro', gender: 'm' },
  { id: 'gdelt:nwsl', name: 'NWSL', query: 'NWSL soccer', scope: 'pro', gender: 'w' },
  { id: 'gdelt:usl', name: 'USL', query: '("USL Championship" OR "USL Super League" OR "USL League One")', scope: 'pro' },
  { id: 'gdelt:abroad', name: 'Americans abroad', query: '(American OR USMNT OR USWNT) ("Premier League" OR Bundesliga OR "La Liga" OR "Serie A" OR "Ligue 1")', scope: 'pro' },
  { id: 'gdelt:international', name: 'International soccer', query: '("World Cup" OR "Gold Cup" OR "Nations League" OR "Copa America") soccer', scope: 'international' },
];
export const gdeltUrl = (q: string) => `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${q} sourcelang:english`)}&mode=artlist&maxrecords=75&format=json&sort=datedesc&timespan=1d`;

export const GUARDIAN_URL = (key: string) => `https://content.guardianapis.com/search?section=football&page-size=50&order-by=newest&show-fields=trailText,thumbnail&show-tags=keyword&api-key=${encodeURIComponent(key)}`;

/**
 * A program's own sport news feed on its athletics site, or null when the platform publishes none we can read.
 * Sidearm's feed takes the sport's short code (msoc, wsoc); an unknown code returns every sport.
 */
export function schoolFeedUrl(platform: string | null, baseUrl: string | null, gender: string | null): string | null {
  if (!baseUrl || (gender !== 'm' && gender !== 'w')) return null;
  const base = baseUrl.replace(/\/+$/, '');
  if (platform === 'sidearm') return `${base}/api/v2/rss/xml?path=${gender === 'w' ? 'wsoc' : 'msoc'}`;
  return null;
}

/** School feeds: soccer stories only (a site's feed can carry other sports when its sport code is shared or unknown). */
export function isSoccerItem(categories: string[], title: string, gender: 'm' | 'w' | null): boolean {
  const OTHER = /\b(football|basketball|volleyball|baseball|softball|hockey|tennis|golf|swim|swimming|diving|track|cross country|lacrosse|rowing|wrestling|fencing|gymnastics|bowling|rifle|esports|cheer)\b/i;
  if (!categories.length) return !OTHER.test(title) || /soccer/i.test(title);
  const cats = categories.flatMap((c) => c.split(',')).map((c) => c.trim()).filter(Boolean);
  const soccer = cats.filter((c) => /soccer/i.test(c));
  if (!soccer.length) return false;
  // A department round-up tagged with every sport is not soccer news.
  if (cats.filter((c) => OTHER.test(c)).length >= 2) return false;
  const women = soccer.some((c) => /women'?s|womens|\bw\.? ?soccer/i.test(c));
  const men = soccer.some((c) => /^(men'?s|mens|m\.?) ?soccer$/i.test(c) || /\bmen'?s soccer/i.test(c.replace(/women'?s soccer/gi, '')));
  const plain = soccer.some((c) => /^soccer$/i.test(c));
  if (gender === 'm') return men || plain;
  if (gender === 'w') return women || plain;
  return true;
}

/** The classic Sidearm feed (older sites): every sport's latest stories; isSoccerItem keeps the soccer ones. */
export function classicSidearmFeed(url: string): string | null {
  const m = url.match(/^(https?:\/\/[^/]+)\/api\/v2\/rss\/xml\?path=(\w+)$/);
  return m ? `${m[1]}/rss.aspx?path=${m[2]}` : null;
}

/**
 * Sites run by a league (their terms forbid reuse), so club feeds found on them are skipped: MLS and NWSL clubs
 * publish through their league's platform. Checked against the feed's host and the club's home page.
 */
export const LEAGUE_RUN = /(^|\.)(mlssoccer\.com|nwslsoccer\.com|premierleague\.com|laliga\.com|bundesliga\.com|legaseriea\.it|ligue1\.com|uslchampionship\.com|uslleagueone\.com|uslsuperleague\.com)$/i;
export const LEAGUE_RUN_PAGE = /mlssoccer\.com\/(legal|terms)|nwslsoccer\.com\/(legal|terms)|Major League Soccer, L\.L\.C\.|National Women's Soccer League, LLC/i;

/** Club feeds are read from English-speaking countries only: the rules read English, and the readers are in the US. */
export const ENGLISH_COUNTRIES = new Set(['USA', 'England', 'Scotland', 'Wales', 'Northern-Ireland', 'Ireland', 'Canada', 'Australia', 'New-Zealand']);

/** A club's youth or academy story (its feed carries every team): not first-team news. */
export const YOUTH_STORY = /\b((u-?1\d|u-?2[0-3])s?|under[- ]?1\d|under[- ]?2[0-3]|academy|youth|juniors?|reserves|development squad)\b/i;

/** Leagues whose clubs' sites are run by the league (see LEAGUE_RUN): no club feeds for them. */
export const LEAGUE_RUN_IDS = new Set([253, 254]);

/** Federations whose official sites we look at for a feed (national team news), by our national team slug. */
export const FEDERATION_SITES: { team: string; url: string }[] = [
  { team: 'usa', url: 'https://www.ussoccer.com' },
  { team: 'usa-women', url: 'https://www.ussoccer.com' },
  { team: 'canada', url: 'https://canadasoccer.com' },
  { team: 'mexico', url: 'https://fmf.mx' },
  { team: 'england', url: 'https://www.englandfootball.com' },
];
