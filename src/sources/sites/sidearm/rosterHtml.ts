// Fallback parser for a server-rendered Sidearm roster page. Handles:
//  - legacy markup: <li class="sidearm-roster-player"> with sidearm-roster-player-{name,position,...}
//  - Nuxt "nextgen" markup: .c-rosterpage__* / .s-person-card* cards with dt/dd or bio-stats items
import { load, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { Coach, Roster, RosterPlayer, SiteContext } from '../../../model.js';
import { int } from '../../../normalize/num.js';
import { cleanName, splitName } from '../../../normalize/names.js';
import { absUrl, collapse, nameJerseyKey } from './common.js';

type Cheerio = ReturnType<CheerioAPI>;

const CLASS_RE = /^(r-|rs-|redshirt\s+)?(fr|so|jr|sr|gr|grad|graduate|freshman|sophomore|junior|senior|5th|fifth|6th|sixth|first[- ]year)\b/i;
const HEIGHT_RE = /^\d\s*[-'’]\s*\d{1,2}(?:\.\d)?(?:"|'')?$/;
const WEIGHT_RE = /^(\d{2,3})\s*(?:lbs?\.?|pounds)?$/i;
const POS_RE = /^(gk|g|d|m|f|d\/m|m\/d|m\/f|f\/m|d\/f|goalkeeper|goalie|keeper|defender|defense|midfielder|midfield|forward|striker|back|wing(?:er)?)$/i;

function text(el: Cheerio): string | null {
  return collapse(el.first().text());
}

function idFromRosterHref(href: string | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/roster\/[^/?#]+\/(\d+)(?:[/?#]|$)/);
  return m ? m[1]! : null;
}

interface Fields {
  position: string | null; height: string | null; weight: number | null; classYear: string | null;
  hometown: string | null; highSchool: string | null; previousSchool: string | null; major: string | null; jersey: number | null;
}

function emptyFields(): Fields {
  return { position: null, height: null, weight: null, classYear: null, hometown: null, highSchool: null, previousSchool: null, major: null, jersey: null };
}

/** Assign a "Label: value" pair (or an unlabeled value) to the right field. */
function assign(f: Fields, label: string | null, value: string | null): void {
  const v = collapse(value);
  if (!v) return;
  const l = (label ?? '').toLowerCase().replace(/[:.]/g, '').trim();
  if (l) {
    if (/^(pos|position)/.test(l)) { f.position ??= v; return; }
    if (/^(ht|height)/.test(l)) { f.height ??= v; return; }
    if (/^(wt|weight)/.test(l)) { f.weight ??= int(v.replace(/[^\d.]/g, '')); return; }
    if (/^(cl|class|year|academic|yr|elig)/.test(l)) { f.classYear ??= v; return; }
    if (/^(hometown|home town)/.test(l)) { f.hometown ??= v; return; }
    if (/^(high school|hs|highschool)/.test(l)) { f.highSchool ??= v; return; }
    if (/^(previous|prev|last school|last college|transfer)/.test(l)) { f.previousSchool ??= v; return; }
    if (/^(major)/.test(l)) { f.major ??= v; return; }
    if (/^(no|#|number|jersey)/.test(l)) { f.jersey ??= int(v.replace(/\D/g, '')); return; }
    if (/^(hometown\s*\/\s*high school|hometown\/high school)/.test(l)) {
      const [ht, hs] = v.split(/\s*\/\s*/);
      f.hometown ??= ht ?? null; f.highSchool ??= hs ?? null; return;
    }
  }
  // Unlabeled: classify by shape.
  if (HEIGHT_RE.test(v)) { f.height ??= v; return; }
  if (WEIGHT_RE.test(v) && /lb|pound/i.test(v)) { f.weight ??= int(v.replace(/[^\d.]/g, '')); return; }
  if (CLASS_RE.test(v)) { f.classYear ??= v; return; }
  if (POS_RE.test(v)) { f.position ??= v; return; }
  if (/^#?\d{1,2}$/.test(v)) { f.jersey ??= int(v.replace('#', '')); return; }
  if (v.includes(',') && !f.hometown) { f.hometown = v; return; }
  if (!f.hometown && !f.highSchool) return;
  if (!f.highSchool) { f.highSchool = v; return; }
  f.previousSchool ??= v;
}

function collectDlPairs($: CheerioAPI, card: Cheerio, f: Fields): void {
  card.find('dl').each((_, dl) => {
    const dts = $(dl).find('dt');
    dts.each((_, dt) => {
      const dd = $(dt).nextAll('dd').first();
      assign(f, collapse($(dt).text()), collapse(dd.text()));
    });
  });
  card.find('[class*="bio-stats-item"], [class*="s-person-details__bio-stats"] li, .s-person-card__content-bio-stats li').each((_, li) => {
    const label = $(li).find('[class*="label"], span:first-child, strong').first();
    const labelText = collapse(label.text());
    const full = collapse($(li).text());
    if (!full) return;
    if (labelText && full.startsWith(labelText) && full.length > labelText.length) assign(f, labelText, full.slice(labelText.length));
    else if (/^[^:]{1,20}:\s*\S/.test(full)) { const [l, ...rest] = full.split(':'); assign(f, l ?? null, rest.join(':')); }
    else assign(f, null, full);
  });
}

function parseLegacyPlayer($: CheerioAPI, li: Element, ctx: SiteContext): RosterPlayer | null {
  const el = $(li);
  const nameLink = el.find('.sidearm-roster-player-name a').first();
  const nameBox = el.find('.sidearm-roster-player-name').first();
  const boxClone = nameBox.clone();
  boxClone.find('span').filter((_, s) => /jersey|number/.test($(s).attr('class') ?? '')).remove();
  const nameText = collapse(nameLink.text()) ?? collapse(boxClone.text());
  if (!nameText) return null;
  const { firstName, lastName } = splitName(nameText.replace(/^#?\d+\s+/, ''));
  const href = el.find('.sidearm-roster-player-name a, a[href*="/roster/"]').first().attr('href');
  const f = emptyFields();
  const jerseyText = text(el.find('.sidearm-roster-player-jersey-number'));
  f.jersey = int((jerseyText ?? '').replace(/\D/g, ''));
  f.position = text(el.find('.sidearm-roster-player-position .text-bold, .sidearm-roster-player-position-long-short').first())
    ?? (collapse(el.find('.sidearm-roster-player-position').clone().children().remove().end().text()) || null);
  f.height = text(el.find('.sidearm-roster-player-height'));
  f.weight = int((text(el.find('.sidearm-roster-player-weight')) ?? '').replace(/[^\d.]/g, ''));
  f.classYear = text(el.find('.sidearm-roster-player-academic-year'));
  f.hometown = text(el.find('.sidearm-roster-player-hometown'));
  f.highSchool = text(el.find('.sidearm-roster-player-highschool'));
  f.previousSchool = text(el.find('.sidearm-roster-player-previous-school'));
  f.major = text(el.find('.sidearm-roster-player-major'));
  if (f.position && /^\d/.test(f.position)) f.position = f.position.replace(/^\d+\s*/, '') || null;
  const id = idFromRosterHref(href) ?? el.attr('data-player-id') ?? null;
  const img = el.find('img').first().attr('data-src') ?? el.find('img').first().attr('src');
  return build(ctx, firstName, lastName, id, href, img, f, el.find('.sidearm-roster-player-captain, [class*="captain"]').length > 0);
}

function parseNextgenPlayer($: CheerioAPI, cardEl: Element, ctx: SiteContext): RosterPlayer | null {
  const card = $(cardEl);
  const link = card.find('a[href*="/roster/"]').first();
  const nameEl = card.find('[class*="s-person-details__personal-single-line"], [class*="__name"], h3, h2, [class*="s-person-card__name"]').first();
  let nameText = collapse(nameEl.text()) ?? collapse(link.text());
  if (!nameText) return null;
  const lead = nameText.match(/^#?(\d{1,2})\s+/);
  nameText = nameText.replace(/^#?\d{1,2}\s+/, '');
  const { firstName, lastName } = splitName(nameText);
  const href = link.attr('href');
  const f = emptyFields();
  const jerseyEl = card.find('[class*="jersey"], [class*="s-stamp__text"], [class*="__number"]').first();
  f.jersey = int((collapse(jerseyEl.text()) ?? '').replace(/\D/g, '')) ?? (lead ? int(lead[1]) : null);
  collectDlPairs($, card, f);
  if (!f.position && !f.height && !f.classYear) {
    // Try generic label/value pairs ("Position: GK" etc.) anywhere in the card text.
    const t = collapse(card.text()) ?? '';
    for (const m of t.matchAll(/(Position|Height|Weight|Class|Year|Hometown|High School|Previous School|Major)\s*:\s*([^:]+?)(?=\s+(?:Position|Height|Weight|Class|Year|Hometown|High School|Previous School|Major)\s*:|$)/gi)) {
      assign(f, m[1] ?? null, m[2] ?? null);
    }
  }
  const id = idFromRosterHref(href);
  const img = card.find('img').first().attr('data-src') ?? card.find('img').first().attr('src');
  return build(ctx, firstName, lastName, id, href, img, f, /captain/i.test(card.attr('class') ?? '') || card.find('[class*="captain"]').length > 0);
}

function build(ctx: SiteContext, firstName: string, lastName: string, id: string | null, href: string | undefined, img: string | undefined, f: Fields, isCaptain: boolean): RosterPlayer {
  return {
    sourceKey: id ?? nameJerseyKey(lastName, firstName, f.jersey),
    sitePlayerId: id,
    firstName: cleanName(firstName),
    lastName: cleanName(lastName),
    jersey: f.jersey,
    positionRaw: f.position,
    classRaw: f.classYear,
    heightRaw: f.height,
    weightLb: f.weight,
    hometownRaw: f.hometown,
    highSchool: f.highSchool,
    previousSchool: f.previousSchool,
    major: f.major,
    isCaptain,
    headshotUrl: absUrl(ctx.baseUrl, img),
    bioUrl: absUrl(ctx.baseUrl, href),
  };
}

function parseCoaches($: CheerioAPI, ctx: SiteContext): Coach[] {
  const out: Coach[] = [];
  const push = (name: string | null, title: string | null, img: string | undefined) => {
    if (!name) return;
    out.push({
      name: cleanName(name), title,
      isHead: !!title && /head coach/i.test(title) && !/assistant|associate|assoc\.|asst\.?/i.test(title),
      headshotUrl: absUrl(ctx.baseUrl, img),
    });
  };
  $('.sidearm-roster-coach').each((_, el) => {
    const e = $(el);
    push(text(e.find('.sidearm-roster-coach-name')), text(e.find('.sidearm-roster-coach-title')), e.find('img').first().attr('data-src') ?? e.find('img').first().attr('src'));
  });
  if (out.length) return out;
  // Nextgen: a coaches/staff section holding person cards.
  $('[class*="coaches"], [class*="staff"], section, div').filter((_, el) => {
    const heading = $(el).children('h2, h3, h4, [class*="heading"]').first().text();
    return /coach|staff/i.test(heading);
  }).first().find('[class*="s-person-card"], [class*="c-rosterpage__coach"], li').each((_, el) => {
    const e = $(el);
    const link = e.find('a[href*="/coaches/"], a[href*="/staff"], a').first();
    const name = collapse(e.find('[class*="__name"], [class*="personal-single-line"], h3').first().text()) ?? collapse(link.text());
    const title = collapse(e.find('[class*="title"], [class*="position"], dd').first().text());
    if (name && !out.some((c) => c.name === name)) push(name, title, e.find('img').first().attr('src'));
  });
  return out;
}

/** Parse a Sidearm HTML roster page (legacy or nextgen markup) into the canonical Roster. */
export function parseRosterHtml(html: string, ctx: SiteContext, sourceUrl: string): Roster {
  const $ = load(html);
  const players: RosterPlayer[] = [];
  const seen = new Set<string>();
  const add = (p: RosterPlayer | null) => {
    if (!p || seen.has(p.sourceKey)) return;
    seen.add(p.sourceKey);
    players.push(p);
  };
  $('li.sidearm-roster-player, .sidearm-roster-player').each((_, el) => add(parseLegacyPlayer($, el, ctx)));
  if (!players.length) {
    const cards = $('[class*="s-person-card"]').filter((_, el) => {
      const cls = $(el).attr('class') ?? '';
      return /(^|\s)s-person-card(\s|$)/.test(cls) || /s-person-card--/.test(cls) || /c-rosterpage__player(\s|$)/.test(cls);
    });
    cards.each((_, el) => add(parseNextgenPlayer($, el, ctx)));
    if (!players.length) $('.c-rosterpage__players li, .c-rosterpage__player, [class*="c-rosterpage__players"] > *').each((_, el) => add(parseNextgenPlayer($, el, ctx)));
  }
  if (!players.length) {
    // Table-based roster (older templates): header row drives the column mapping.
    $('table').each((_, table) => {
      const headers = $(table).find('thead th, tr:first-child th').map((_, th) => collapse($(th).text())?.toLowerCase() ?? '').get();
      if (!headers.some((h) => /name/.test(h))) return;
      $(table).find('tbody tr').each((_, tr) => {
        const cells = $(tr).find('td');
        const f = emptyFields();
        let name: string | null = null;
        let href: string | undefined;
        cells.each((i, td) => {
          const h = headers[i] ?? '';
          const v = collapse($(td).text());
          if (/name/.test(h)) { name = v; href = $(td).find('a').attr('href'); return; }
          assign(f, h, v);
        });
        if (!name) return;
        const { firstName, lastName } = splitName(name);
        add(build(ctx, firstName, lastName, idFromRosterHref(href), href, undefined, f, false));
      });
    });
  }
  return { players, coaches: parseCoaches($, ctx), sourceUrl };
}
