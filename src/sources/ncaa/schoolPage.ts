// https://www.ncaa.com/schools/{seo} — official athletics site link, logos, colors, conference.
//
// Markup (2026-09): <div class="school-links" style="background-color: #002368" <div class="layout-content">
// — note the unclosed <div> tag, so the athletics <ul> may be parsed as a child of either div; the
// first http(s) <a href> inside the links block that is not a social network is the athletics site.
import * as cheerio from 'cheerio';
import { hostOf } from '../../normalize/teamIdentity.js';

export const NCAA_LOGO_BASE = 'https://www.ncaa.com/sites/default/files/images/logos/schools';

export function schoolPageUrl(seo: string): string {
  return `https://www.ncaa.com/schools/${seo}`;
}

export function logoUrls(seo: string): { light: string; dark: string } {
  return { light: `${NCAA_LOGO_BASE}/bgl/${seo}.svg`, dark: `${NCAA_LOGO_BASE}/bgd/${seo}.svg` };
}

export interface SchoolPage {
  seo: string;
  name: string | null;
  athleticsUrl: string | null;
  athleticsHost: string | null;
  /** `.../logos/schools/bgl/{seo}.svg` — for light backgrounds. */
  logoLightUrl: string;
  /** `.../logos/schools/bgd/{seo}.svg` — for dark backgrounds. */
  logoDarkUrl: string;
  colors?: { text: string | null; primaryHex: string | null; hexes: string[] };
  conference: string | null;
  nickname: string | null;
  division: string | null;
  location: string | null;
  social: { twitter: string | null; facebook: string | null; instagram: string | null };
}

const SOCIAL = /(twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|tiktok\.com)/i;

export function parseSchoolPage(html: string, seo: string): SchoolPage {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $('.school-links a[href], div.layout-content > ul > li > a[href]').each((_, a) => {
    const href = ($(a).attr('href') ?? '').trim();
    if (/^https?:\/\//i.test(href) && !links.includes(href)) links.push(href);
  });
  if (links.length === 0) {
    // Fallback for the malformed tag: regex the links block directly.
    const block = html.match(/class="school-links"[\s\S]{0,4000}?<\/ul>/)?.[0] ?? '';
    for (const m of block.matchAll(/href="(https?:\/\/[^"]+)"/g)) if (!links.includes(m[1]!)) links.push(m[1]!);
  }
  const rawAthletics = links.find((h) => !SOCIAL.test(h)) ?? null;
  // Some school pages carry "https://https://host/" or bare hosts; normalise to one scheme + lowercase host.
  const athleticsUrl = rawAthletics ? rawAthletics.replace(/^(https?:\/\/)+/i, 'https://').replace(/^https:\/\/([^/]+)/, (_m, h) => `https://${String(h).toLowerCase()}`) : null;
  const social = {
    twitter: links.find((h) => /twitter\.com|x\.com/i.test(h)) ?? null,
    facebook: links.find((h) => /facebook\.com/i.test(h)) ?? null,
    instagram: links.find((h) => /instagram\.com/i.test(h)) ?? null,
  };

  const derived = logoUrls(seo);
  const logoSrcs = new Set<string>();
  for (const m of html.matchAll(/https:\/\/www\.ncaa\.com\/sites\/default\/files\/images\/logos\/schools\/(bgl|bgd)\/([a-z0-9-]+)\.svg/g)) {
    if (m[2] === seo) logoSrcs.add(m[0]);
  }
  const logoLightUrl = [...logoSrcs].find((u) => u.includes('/bgl/')) ?? derived.light;
  const logoDarkUrl = [...logoSrcs].find((u) => u.includes('/bgd/')) ?? derived.dark;

  const detail = (label: string): string | null => {
    let out: string | null = null;
    $('dl.school-details dt').each((_, dt) => {
      if ($(dt).text().trim().toLowerCase() === label) out = $(dt).next('dd').text().replace(/\s+/g, ' ').trim() || null;
    });
    return out;
  };
  const colorsText = detail('colors');
  const hexes: string[] = [];
  const addHex = (h: string | undefined) => { if (h && !hexes.includes(h.toUpperCase())) hexes.push(h.toUpperCase()); };
  addHex(html.match(/class="school-links"[^>]{0,200}?background-color:\s*(#[0-9a-fA-F]{6})/)?.[1]);
  addHex(html.match(/\.no-thumb\s*\{[^}]*background-color:\s*(#[0-9a-fA-F]{6})/)?.[1]);
  const colors = colorsText || hexes.length > 0 ? { text: colorsText, primaryHex: hexes[0] ?? null, hexes } : undefined;

  const divLoc = $('.division-location').text().replace(/\s+/g, ' ').trim();
  const divLocParts = divLoc.split(/\s+-\s+/);
  const name = $('h1.school-name').first().text().trim() || null;

  const page: SchoolPage = {
    seo,
    name,
    athleticsUrl,
    athleticsHost: hostOf(athleticsUrl),
    logoLightUrl,
    logoDarkUrl,
    conference: detail('conference'),
    nickname: detail('nickname'),
    division: divLocParts[0]?.trim() || null,
    location: divLocParts.slice(1).join(' - ').trim() || null,
    social,
  };
  if (colors) page.colors = colors;
  return page;
}
