// One parser for every news feed we read: RSS 2.0 (school sites, BBC, ESPN, most publishers) and Atom. Returns the
// headline, link, time, the picture the feed supplies (shown from the publisher's own server, never copied) and the
// lede as plain text (the lede only feeds our tagging rules; it is never shown).
import { load } from 'cheerio';

export interface FeedItem {
  title: string;
  url: string;
  published: Date | null;
  /** The feed's summary as plain text, at most 600 characters. */
  lede: string;
  categories: string[];
  /** The story's picture as the feed gives it (media:thumbnail, media:content, an image enclosure, the first <img>),
   *  https only; null when the feed has none. */
  image: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };

/** HTML (or escaped HTML) to plain text: tags dropped, entities decoded, spaces collapsed. */
export function plainText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** A picture url we can show on an https page: http is upgraded (most publishers serve both), anything else dropped.
 *  Tracking pixels and icons (1x1 gifs, feed logos) are left out. */
export function imageUrl(raw: string | null | undefined, base?: string): string | null {
  const s = String(raw ?? '').replace(/&amp;/g, '&').trim();
  if (!s || s.startsWith('data:')) return null;
  let u: URL;
  try { u = new URL(s, base); } catch { return null; }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') return null;
  if (/(?:pixel|spacer|blank|tracking|feedburner|favicon|\/logo)[^/]*$|\.(?:svg|ico)(?:$|\?)/i.test(u.pathname)) return null;
  // The BBC's feed gives a 240px picture; its image server has the same one at 480 (sharp on high-density screens).
  if (u.hostname === 'ichef.bbci.co.uk') u.pathname = u.pathname.replace(/\/(ace\/(?:standard|ws))\/240\//, '/$1/480/');
  return u.toString().slice(0, 1000);
}

/** The first <img src> in a block of (escaped) HTML. */
function firstImg(html: string): string | null {
  const m = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').match(/<img\b[^>]*?\ssrc=["']([^"']+)["']/i);
  return m?.[1] ?? null;
}

function date(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Only http(s) links, without tracking parameters (so the same story from two feeds has one url). */
export function cleanUrl(raw: string, base?: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim(), base); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|at_|cmp|ito|ocid|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.toString();
}

export function parseFeed(xml: string, base?: string): FeedItem[] {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000))) return [];
  const $ = load(xml, { xml: true });
  const out: FeedItem[] = [];
  const push = (title: string, link: string | undefined, when: string | undefined, lede: string, cats: string[], image: string | null) => {
    const url = link ? cleanUrl(link, base) : null;
    const t = plainText(title);
    if (!url || !t) return;
    out.push({ title: t.slice(0, 300), url, published: date(when), lede: plainText(lede).slice(0, 600), categories: cats.map((c) => plainText(c)).filter(Boolean), image: imageUrl(image, url) });
  };
  // The biggest media:thumbnail or image media:content (some feeds list several sizes), else an image enclosure, else
  // the first <img> in the description or the full content.
  const pictureOf = (it: ReturnType<typeof $>): string | null => {
    const media: { url: string; w: number }[] = [];
    it.find('media\\:thumbnail, media\\:content, thumbnail, content[url]').each((_, m) => {
      const e = $(m), url = e.attr('url');
      const type = (e.attr('type') ?? '').toLowerCase(), medium = (e.attr('medium') ?? '').toLowerCase();
      if (!url || (type && !type.startsWith('image/')) || (medium && medium !== 'image')) return;
      if (!type && !medium && m.tagName.endsWith('content') && !/\.(?:jpe?g|png|webp|gif)(?:$|\?)/i.test(url)) return;
      media.push({ url, w: Number(e.attr('width')) || 0 });
    });
    if (media.length) return media.sort((a, b) => b.w - a.w)[0]!.url;
    const enc = it.children('enclosure').filter((_, e) => /^image\//i.test($(e).attr('type') ?? '')).first().attr('url')
      ?? it.children('link[rel="enclosure"]').filter((_, e) => /^image\//i.test($(e).attr('type') ?? '')).first().attr('href');
    if (enc) return enc;
    return firstImg(it.children('description').first().text() || it.children('content\\:encoded').first().text() || it.children('content').first().text() || it.children('summary').first().text());
  };
  $('item').each((_, el) => {
    const it = $(el);
    push(
      it.children('title').first().text(),
      it.children('link').first().text() || it.children('guid').first().text(),
      it.children('pubDate').first().text() || it.children('dc\\:date').first().text(),
      it.children('description').first().text(),
      it.children('category').map((_, c) => $(c).text()).get(),
      pictureOf(it),
    );
  });
  $('entry').each((_, el) => {
    const it = $(el);
    const link = it.children('link[rel="alternate"]').attr('href') ?? it.children('link').first().attr('href');
    push(
      it.children('title').first().text(),
      link,
      it.children('published').first().text() || it.children('updated').first().text(),
      it.children('summary').first().text() || it.children('content').first().text(),
      it.children('category').map((_, c) => $(c).attr('term') ?? '').get(),
      pictureOf(it),
    );
  });
  return out;
}

/** GDELT DOC 2.0 artlist JSON ({articles:[{url,title,seendate:'20261012T201500Z',socialimage,domain,language}]}). */
export function parseGdelt(body: string): FeedItem[] {
  let j: any;
  try { j = JSON.parse(body); } catch { return []; }
  const out: FeedItem[] = [];
  for (const a of Array.isArray(j?.articles) ? j.articles : []) {
    const url = typeof a.url === 'string' ? cleanUrl(a.url) : null;
    const title = plainText(String(a.title ?? ''));
    if (!url || !title || (a.language && a.language !== 'English')) continue;
    const m = String(a.seendate ?? '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    out.push({ title: title.slice(0, 300), url, published: m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : null, lede: '', categories: [], image: imageUrl(a.socialimage, url) });
  }
  return out;
}

/** Guardian Content API search response (results with webTitle, webUrl, webPublicationDate, fields.trailText and
 *  fields.thumbnail, tags). */
export function parseGuardian(body: string): FeedItem[] {
  let j: any;
  try { j = JSON.parse(body); } catch { return []; }
  const out: FeedItem[] = [];
  for (const r of Array.isArray(j?.response?.results) ? j.response.results : []) {
    const url = typeof r.webUrl === 'string' ? cleanUrl(r.webUrl) : null;
    const title = plainText(String(r.webTitle ?? ''));
    if (!url || !title) continue;
    const tags = Array.isArray(r.tags) ? r.tags.filter((t: any) => t.type === 'keyword').map((t: any) => String(t.webTitle ?? '')) : [];
    out.push({ title: title.slice(0, 300), url, published: date(r.webPublicationDate), lede: plainText(String(r.fields?.trailText ?? '')).slice(0, 600), categories: tags, image: imageUrl(r.fields?.thumbnail, url) });
  }
  return out;
}

/** RSS or Atom feeds a web page announces (<link rel="alternate" type="application/rss+xml" href="...">). */
export function feedLinks(html: string, base: string): string[] {
  const $ = load(html);
  const out: string[] = [];
  $('link[rel="alternate"]').each((_, el) => {
    const type = ($(el).attr('type') ?? '').toLowerCase();
    const href = $(el).attr('href');
    if (!href || !/(rss|atom)\+xml/.test(type)) return;
    const u = cleanUrl(href, base);
    if (u && !/comments/i.test(u)) out.push(u);
  });
  return [...new Set(out)];
}
