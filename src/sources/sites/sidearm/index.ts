// Sidearm Sports athletics-site adapter.
//
// Endpoints used (all relative to ctx.baseUrl):
//   roster    GET /api/v2/Rosters/bySport/{mens-soccer|womens-soccer}?season={year}   → HTML /sports/{slug}/roster/{year} fallback
//   schedule  GET /api/v2.1/EventsResults/results?sportId=N   + /upcoming?sportId=N   → HTML /sports/{slug}/schedule/{year} fallback
//   stats     GET /sports/{slug}/stats/{year}                                          (null on 404)
//   box score GET {url}  (pretty /sports/{slug}/stats/{year}/{opp}/boxscore/{id}, or /boxscore.aspx?id={id})
//   bio       GET {url}
import type { BoxScore, Fetcher, Gender, PlayerBio, Roster, ScheduleEntry, SeasonStats, SiteAdapter, SiteContext } from '../../../model.js';
import { isNotFound, isObj, obj, sidearmSportSlug, str } from './common.js';
import { parseBoxScore } from './boxScore.js';
import { parseCumulativeStats } from './cumulativeStats.js';
import { parsePlayerBio } from './playerBio.js';
import { parseResults, resultsUrl } from './results.js';
import { parseRosterHtml } from './rosterHtml.js';
import { parseRosterJson, rosterJsonUrl } from './rosterJson.js';
import { parseScheduleBoxScoreLinks, parseScheduleHtml } from './scheduleHtml.js';

export { sidearmSportSlug } from './common.js';
export { decodeNuxtData, extractNuxtDataJson } from './devalue.js';
export { parseRosterJson } from './rosterJson.js';
export { parseRosterHtml } from './rosterHtml.js';
export { parseResults } from './results.js';
export { parseScheduleBoxScoreLinks, parseScheduleHtml } from './scheduleHtml.js';
export { parseCumulativeStats } from './cumulativeStats.js';
export { parseBoxScore } from './boxScore.js';
export { parsePlayerBio } from './playerBio.js';

/** Heuristic platform detection: Sidearm markup, asset hosts, or the nextgen Nuxt payload. */
export function looksLikeSidearm(html: string): boolean {
  if (!html) return false;
  const head = html.length > 400_000 ? html.slice(0, 400_000) : html;
  if (/sidearm\.nextgen\.sites|sidearmdev\.com|sidearmsports\.com|sidearm-icons|sidearmstats/i.test(head)) return true;
  if (/class="[^"]*\bsidearm-(?:roster|schedule|modal|skip-link|ad-state|logo)/i.test(head)) return true;
  if (/__NUXT_DATA__/.test(head) && /c-rosterpage|c-schedulepage|c-stats-page|c-rosterbio|s-game-card|s-person-card|sidearm/i.test(head)) return true;
  if (/<meta[^>]+content="[^"]*sidearm/i.test(head)) return true;
  return false;
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function base(ctx: SiteContext): string {
  return ctx.baseUrl.replace(/\/+$/, '');
}

function slugOf(ctx: SiteContext): string {
  return ctx.sportSlug ?? sidearmSportSlug(ctx.gender);
}

