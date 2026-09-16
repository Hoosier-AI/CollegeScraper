// PrestoSports athletics-site adapter.
import type { BoxScore, Fetcher, PlayerBio, Roster, ScheduleEntry, SeasonStats, SiteAdapter, SiteContext } from '../../../model.js';
import { parseBoxScore } from './boxScore.js';
import { parsePlayerBio } from './playerBio.js';
import { parseRoster } from './roster.js';
import { parseScheduleHtml, parseScheduleRss } from './schedule.js';
import { prestoSeasonSlug, prestoSportSlug } from './season.js';
import { parseSportIndex } from './sportIndex.js';
import { buildSeasonStats, mergePlayerLines, parsePlayerStatsFragment, parseTeamStatsPage } from './teamStats.js';

export { prestoSeasonSlug, prestoSportSlug } from './season.js';
export { parseSportIndex } from './sportIndex.js';
export { parseRoster } from './roster.js';
export { parseScheduleHtml, parseScheduleRss } from './schedule.js';
export { parseTeamStatsPage, parsePlayerStatsFragment, mergePlayerLines } from './teamStats.js';
export { parseBoxScore } from './boxScore.js';
export { parsePlayerBio } from './playerBio.js';

/** True when the markup carries PrestoSports fingerprints (CDN/theme asset hosts, template classes). */
export function looksLikePresto(html: string): boolean {
  if (!html) return false;
  return (
    /(?:cdn|theme-assets|www)\.prestosports\.com/i.test(html) ||
    /prestosports/i.test(html.slice(0, 200000)) ||
    /class="[^"]*\bevent-row\b/.test(html) ||
    /class="[^"]*\broster-data\b/.test(html) ||
    /tabbed-ajax-content/.test(html) ||
    /\/sports\/[a-z]+\/\d{4}-\d{2}\/(?:roster|schedule|teams\/)/.test(html)
  );
}

function base(ctx: SiteContext): string {
  const b = ctx.baseUrl || `https://${ctx.host}`;
  return b.replace(/\/+$/, '');
}

function sportOf(ctx: SiteContext): string {
  return ctx.sportSlug ?? prestoSportSlug(ctx.gender);
}

function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : null;
}

/** GET returning null on 404/410 (and on empty bodies); other failures propagate. */
async function getOrNull(fetcher: Fetcher, url: string): Promise<string | null> {
  try {
    const res = await fetcher.get(url);
    if (res.status === 404 || res.status === 410) return null;
    if (res.status >= 400) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { status: res.status });
    return res.text;
  } catch (err) {
    const st = statusOf(err);
    if (st === 404 || st === 410) return null;
    throw err;
  }
}

function withPlaysView(url: string): string {
  if (/[?&]view=plays(?:&|$)/.test(url)) return url;
  return url.includes('?') ? `${url}&view=plays` : `${url}?view=plays`;
}

export const prestoAdapter: SiteAdapter = {
  platform: 'presto',

  async discover(fetcher: Fetcher, ctx: SiteContext): Promise<SiteContext | null> {
    const sport = sportOf(ctx);
    const html = await getOrNull(fetcher, `${base(ctx)}/sports/${sport}/index`);
    if (html == null) return null;
    const info = parseSportIndex(html, sport);
    if (info.teamSlug) return { ...ctx, sportSlug: sport, teamSlug: info.teamSlug };
    // Smaller tenants publish no team-stats page (no /teams/{slug} link), but the roster and schedule still live at
    // the season path; the slug is only needed for cumulative stats, which seasonStats() skips when it is null.
    const roster = await getOrNull(fetcher, `${base(ctx)}/sports/${sport}/${prestoSeasonSlug(ctx.season)}/roster`);
    if (roster == null || !/roster/i.test(roster)) return null;
    return { ...ctx, sportSlug: sport, teamSlug: null };
  },

  async roster(fetcher: Fetcher, ctx: SiteContext): Promise<Roster> {
    const url = `${base(ctx)}/sports/${sportOf(ctx)}/${prestoSeasonSlug(ctx.season)}/roster`;
    const res = await fetcher.get(url);
    return parseRoster(res.text, base(ctx), url);
  },

  async schedule(fetcher: Fetcher, ctx: SiteContext): Promise<ScheduleEntry[]> {
    const url = `${base(ctx)}/sports/${sportOf(ctx)}/${prestoSeasonSlug(ctx.season)}/schedule`;
    let entries: ScheduleEntry[] = [];
    const html = await getOrNull(fetcher, url);
    if (html != null) entries = parseScheduleHtml(html, base(ctx), ctx.season);
    if (entries.length > 0) return entries;
    const rss = await getOrNull(fetcher, `${url}?print=rss`);
    if (rss == null) return entries;
    return parseScheduleRss(rss, base(ctx), ctx.season);
  },

  async seasonStats(fetcher: Fetcher, ctx: SiteContext): Promise<SeasonStats | null> {
    if (!ctx.teamSlug) return null;
    const url = `${base(ctx)}/sports/${sportOf(ctx)}/${prestoSeasonSlug(ctx.season)}/teams/${ctx.teamSlug}`;
    const html = await getOrNull(fetcher, url);
    if (html == null) return null;
    const page = parseTeamStatsPage(html, url, ctx.season);
    const lists = [page.players];
    // The current Presto template loads individual stats client-side; fetch those fragments when reachable.
    for (const u of page.playerStatUrls) {
      let frag: string | null = null;
      try {
        frag = await getOrNull(fetcher, u);
      } catch {
        frag = null;
      }
      if (frag) lists.push(parsePlayerStatsFragment(frag, u));
    }
    return buildSeasonStats(page, mergePlayerLines(...lists), url);
  },

  async boxScore(fetcher: Fetcher, ctx: SiteContext, url: string): Promise<BoxScore> {
    const abs = new URL(url, `${base(ctx)}/`).toString();
    const res = await fetcher.get(withPlaysView(abs));
    return parseBoxScore(res.text, abs);
  },

  async playerBio(fetcher: Fetcher, ctx: SiteContext, url: string): Promise<PlayerBio> {
    const abs = new URL(url, `${base(ctx)}/`).toString();
    const res = await fetcher.get(abs);
    return parsePlayerBio(res.text, abs);
  },
};

export default prestoAdapter;
