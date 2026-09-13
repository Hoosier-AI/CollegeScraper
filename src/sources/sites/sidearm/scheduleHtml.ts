// Sidearm schedule page: /sports/{sportSlug}/schedule/{season}
// Used (a) to map gameId → pretty box score URL, and (b) as a best-effort ScheduleEntry fallback
// when the EventsResults JSON endpoints are unavailable. Handles the nextgen `.s-game-card`
// markup and the legacy `.sidearm-schedule-game` list.
import { load, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { ScheduleEntry, SiteContext } from '../../../model.js';
import { absUrl, clockFromDisplayTime, collapse, dateFromMonthDay, isoDate, stripRank } from './common.js';

/** All box score links on the page keyed by game id. Pretty `/boxscore/{id}` URLs win over `boxscore.aspx?id=`. */
export function parseScheduleBoxScoreLinks(html: string, baseUrl: string): Map<string, string> {
  const out = new Map<string, string>();
  const legacy = new Map<string, string>();
  for (const m of html.matchAll(/href=["']([^"']*?\/boxscore\/(\d+)[^"']*)["']/gi)) {
    const id = m[2]!;
    if (!out.has(id)) out.set(id, absUrl(baseUrl, m[1]!.replace(/&amp;/g, '&'))!);
  }
  for (const m of html.matchAll(/href=["']([^"']*?boxscore\.aspx\?(?:[^"']*&(?:amp;)?)?id=(\d+)[^"']*)["']/gi)) {
    const id = m[2]!;
    if (!legacy.has(id)) legacy.set(id, absUrl(baseUrl, m[1]!.replace(/&amp;/g, '&'))!);
  }
  for (const [id, url] of legacy) if (!out.has(id)) out.set(id, url);
  return out;
}

function gameIdFromHref(href: string | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/boxscore\/(\d+)/) ?? href.match(/boxscore\.aspx\?(?:.*&)?id=(\d+)/);
  return m ? m[1]! : null;
}

function opponentIdFromHref(href: string | undefined): string | null {
  const m = href?.match(/opponent-history\/[^/]+\/(\d+)/);
  return m ? m[1]! : null;
}

function parseScore(raw: string | null): ScheduleEntry['result'] {
  if (!raw) return null;
  const m = raw.replace(/\s+/g, ' ').match(/\b([WLT])\b[,\s]*(\d+)\s*-\s*(\d+)/i);
  if (!m) return null;
  return { status: m[1]!.toUpperCase() as 'W' | 'L' | 'T', teamScore: Number(m[2]), opponentScore: Number(m[3]) };
}

function homeAwayFromStamp(stamp: string | null, neutralHint: boolean): 'H' | 'A' | 'N' {
  const s = (stamp ?? '').toLowerCase();
  if (neutralHint) return 'N';
  if (s === 'at' || s.startsWith('at ') || s === '@') return 'A';
  return 'H';
}

function classify(descriptors: string[]): { isExhibition: boolean; tournament: string | null; isConference: boolean } {
  let isExhibition = false; let tournament: string | null = null; let isConference = false;
  for (const d of descriptors) {
    if (/exhib|scrimmage/i.test(d)) isExhibition = true;
    else if (/tournament|championship|invitational|classic|cup|playoff|final|semifinal|quarterfinal|round/i.test(d)) tournament ??= d;
    else if (/^\*?[A-Z0-9&. -]{2,20}\*?$/.test(d) || /conference|league/i.test(d)) isConference = true;
  }
  return { isExhibition, tournament, isConference };
}

function parseNextgenCard($: CheerioAPI, cardEl: Element, ctx: SiteContext): ScheduleEntry | null {
  const card = $(cardEl);
  const t = (sel: string) => collapse(card.find(sel).first().clone().find('picture, svg').remove().end().text());
  const opponentRaw = t('[data-test-id="s-game-card-standard__header-team-opponent-link"], [class*="opponent-link"], [class*="__opponent-name"], [class*="team-name"]');
  if (!opponentRaw) return null;
  const dateRaw = t('[data-test-id="s-game-card-standard__header-game-date-details"], [class*="game-date"], time');
  const timeRaw = t('[data-test-id="s-game-card-standard__header-game-time"], [class*="game-time"]');
  const datetimeAttr = card.find('time[datetime]').first().attr('datetime');
  const date = isoDate(datetimeAttr) ?? dateFromMonthDay(dateRaw, ctx.season);
  if (!date) return null;
  const scoreRaw = t('[data-test-id="s-game-card-standard__header-game-team-score"], [class*="game-team-score"], [class*="__score"]');
  const stamp = t('[data-test-id="s-stamp__root"] [class*="s-stamp__text"], [data-test-id="s-stamp__root"], [class*="s-stamp__text"]');
  const location = t('[data-test-id="s-game-card-facility-and-location__standard-location-details"], [class*="location-details"], [class*="__location"]');
  const facility = t('[data-test-id="s-game-card-facility-and-location__game-facility-title-link"], [data-test-id="s-game-card-facility-and-location__standard-facility-title"]');
  const descriptors = card.find('[data-test-id="s-descriptor__text"], [class*="s-descriptor__text"], [class*="tournament-name"], [class*="conf-text"]').map((_, e) => collapse($(e).text()) ?? '').get().filter(Boolean);
  const { isExhibition, tournament, isConference } = classify(descriptors);
  const boxHref = card.find('a[href*="boxscore"]').first().attr('href');
  const oppHistoryHref = card.find('a[href*="opponent-history"]').first().attr('href');
  const result = parseScore(scoreRaw);
  const timeText = timeRaw && dateRaw && timeRaw.startsWith(dateRaw) ? timeRaw.slice(dateRaw.length) : timeRaw;
  const status = (scoreRaw ?? '').toLowerCase();
  return {
    date,
    startTimeLocal: clockFromDisplayTime(timeText),
    opponentName: stripRank(opponentRaw),
    opponentSiteId: opponentIdFromHref(oppHistoryHref),
    homeAway: homeAwayFromStamp(stamp, /neutral/i.test(card.text()) && !/at|vs/.test(stamp ?? '')),
    location: location ?? facility,
    isConference,
    isExhibition,
    tournament,
    state: /postpone/.test(status) ? 'postponed' : /cancel/.test(status) ? 'cancelled' : result ? 'final' : /final/.test(status) ? 'final' : 'scheduled',
    result,
    boxScoreUrl: absUrl(ctx.baseUrl, boxHref),
    siteGameId: gameIdFromHref(boxHref),
    attendance: null,
  };
}

function parseLegacyGame($: CheerioAPI, el: Element, ctx: SiteContext): ScheduleEntry | null {
  const g = $(el);
  const t = (sel: string) => collapse(g.find(sel).first().text());
  const opponentRaw = t('.sidearm-schedule-game-opponent-name a, .sidearm-schedule-game-opponent-name, .sidearm-schedule-game-opponent-text');
  if (!opponentRaw) return null;
  const dateRaw = t('.sidearm-schedule-game-opponent-date span:first-child, .sidearm-schedule-game-opponent-date');
  const timeRaw = t('.sidearm-schedule-game-opponent-date span:nth-child(2), .sidearm-schedule-game-time');
  const date = isoDate(g.find('time[datetime]').attr('datetime')) ?? dateFromMonthDay(dateRaw?.replace(/\(.*?\)/, '').trim(), ctx.season);
  if (!date) return null;
  const resultRaw = t('.sidearm-schedule-game-result');
  const statusText = t('.sidearm-schedule-game-result span:first-child') ?? '';
  const scoreText = t('.sidearm-schedule-game-result span:nth-child(2)') ?? resultRaw;
  const result = parseScore(`${statusText} ${scoreText}`) ?? parseScore(resultRaw);
  const stamp = t('.sidearm-schedule-game-away-neutral, .sidearm-schedule-game-conference-vs, .sidearm-schedule-game-opponent-name ~ span');
  const isNeutral = g.hasClass('sidearm-schedule-game-neutral') || /neutral/i.test(g.attr('class') ?? '');
  const isAway = g.hasClass('sidearm-schedule-game-away') || /\bat\b/i.test(stamp ?? '');
  const boxHref = g.find('a[href*="boxscore"]').first().attr('href');
  const descriptors = g.find('.sidearm-schedule-game-conference, .sidearm-schedule-game-tournament, .sidearm-schedule-game-conference-conference').map((_, e) => collapse($(e).text()) ?? '').get().filter(Boolean);
  const { isExhibition, tournament, isConference } = classify(descriptors);
  return {
    date,
    startTimeLocal: clockFromDisplayTime(timeRaw),
    opponentName: stripRank(opponentRaw),
    opponentSiteId: null,
    homeAway: isNeutral ? 'N' : isAway ? 'A' : 'H',
    location: t('.sidearm-schedule-game-location span, .sidearm-schedule-game-location'),
    isConference: isConference || g.hasClass('sidearm-schedule-game-conference') || g.find('.sidearm-schedule-game-conference-conference').length > 0,
    isExhibition: isExhibition || /exhib/i.test(g.text()),
    tournament,
    state: result ? 'final' : /postpone/i.test(resultRaw ?? '') ? 'postponed' : /cancel/i.test(resultRaw ?? '') ? 'cancelled' : 'scheduled',
    result,
    boxScoreUrl: absUrl(ctx.baseUrl, boxHref),
    siteGameId: gameIdFromHref(boxHref),
    attendance: null,
  };
}

/** Best-effort schedule from HTML. Entries are in page order (Sidearm lists chronologically). */
export function parseScheduleHtml(html: string, ctx: SiteContext): ScheduleEntry[] {
  const $ = load(html);
  const out: ScheduleEntry[] = [];
  const cards = $('[class*="s-game-card"]').filter((_, el) => /(^|\s)s-game-card(\s|$)/.test($(el).attr('class') ?? ''));
  cards.each((_, el) => { const e = parseNextgenCard($, el, ctx); if (e) out.push(e); });
  if (!out.length) $('.sidearm-schedule-game').each((_, el) => { const e = parseLegacyGame($, el, ctx); if (e) out.push(e); });
  // Dedupe by game id / date+opponent (the page can render list + table views of the same games).
  const seen = new Set<string>();
  return out.filter((e) => {
    const key = e.siteGameId ?? `${e.date}|${e.opponentName.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
