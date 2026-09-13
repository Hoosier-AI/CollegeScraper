// Presto schedule parsers: the HTML card list (`.event-row`) and the `?print=rss` feed.
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { GameState, ScheduleEntry } from '../../../model.js';
import { int } from '../../../normalize/num.js';
import { absUrl, allTables, cellText, colIndex, isoDate, monthIndex, parseDateText, parseMonthDay, parseResultText, seasonYearFor, to24h, txt, ws } from './util.js';

function emptyEntry(date: string, opponentName: string): ScheduleEntry {
  return {
    date,
    startTimeLocal: null,
    opponentName,
    opponentSiteId: null,
    homeAway: 'H',
    location: null,
    isConference: false,
    isExhibition: false,
    tournament: null,
    state: 'scheduled',
    result: null,
    boxScoreUrl: null,
    siteGameId: null,
    attendance: null,
  };
}

function stateFromStatus(status: string): GameState | null {
  const s = status.toLowerCase();
  if (!s) return null;
  if (/final/.test(s)) return 'final';
  if (/postpone|ppd/.test(s)) return 'postponed';
  if (/cancel/.test(s)) return 'cancelled';
  if (/live|in progress|\b(1st|2nd|ot|half)\b/.test(s)) return 'live';
  return null;
}

/** Strip a leading "at" / "vs" / "vs." token from an opponent label. */
function stripAtVs(s: string): { name: string; token: 'at' | 'vs' | null } {
  const m = ws(s).match(/^(at|vs\.?|versus)\s+(.+)$/i);
  if (!m) return { name: ws(s), token: null };
  return { name: ws(m[2]), token: /^at$/i.test(m[1]!) ? 'at' : 'vs' };
}

const ARIA_RE = /event:\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?(?:\s+(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?))?/;

function parseEventRow($: CheerioAPI, row: AnyNode, baseUrl: string, season: number): ScheduleEntry | null {
  const R = $(row);
  const cls = ` ${R.attr('class') ?? ''} `;

  // Date: month from the enclosing month section or the accessible link label; day from `.date`.
  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;
  let time: string | null = null;
  R.find('a[aria-label], [aria-label]').each((_, a) => {
    if (month) return;
    const m = ($(a).attr('aria-label') ?? '').match(ARIA_RE);
    if (!m) return;
    month = monthIndex(m[1]);
    day = Number(m[2]);
    if (m[3]) year = Number(m[3]);
    if (m[4]) time = to24h(m[4]);
  });
  if (!month) {
    const section = R.closest('[class*="section-event-month"], [class*="event-month"]');
    const scls = (section.attr('class') ?? '').split(/\s+/);
    for (const c of scls) {
      const mi = monthIndex(c);
      if (mi && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(c)) {
        month = mi;
        break;
      }
    }
    if (!month) month = monthIndex(txt(section.find('h2, h3, h4, .month-title, button').first()));
  }
  const dateText = txt(R.find('.date').first());
  if (day == null) {
    const full = parseDateText(dateText);
    if (full) {
      const [y, m, d] = full.split('-').map(Number);
      year = y!;
      month = m!;
      day = d!;
    } else {
      const dm = dateText.match(/(\d{1,2})\s*$/) ?? dateText.match(/(\d{1,2})/);
      if (dm) day = Number(dm[1]);
    }
  }
  if (!month || day == null) return null;
  const date = isoDate(year ?? seasonYearFor(month, season), month, day);

  const oppEl = R.find('.event-opponent-name .team-name, .event-opponent-name, .opponent-name, .team-name').first();
  const badge = txt(R.find('.event-location-badge, .location-badge').first()).toLowerCase();
  const { name: opponentName, token } = stripAtVs(txt(oppEl));
  if (!opponentName) return null;

  const e = emptyEntry(date, opponentName);
  e.startTimeLocal = time;
  const isNeutral = cls.includes(' neutral ') || /neutral/.test(badge);
  const isAway = cls.includes(' away ') || badge === 'at' || token === 'at';
  e.homeAway = isNeutral ? 'N' : isAway ? 'A' : 'H';

  const notations = R.find('.notation[title], .visually-hidden')
    .map((_, n) => ws($(n).attr('title') ?? $(n).text()).toLowerCase())
    .get();
  e.isConference = cls.includes(' conf ') || cls.includes(' conference ') || notations.some((n) => /^conference/.test(n));
  e.isExhibition = cls.includes(' exhibition ') || cls.includes(' exh ') || notations.some((n) => /exhibition/.test(n)) || /\bexh(ibition)?\b/i.test(opponentName);
  e.opponentSiteId = ws(oppEl.closest('[data-opponent-id]').attr('data-opponent-id') ?? R.attr('data-opponent-id')) || null;

  const venue = R.find('.venue, .event-venue, .event-location').first().clone();
  venue.find('.fa, .fa-regular, .fa-solid, [aria-hidden="true"]').remove();
  e.location = txt(venue) || null;
  const tourney = txt(R.find('.event-tournament, .tournament, .tournament-name').first());
  if (tourney) e.tournament = tourney;

  const statusText = txt(R.find('.status').first());
  const st = stateFromStatus(statusText);
  const resultText = txt(R.find('.event-result, .result').first());
  const result = parseResultText(resultText);
  if (result) {
    e.result = result;
    e.state = 'final';
  } else if (st) {
    e.state = st;
  } else {
    e.state = 'scheduled';
  }
  if (!e.startTimeLocal) e.startTimeLocal = to24h(statusText) ?? to24h(txt(R.find('.time').first()));

  const box = ws(R.attr('data-boxscore'));
  let boxHref: string | null = box || null;
  if (!boxHref) {
    const links = R.find('a[href*="boxscore"]')
      .map((_, a) => ws($(a).attr('href')))
      .get();
    boxHref = links.find((h) => /\.xml(\?|$)/i.test(h)) ?? links.find((h) => !/\.pdf(\?|$)/i.test(h)) ?? null;
  }
  e.boxScoreUrl = boxHref ? absUrl(baseUrl, boxHref) : null;
  const id = ws(R.attr('data-event-id')) || ws(R.attr('id')).replace(/^event-/, '');
  e.siteGameId = id || null;
  const att = ws(R.text()).match(/attendance:?\s*([\d,]+)/i);
  if (att) e.attendance = int(att[1]);
  return e;
}

