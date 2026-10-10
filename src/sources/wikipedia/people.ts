// Pure: Wikipedia club and player articles (CC BY-SA 4.0, the /wiki/ HTML robots.txt allows) and Wikidata items
// (CC0, /wiki/Special:EntityData/<Q>.json, which robots.txt also allows).
//   club article  -> its Wikidata item and current squad (the "football-squad" tables: number, position, player link)
//   player article -> its Wikidata item, the infobox (full name, birth date and place, height, position, current
//                     club, number) and the careers it lists (youth, college, senior, international: years, club,
//                     apps, goals, loans marked "→")
//   Wikidata item -> birth date, height, citizenship and position items (labels come from their own items)
import * as cheerio from 'cheerio';
import { wikiTitle } from './parse.js';

export const qidOf = (html: string): string | null => /"wgWikibaseItemId":"(Q\d+)"/.exec(html)?.[1] ?? null;
const clean = (s: string) => s.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
const int = (s: string | undefined): number | null => { const m = /-?\d+/.exec((s ?? '').replace(/,/g, '')); return m ? Number(m[0]) : null; };

export interface SquadPlayer { title: string; name: string; number: number | null; position: string | null }

/** A club article's Wikidata item and the players in its squad tables (first-team and on loan alike). */
export function parseClubPage(html: string): { qid: string | null; players: SquadPlayer[] } {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const players: SquadPlayer[] = [];
  $('table.football-squad tr').each((_, tr) => {
    const cells = $(tr).children('td').toArray();
    if (cells.length < 3) return;
    let pick: { title: string; name: string } | null = null;
    for (const c of cells) {
      // The player's link: not in the nationality cell (flag and federation), not the position article.
      if ($(c).find('.flagicon').length) continue;
      $(c).find('a').each((__, a) => {
        if (pick) return;
        const title = wikiTitle($(a).attr('href'));
        if (!title || /_\(association_football\)$|^Captain_|^Vice-captain/i.test(decodeURIComponent(title))) return;
        const name = clean($(a).text());
        if (name.length > 2) pick = { title, name };
      });
      if (pick) break;
    }
    if (!pick || seen.has((pick as { title: string }).title)) return;
    const p = pick as { title: string; name: string };
    seen.add(p.title);
    const pos = $(tr).find('abbr').first().text().trim() || null;
    players.push({ title: p.title, name: p.name, number: int($(cells[0]).text()), position: pos });
  });
  return { qid: qidOf(html), players };
}

export type CareerKind = 'senior' | 'youth' | 'college' | 'international';
export interface CareerRow { kind: CareerKind; seq: number; years: string | null; start_year: number | null; end_year: number | null; team: string; team_title: string | null; apps: number | null; goals: number | null; loan: boolean }
export interface PlayerPage {
  qid: string | null; name: string | null; birth_date: string | null; birth_place: string | null; height_cm: number | null; position: string | null;
  current_team: string | null; number: number | null; careers: CareerRow[];
}

/** "2015–", "2013–2014", "2019" -> start and end years (an open end is null). */
export function yearsOf(s: string): { start: number | null; end: number | null } {
  const ys = [...s.matchAll(/(\d{4})/g)].map((m) => Number(m[1]));
  if (!ys.length) return { start: null, end: null };
  const open = /[–-]\s*$/.test(s.trim());
  return { start: ys[0]!, end: open ? null : (ys[1] ?? ys[0]!) };
}

/** "5 ft 8 in (1.72 m)", "1.85 m (6 ft 1 in)", "185 cm" -> centimetres. */
export function heightCm(s: string): number | null {
  const m = /(\d)[.,](\d{2})\s*m\b/.exec(s);
  if (m) return Number(m[1]) * 100 + Number(m[2]);
  const c = /(\d{3})\s*cm/.exec(s);
  return c ? Number(c[1]) : null;
}

