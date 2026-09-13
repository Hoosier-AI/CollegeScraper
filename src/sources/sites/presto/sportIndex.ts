// Parses a Presto sport landing page (/sports/msoc/index) to find the team stats slug.
import * as cheerio from 'cheerio';
import { ws } from './util.js';

export interface SportIndexInfo {
  /** `/sports/msoc/2026-27/teams/centralconnst` → "centralconnst". */
  teamSlug: string | null;
  /** Presto internal team id when a `teams?id=` link is present. */
  teamId: string | null;
  /** Season slug used by the Statistics link (the site's *current* season, not necessarily ours). */
  seasonSlug: string | null;
  statsPath: string | null;
  rosterPath: string | null;
  schedulePath: string | null;
}

export function parseSportIndex(html: string, sportSlug: string): SportIndexInfo {
  const $ = cheerio.load(html);
  const info: SportIndexInfo = { teamSlug: null, teamId: null, seasonSlug: null, statsPath: null, rosterPath: null, schedulePath: null };
  const esc = sportSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const statsRe = new RegExp(`^(?:https?://[^/]+)?(/sports/${esc}/(\\d{4}-\\d{2})/teams/([^/?#\\s]+))`, 'i');
  const idRe = new RegExp(`^(?:https?://[^/]+)?/sports/${esc}/(\\d{4}-\\d{2})/teams\\?(?:.*&)?id=([a-z0-9]+)`, 'i');
  const rosterRe = new RegExp(`^(?:https?://[^/]+)?(/sports/${esc}/(\\d{4}-\\d{2})/roster)(?:[?#]|$)`, 'i');
  const schedRe = new RegExp(`^(?:https?://[^/]+)?(/sports/${esc}/(\\d{4}-\\d{2})/schedule)(?:[?#]|$)`, 'i');

  const candidates: { path: string; season: string; slug: string; label: string }[] = [];
  $('a[href]').each((_, a) => {
    const href = ws($(a).attr('href'));
    const label = ws($(a).text()).toLowerCase();
    let m = href.match(statsRe);
    if (m) candidates.push({ path: m[1]!, season: m[2]!, slug: m[3]!, label });
    m = href.match(idRe);
    if (m && !info.teamId) info.teamId = m[2]!;
    m = href.match(rosterRe);
    if (m && !info.rosterPath) info.rosterPath = m[1]!;
    m = href.match(schedRe);
    if (m && !info.schedulePath) info.schedulePath = m[1]!;
  });
  const best = candidates.find((c) => /stat/.test(c.label)) ?? candidates[0];
  if (best) {
    info.teamSlug = best.slug;
    info.seasonSlug = best.season;
    info.statsPath = best.path;
  }
  return info;
}
