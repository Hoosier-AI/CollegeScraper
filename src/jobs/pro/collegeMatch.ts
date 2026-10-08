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
/** Institutional names ("Georgetown University") first, short names ("Georgetown (KY)", parenthetical kept) second. */
export interface SchoolIndex { long: Map<string, string>; short: Map<string, string> }

function keyed(pairs: [string, string][]): Map<string, string> {
  const m = new Map<string, string>(); const ambiguous = new Set<string>();
  for (const [k, seo] of pairs) {
    if (!k || ambiguous.has(k)) continue;
    const prev = m.get(k);
    if (prev && prev !== seo) { m.delete(k); ambiguous.add(k); } else m.set(k, seo);
  }
  return m;
}

export function schoolIndex(schools: SchoolLite[]): SchoolIndex {
  return {
    long: keyed(schools.filter((s) => s.long_name).map((s) => [teamKey(s.long_name), s.seo])),
    short: keyed(schools.map((s) => [teamKey(s.name.replace(/[()]/g, ' ')), s.seo])),
  };
}

/**
 * "University of North Carolina at Chapel Hill" -> "north-carolina". The whole name first, then shorter leading
 * parts ("north carolina chapel hill" -> "north carolina"), never shorter than two words unless the name is one word.
 */
export function resolveSchool(index: SchoolIndex, label: string): string | null {
  const words = teamKey(label.replace(/,.*$/, '')).split(' ').filter(Boolean);
  if (!words.length) return null;
  for (const m of [index.long, index.short]) {
    for (let n = words.length; n >= Math.min(2, words.length); n -= 1) {
      const hit = m.get(words.slice(0, n).join(' '));
      if (hit) return hit;
    }
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

// Footballers born since 1980 (today's pros) with a US "educated at". No labels here: the label service pushes the
// query past the public endpoint's 60 s limit, so names come afterwards from wbgetentities, and only for the rows
// whose birth date matches one of our players.
export const WIKIDATA_QUERY = `SELECT ?p ?dob ?sex ?college ?start ?end WHERE {
  ?p wdt:P106 wd:Q937857 ;
     wdt:P569 ?dob ;
     p:P69 ?st .
  FILTER(?dob >= "1980-01-01T00:00:00Z"^^xsd:dateTime)
  ?st ps:P69 ?college .
  ?college wdt:P17 wd:Q30 .
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?p wdt:P21 ?sex }
}`;

export interface WikiRaw { qid: string; dob: string | null; gender: 'm' | 'w' | null; collegeQid: string; start: number | null; end: number | null }
interface SparqlBinding { [k: string]: { value: string } | undefined }
const qidOf = (uri: string) => uri.replace(/^.*\//, '');
export function parseWikidata(json: { results?: { bindings?: SparqlBinding[] } }): WikiRaw[] {
  const year = (v: string | undefined) => { const m = /^(\d{4})/.exec(v ?? ''); return m ? Number(m[1]) : null; };
  return (json.results?.bindings ?? []).filter((b) => b.p && b.college).map((b) => ({
    qid: qidOf(b.p!.value), dob: b.dob?.value?.slice(0, 10) ?? null, gender: genderFromWikidata(b.sex?.value),
    collegeQid: qidOf(b.college!.value), start: year(b.start?.value), end: year(b.end?.value),
  }));
}

/** Raw rows plus English labels (QID -> label) -> rows to match; rows missing either label are dropped. */
export function withLabels(rows: WikiRaw[], labels: Map<string, string>): WikiRow[] {
  return rows.flatMap((r) => {
    const label = labels.get(r.qid); const college = labels.get(r.collegeQid);
    return label && college ? [{ qid: r.qid, label, dob: r.dob, gender: r.gender, college, start: r.start, end: r.end }] : [];
  });
}