async function tryGet(fetcher: Fetcher, url: string, accept?: string): Promise<string | null> {
  try {
    const res = await fetcher.get(url, accept ? { accept } : undefined);
    return res.text;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function discover(fetcher: Fetcher, ctx: SiteContext): Promise<SiteContext | null> {
  const slug = slugOf(ctx);
  const text = await tryGet(fetcher, rosterJsonUrl(base(ctx), slug), 'application/json');
  if (text) {
    const json = parseJson(text);
    if (isObj(json) && (Array.isArray(json['players']) || isObj(json['sport']))) {
      const sport = obj(json['sport']);
      const sportId = Number(sport['id']);
      const sportSlug = str(sport['globalSportNameSlug']) ?? slug;
      return { ...ctx, sportSlug, sportId: Number.isFinite(sportId) ? sportId : ctx.sportId };
    }
  }
  const html = await tryGet(fetcher, `${base(ctx)}/sports/${slug}/roster`);
  if (html && (looksLikeSidearm(html) || /roster/i.test(html))) {
    const roster = parseRosterHtml(html, ctx, `${base(ctx)}/sports/${slug}/roster`);
    if (roster.players.length || /c-rosterpage|sidearm-roster/i.test(html)) return { ...ctx, sportSlug: slug };
  }
  return null;
}

async function roster(fetcher: Fetcher, ctx: SiteContext): Promise<Roster> {
  const slug = slugOf(ctx);
  const jsonUrl = rosterJsonUrl(base(ctx), slug, ctx.season);
  const text = await tryGet(fetcher, jsonUrl, 'application/json');
  if (text) {
    const json = parseJson(text);
    if (isObj(json) && Array.isArray(json['players'])) return parseRosterJson(json, ctx, jsonUrl);
  }
  for (const url of [`${base(ctx)}/sports/${slug}/roster/${ctx.season}`, `${base(ctx)}/sports/${slug}/roster`]) {
    const html = await tryGet(fetcher, url);
    if (!html) continue;
    const r = parseRosterHtml(html, ctx, url);
    if (r.players.length) return r;
  }
  throw Object.assign(new Error(`Sidearm roster not found for ${ctx.host} ${slug} ${ctx.season}`), { status: 404 });
}

async function scheduleHtmlPage(fetcher: Fetcher, ctx: SiteContext): Promise<{ html: string; url: string } | null> {
  const slug = slugOf(ctx);
  for (const url of [`${base(ctx)}/sports/${slug}/schedule/${ctx.season}`, `${base(ctx)}/sports/${slug}/schedule`]) {
    const html = await tryGet(fetcher, url);
    if (html) return { html, url };
  }
  return null;
}

async function schedule(fetcher: Fetcher, ctx: SiteContext): Promise<ScheduleEntry[]> {
  const payloads: unknown[] = [];
  if (ctx.sportId != null) {
    for (const kind of ['results', 'upcoming'] as const) {
      const text = await tryGet(fetcher, resultsUrl(base(ctx), ctx.sportId, kind), 'application/json');
      if (!text) continue;
      const json = parseJson(text);
      if (isObj(json) && Array.isArray(json['items'])) payloads.push(json);
    }
  }
  // The schedule HTML carries the pretty box score URLs (the JSON only has /boxscore.aspx?id=).
  let page: { html: string; url: string } | null = null;
  try { page = await scheduleHtmlPage(fetcher, ctx); } catch (err) { if (!payloads.length) throw err; }
  if (payloads.length) {
    const pretty = page ? parseScheduleBoxScoreLinks(page.html, base(ctx)) : undefined;
    return parseResults(payloads, ctx, pretty);
  }
  if (page) return parseScheduleHtml(page.html, ctx);
  throw Object.assign(new Error(`Sidearm schedule not found for ${ctx.host} ${slugOf(ctx)} ${ctx.season}`), { status: 404 });
}

async function seasonStats(fetcher: Fetcher, ctx: SiteContext): Promise<SeasonStats | null> {
  const url = `${base(ctx)}/sports/${slugOf(ctx)}/stats/${ctx.season}`;
  const html = await tryGet(fetcher, url);
  if (!html) return null;
  const stats = parseCumulativeStats(html, ctx, url);
  if (!stats.players.length && !stats.team) return null;
  return stats;
}

async function boxScore(fetcher: Fetcher, ctx: SiteContext, url: string): Promise<BoxScore> {
  const res = await fetcher.get(url);
  return parseBoxScore(res.text, res.url || url, ctx);
}

async function playerBio(fetcher: Fetcher, _ctx: SiteContext, url: string): Promise<PlayerBio> {
  const res = await fetcher.get(url);
  return parsePlayerBio(res.text, res.url || url);
}

export const sidearmAdapter: SiteAdapter = {
  platform: 'sidearm',
  discover,
  roster,
  schedule,
  seasonStats,
  boxScore,
  playerBio,
};

export function sidearmRosterJsonUrl(baseUrl: string, gender: Gender, season?: number | null): string {
  return rosterJsonUrl(baseUrl, sidearmSportSlug(gender), season);
}