/** Older Presto templates render the schedule as a table with Date | Opponent | ... columns. */
function parseScheduleTables($: CheerioAPI, baseUrl: string, season: number): ScheduleEntry[] {
  const out: ScheduleEntry[] = [];
  for (const t of allTables($)) {
    const di = colIndex(t.headers, 'date');
    const oi = colIndex(t.headers, 'opponent', 'opponents');
    if (di < 0 || oi < 0) continue;
    const ri = colIndex(t.headers, 'result', 'score', 'results');
    const li = colIndex(t.headers, 'location', 'site', 'venue');
    const ti = colIndex(t.headers, 'time', 'timeresult');
    for (const row of t.rows) {
      const date = parseMonthDay(row.texts[di] ?? '', season);
      const { name, token } = stripAtVs(row.texts[oi] ?? '');
      if (!date || !name) continue;
      const e = emptyEntry(date, name.replace(/[*~^#]+$/g, '').trim());
      const rowCls = ` ${$(row.el).attr('class') ?? ''} `;
      e.homeAway = rowCls.includes(' neutral ') ? 'N' : token === 'at' || rowCls.includes(' away ') ? 'A' : 'H';
      e.isConference = /\*/.test(row.texts[oi] ?? '') || rowCls.includes(' conf ');
      if (li >= 0) e.location = row.texts[li] || null;
      const rt = ri >= 0 ? row.texts[ri] ?? '' : '';
      const result = parseResultText(rt);
      if (result) {
        e.result = result;
        e.state = 'final';
      } else e.state = stateFromStatus(rt) ?? 'scheduled';
      if (ti >= 0) e.startTimeLocal = to24h(row.texts[ti]);
      const box = $(row.el).find('a[href*="boxscore"]').first().attr('href');
      e.boxScoreUrl = box ? absUrl(baseUrl, box) : null;
      out.push(e);
    }
  }
  return out;
}

export function parseScheduleHtml(html: string, baseUrl: string, season: number): ScheduleEntry[] {
  const $ = cheerio.load(html);
  const out: ScheduleEntry[] = [];
  $('.event-row').each((_, row) => {
    const e = parseEventRow($, row, baseUrl, season);
    if (e) out.push(e);
  });
  if (out.length === 0) out.push(...parseScheduleTables($, baseUrl, season));
  return out;
}

function childText($: CheerioAPI, item: AnyNode, name: string): string {
  const el = $(item)
    .children()
    .toArray()
    .find((c) => c.type === 'tag' && c.name.toLowerCase() === name.toLowerCase());
  return el ? ws($(el).text()) : '';
}

const DESC_RE = /\bon\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+at\s+(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?))?/;

/**
 * `/sports/<sport>/<season>/schedule?print=rss`. The feed carries no box score links and no
 * conference/exhibition flags; `ps:opponent` is "at X" for road games, "vs X"/"vs. X" for neutral sites.
 */
export function parseScheduleRss(xml: string, _baseUrl: string, _season: number): ScheduleEntry[] {
  const $ = cheerio.load(xml, { xml: true });
  const channelTitle = ws($('channel > title').first().text());
  const ourName = (channelTitle.match(/^\d{4}(?:-\d{2})?\s+(.+?)\s+(?:Men'?s|Women'?s)\b/i)?.[1] ?? '').trim();
  const out: ScheduleEntry[] = [];
  $('item').each((_, item) => {
    const title = childText($, item, 'title');
    const desc = childText($, item, 'description');
    const score = childText($, item, 'ps:score');
    const oppRaw = childText($, item, 'ps:opponent');
    const link = childText($, item, 'link') || childText($, item, 'guid');
    const dcDate = childText($, item, 'dc:date') || childText($, item, 'pubDate');

    let date: string | null = null;
    let time: string | null = null;
    const dm = desc.match(DESC_RE);
    if (dm) {
      const mo = monthIndex(dm[1]);
      if (mo) date = isoDate(Number(dm[3]), mo, Number(dm[2]));
      if (dm[4]) time = to24h(dm[4]);
    }
    if (!date && dcDate) {
      const d = new Date(dcDate);
      if (!Number.isNaN(d.getTime())) date = d.toISOString().slice(0, 10); // UTC fallback; may be a day late for evening games
    }
    if (!date) return;

    let opponentName = '';
    let homeAway: 'H' | 'A' | 'N' = 'H';
    if (oppRaw) {
      const { name, token } = stripAtVs(oppRaw);
      opponentName = name;
      homeAway = token === 'at' ? 'A' : token === 'vs' ? 'N' : 'H';
    } else {
      // "Visitor 0, Home 1 Final" — pick the side that is not us.
      const tm = title.match(/^(.+?)\s+\d+,\s+(.+?)\s+\d+/);
      if (tm && ourName) {
        const a = ws(tm[1]);
        const b = ws(tm[2]);
        if (a.toLowerCase() === ourName.toLowerCase()) {
          opponentName = b;
          homeAway = 'A';
        } else {
          opponentName = a;
          homeAway = 'H';
        }
      }
    }
    if (!opponentName) return;
    const e = emptyEntry(date, opponentName);
    e.startTimeLocal = time;
    e.homeAway = homeAway;
    const result = parseResultText(score);
    if (result) {
      e.result = result;
      e.state = 'final';
    } else {
      e.state = stateFromStatus(`${title} ${desc}`) ?? 'scheduled';
    }
    e.isExhibition = /exhibition|\(exh/i.test(`${title} ${desc}`);
    const frag = link.split('#')[1];
    e.siteGameId = frag ? ws(frag) : null;
    out.push(e);
  });
  return out;
}

/** Cheap check used by the adapter to decide whether the RSS fallback is needed. */
export function scheduleHasRows(entries: ScheduleEntry[]): boolean {
  return entries.length > 0;
}

export { cellText as _cellText };
