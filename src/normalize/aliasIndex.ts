// Opponent / poll / standings name → program resolution shared by the jobs.
// Index keys are teamKey() forms of every name we know for a program (NCAA short/long names, seo slug,
// name6, initialism of the long name) plus curated aliases from data/team-aliases.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { teamKey, nameInitials } from './teamIdentity.js';

export interface AliasProgramLike { id: string; gender: string; school_seo: string; name: string; short_name?: string | null; name6?: string | null }
export interface AliasSchoolLike { seo: string; name: string; long_name?: string | null }
export interface CuratedAlias { alias: string; seo: string; gender?: 'm' | 'w'; note?: string }

/** gender → teamKey → candidate program ids (several when the plain name is ambiguous, e.g. "Queens"). */
export type AliasIndex = Map<string, Map<string, string[]>>;

let curated: CuratedAlias[] | null = null;
export function curatedAliases(): CuratedAlias[] {
  if (curated) return curated;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = [resolve(here, '../../data/team-aliases.json'), resolve(process.cwd(), 'data/team-aliases.json')].find((f) => { try { readFileSync(f); return true; } catch { return false; } });
    curated = file ? (JSON.parse(readFileSync(file, 'utf8')).aliases as CuratedAlias[]) : [];
  } catch { curated = []; }
  return curated;
}

/** "Notre Dame (OH)" → "notre dame oh": keeps the disambiguating parenthetical as words. */
export function teamKeyKeepParens(name: string): string {
  return teamKey(name.replace(/[()]/g, ' '));
}

export function buildAliasIndex(programs: AliasProgramLike[], schools: Map<string, AliasSchoolLike>, extra: CuratedAlias[] = curatedAliases()): AliasIndex {
  const byGender: AliasIndex = new Map();
  const add = (gender: string, key: string | null | undefined, id: string) => {
    if (!key) return;
    let m = byGender.get(gender);
    if (!m) { m = new Map(); byGender.set(gender, m); }
    const cur = m.get(key) ?? [];
    if (!cur.includes(id)) { cur.push(id); m.set(key, cur); }
  };
  const addName = (gender: string, name: string | null | undefined, id: string) => {
    if (!name) return;
    add(gender, teamKey(name), id);
    add(gender, teamKeyKeepParens(name), id);
  };
  const bySeo = new Map<string, AliasProgramLike[]>();
  for (const p of programs) {
    bySeo.set(p.school_seo, [...(bySeo.get(p.school_seo) ?? []), p]);
    const s = schools.get(p.school_seo);
    for (const n of [p.name, p.short_name, s?.name, s?.long_name, p.school_seo.replace(/-/g, ' ')]) addName(p.gender, n, p.id);
    // Initialisms and NCAA six-letter codes are ambiguous (USC, UNC, "VT"…): stored as weaker keys that only win
    // when nothing else matches, and never expanded like ordinary names ("VT" is Virginia Tech, not Vermont).
    for (const n of [s?.long_name, s?.name, p.name]) { const ini = nameInitials(n); if (ini) add(p.gender, `~${ini}`, p.id); }
    const code = (p.name6 ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (code.length >= 2) add(p.gender, `~${code}`, p.id);
  }
  for (const a of extra) {
    for (const p of bySeo.get(a.seo) ?? []) if (!a.gender || a.gender === p.gender) addName(p.gender, a.alias, p.id);
  }
  return byGender;
}

const PLACEHOLDER_EXACT = /^(tba|tbd|opponent (tba|tbd)|to be (announced|determined)|semi-?finals?|quarter-?finals?|finals?|first round|second round|third round|championship( game| match)?|consolation( game)?|winner|loser|title game|play-?in|bye|exhibition|scrimmage|alumni( game)?)$/i;
const PLACEHOLDER_SUFFIX = /\b(semi-?finals?|quarter-?finals?|finals?|championships?|tournament|classic|invitational|college cup|cup|showcase|round(?: \d+| of \d+)?|game \d+|match \d+|bracket|winner|loser)$/i;
const CONFERENCE_LIKE = /(^conference\b|\b(conference|league|athletic association|ncaa)$|^ncaa\b)/i;

/** True for schedule rows that are not a team: "TBD", "Semifinals", "MAC Tournament", "Conference USA", "NCAA College Cup". */
export function isPlaceholderOpponent(name: string, knownConferenceKeys?: Set<string>): boolean {
  const n = String(name ?? '').replace(/^\s*(?:vs\.?|at|@|versus)\s+/i, '').replace(/^#\d+\s*/, '').replace(/\s+/g, ' ').trim();
  if (!n) return true;
  if (PLACEHOLDER_EXACT.test(n)) return true;
  if (PLACEHOLDER_SUFFIX.test(n) && !/\(/.test(n)) return true;
  if (CONFERENCE_LIKE.test(n)) return true;
  if (knownConferenceKeys?.has(teamKey(n))) return true;
  return false;
}

export interface ResolverScope { gender: string; ownDivision: string | null; ownConference: string | null; divisionOf: Map<string, string>; conferenceOf: Map<string, string | null> }

/**
 * Pick one program for an opponent name: exact parenthetical key first, then the plain key, then the
 * initialism key; ties broken by division, then conference, then D1.
 */
export function resolveName(index: AliasIndex, scope: ResolverScope, rawName: string): string | null {
  const name = String(rawName ?? '').replace(/^\s*(?:vs\.?|at|@|versus)\s+/i, '').replace(/^#\d+\s*/, '').trim();
  if (!name) return null;
  const m = index.get(scope.gender);
  if (!m) return null;
  const exact = m.get(teamKeyKeepParens(name));
  const plain = m.get(teamKey(name));
  let cands = (exact && exact.length ? exact : plain) ?? [];
  if (!cands.length && /^[A-Z][A-Za-z&.]{1,6}$/.test(name)) cands = m.get(`~${name.toLowerCase().replace(/[^a-z]/g, '')}`) ?? [];
  if (cands.length === 1) return cands[0]!;
  if (!cands.length) return null;
  const sameDiv = scope.ownDivision ? cands.filter((id) => scope.divisionOf.get(id) === scope.ownDivision) : cands;
  if (sameDiv.length === 1) return sameDiv[0]!;
  const pool = sameDiv.length ? sameDiv : cands;
  const sameConf = scope.ownConference ? pool.filter((id) => scope.conferenceOf.get(id) === scope.ownConference) : [];
  if (sameConf.length === 1) return sameConf[0]!;
  const d1 = pool.filter((id) => scope.divisionOf.get(id) === 'd1');
  if (d1.length === 1) return d1[0]!;
  return null;
}

export function makeResolver(index: AliasIndex, scope: ResolverScope): (rawName: string) => Promise<string | null> {
  return async (rawName: string) => (isPlaceholderOpponent(rawName) ? null : resolveName(index, scope, rawName));
}