export function parsePlayerPage(html: string): PlayerPage {
  const $ = cheerio.load(html);
  const box = $('table.infobox').first();
  const out: PlayerPage = { qid: qidOf(html), name: null, birth_date: null, birth_place: null, height_cm: null, position: null, current_team: null, number: null, careers: [] };
  let kind: CareerKind | null = null;
  const seq: Record<CareerKind, number> = { senior: 0, youth: 0, college: 0, international: 0 };
  box.find('tr').each((_, tr) => {
    const th = clean($(tr).children('th').first().text());
    const tds = $(tr).children('td').toArray();
    const label = th.toLowerCase();
    // Section headers: "Senior career*", "Youth career", "College career", "International career‡".
    if (!tds.length || (tds.length === 1 && !th)) {
      if (/senior career/.test(label)) kind = 'senior';
      else if (/youth career/.test(label)) kind = 'youth';
      else if (/college career/.test(label)) kind = 'college';
      else if (/international career/.test(label)) kind = 'international';
      else if (label && !/^years$/.test(label)) kind = null;
      return;
    }
    const value = clean($(tds[0]).text());
    if (label === 'full name') out.name = value.replace(/\s*\(.*\)$/, '') || null;
    else if (label === 'date of birth') out.birth_date = $(tr).find('.bday').first().text().trim() || null;
    else if (label === 'place of birth') out.birth_place = value || null;
    else if (label === 'height') out.height_cm = heightCm(value);
    else if (label === 'position(s)' || label === 'position') out.position = value || null;
    else if (label === 'current team') out.current_team = value || null;
    else if (label === 'number') out.number = int(value);
    else if (kind && /\d{4}/.test(th) && tds.length >= 1) {
      const teamCell = $(tds[0]);
      const raw = clean(teamCell.text());
      const loan = /^→/.test(raw) || /\(loan\)/i.test(raw);
      const team = raw.replace(/^→\s*/, '').replace(/\s*\(loan\)\s*$/i, '').trim();
      if (!team) return;
      const { start, end } = yearsOf(th);
      seq[kind] += 1;
      out.careers.push({ kind, seq: seq[kind], years: th, start_year: start, end_year: end, team, team_title: wikiTitle(teamCell.find('a').first().attr('href')), apps: tds[1] ? int($(tds[1]).text()) : null, goals: tds[2] ? int($(tds[2]).text()) : null, loan });
    }
  });
  return out;
}

export interface WikidataPerson { qid: string; label: string | null; birth_date: string | null; height_cm: number | null; citizenship: string[]; positions: string[] }

type Claim = { mainsnak?: { datavalue?: { value?: any } }; rank?: string };
const claims = (e: any, p: string): Claim[] => ((e?.claims?.[p] ?? []) as Claim[]).filter((c) => c.rank !== 'deprecated');
const qids = (e: any, p: string): string[] => claims(e, p).map((c) => c.mainsnak?.datavalue?.value?.id).filter((x): x is string => typeof x === 'string');

/** A Wikidata item (Special:EntityData JSON) -> the person fields we use. */
export function parseWikidataPerson(json: any, qid: string): WikidataPerson {
  const e = json?.entities?.[qid] ?? Object.values(json?.entities ?? {})[0];
  const time = claims(e, 'P569')[0]?.mainsnak?.datavalue?.value?.time as string | undefined;
  // Day precision only (11): a year-only birth date ("+1990-00-00") is not a date.
  const precise = claims(e, 'P569')[0]?.mainsnak?.datavalue?.value?.precision === 11;
  const h = claims(e, 'P2048')[0]?.mainsnak?.datavalue?.value as { amount?: string; unit?: string } | undefined;
  let height: number | null = null;
  if (h?.amount) {
    const n = Number(h.amount);
    height = /Q11573$/.test(h.unit ?? '') ? Math.round(n * 100) : /Q174728$/.test(h.unit ?? '') ? Math.round(n) : null;
  }
  return {
    qid,
    label: e?.labels?.en?.value ?? null,
    birth_date: time && precise ? time.slice(1, 11) : null,
    height_cm: height && height > 140 && height < 220 ? height : null,
    citizenship: qids(e, 'P27'),
    positions: qids(e, 'P413'),
  };
}

/** The English label of any Wikidata item (a country, a position). */
export const wikidataLabel = (json: any, qid: string): string | null => (json?.entities?.[qid] ?? Object.values(json?.entities ?? {})[0] as any)?.labels?.en?.value ?? null;
