// Pure matching for "played college soccer at X": no I/O, so every rule is unit-tested.
//   Wikidata (CC0): a footballer whose "educated at" (P69) is a US school, matched to our pro player by birth date and
//   family name. Strong evidence: 0.95.
//   Name and age: our pro player's name key equals one NCAA player's, same gender, whose last college season came
//   0-4 years before the first pro season, at a plausible age. 0.85 when there is exactly one such college player,
//   0.5 when several share the name (kept for review, never shown).
import { teamKey } from '../../normalize/teamIdentity.js';
import { looseKey } from '../../sources/apiFootball/parse.js';

export const SHOW_AT = 0.85;

export interface SchoolLite { seo: string; name: string; long_name?: string | null }
export type SchoolIndex = Map<string, string>;

export function schoolIndex(schools: SchoolLite[]): SchoolIndex {
  const m: SchoolIndex = new Map();
  for (const s of schools) for (const n of [s.long_name, s.name]) { const k = teamKey(n); if (k && !m.has(k)) m.set(k, s.seo); }
  return m;
}

/**
 * "University of North Carolina at Chapel Hill" -> "north-carolina". The whole name first, then shorter leading
 * parts ("north carolina chapel hill" -> "north carolina"), never shorter than two words unless the name is one word.
 */
export function resolveSchool(index: SchoolIndex, label: string): string | null {
  const words = teamKey(label.replace(/,.*$/, '')).split(' ').filter(Boolean);
  if (!words.length) return null;
  for (let n = words.length; n >= Math.min(2, words.length); n -= 1) {
    const hit = index.get(words.slice(0, n).join(' '));
    if (hit) return hit;
  }
  return null;
}

export interface WikiRow { qid: string; label: string; dob: string | null; gender: 'm' | 'w' | null; college: string; start: number | null; end: number | null }
export interface ProLite { id: number; last_name: string | null; birth_date: string | null; gender: 'm' | 'w' | null }
export interface LinkProposal { pro_player_id: number; college_name: string; school_seo: string | null; college_player_id: string | null; first_season: number | null; last_season: number | null; method: 'wikidata' | 'name_age'; confidence: number; evidence: Record<string, unknown> }

export function matchWikidata(rows: WikiRow[], pros: ProLite[], schools: SchoolIndex): LinkProposal[] {
  const byDob = new Map<string, ProLite[]>();
  for (const p of pros) if (p.birth_date && p.last_name) { const k = p.birth_date.slice(0, 10); byDob.set(k, [...(byDob.get(k) ?? []), p]); }
  const out: LinkProposal[] = [];
  for (const r of rows) {
    if (!r.dob) continue;
    const label = looseKey(r.label);
    const cands = (byDob.get(r.dob.slice(0, 10)) ?? []).filter((p) => {
      const last = looseKey(p.last_name ?? '');
      return last.length >= 2 && label.endsWith(last) && (!r.gender || !p.gender || r.gender === p.gender);
    });
    if (cands.length !== 1) continue;
    const school = resolveSchool(schools, r.college);
    // Wikidata's "educated at" includes high schools; only US colleges we know, or names that say college/university.
    if (!school && !/\b(university|college|institute)\b/i.test(r.college)) continue;
    out.push({ pro_player_id: cands[0]!.id, college_name: r.college, school_seo: school, college_player_id: null, first_season: r.start, last_season: r.end, method: 'wikidata', confidence: 0.95, evidence: { qid: r.qid, label: r.label } });
  }
  return out;
}

export interface ProNameLite { id: number; name_key: string | null; birth_date: string | null; gender: 'm' | 'w' | null; first_season: number | null }
export interface CollegeLite { player_id: string; name_key: string; gender: 'm' | 'w'; seasons: number[]; school_seo: string; school_name: string }

export function matchNameAge(pros: ProNameLite[], college: CollegeLite[]): LinkProposal[] {
  const byKey = new Map<string, CollegeLite[]>();
  for (const c of college) { const k = `${c.name_key}|${c.gender}`; byKey.set(k, [...(byKey.get(k) ?? []), c]); }
  const out: LinkProposal[] = [];
  for (const p of pros) {
    if (!p.name_key || !p.gender || !p.first_season || /^\|/.test(p.name_key) || /\|$/.test(p.name_key)) continue;
    const born = p.birth_date ? Number(p.birth_date.slice(0, 4)) : null;
    const fits = (byKey.get(`${p.name_key}|${p.gender}`) ?? []).filter((c) => {
      const last = Math.max(...c.seasons);
      if (!(last <= p.first_season! && last >= p.first_season! - 4)) return false;
      // A fall season played at 17 to 25.
      return born == null || (last - born >= 17 && last - born <= 25);
    });
    if (!fits.length) continue;
    const confidence = fits.length === 1 ? (born != null ? 0.85 : 0.75) : 0.5;
    for (const c of fits) {
      out.push({ pro_player_id: p.id, college_name: c.school_name, school_seo: c.school_seo, college_player_id: c.player_id, first_season: Math.min(...c.seasons), last_season: Math.max(...c.seasons), method: 'name_age', confidence, evidence: { name_key: p.name_key, candidates: fits.length } });
    }
  }
  return out;
}

/** Wikidata gender items. */
export const genderFromWikidata = (uri: string | null | undefined): 'm' | 'w' | null =>
  !uri ? null : /Q6581072$|Q1052281$/.test(uri) ? 'w' : /Q6581097$|Q2449503$/.test(uri) ? 'm' : null;

export const WIKIDATA_QUERY = `SELECT ?p ?pLabel ?dob ?sex ?college ?collegeLabel ?start ?end WHERE {
  ?p wdt:P106 wd:Q937857 ;
     p:P69 ?st .
  ?st ps:P69 ?college .
  ?college wdt:P17 wd:Q30 .
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?p wdt:P569 ?dob }
  OPTIONAL { ?p wdt:P21 ?sex }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

interface SparqlBinding { [k: string]: { value: string } | undefined }
export function parseWikidata(json: { results?: { bindings?: SparqlBinding[] } }): WikiRow[] {
  const year = (v: string | undefined) => { const m = /^(\d{4})/.exec(v ?? ''); return m ? Number(m[1]) : null; };
  return (json.results?.bindings ?? []).filter((b) => b.p && b.collegeLabel && !/^Q\d+$/.test(b.collegeLabel.value)).map((b) => ({
    qid: b.p!.value.replace(/^.*\//, ''), label: b.pLabel?.value ?? '', dob: b.dob?.value?.slice(0, 10) ?? null, gender: genderFromWikidata(b.sex?.value),
    college: b.collegeLabel!.value, start: year(b.start?.value), end: year(b.end?.value),
  }));
}
