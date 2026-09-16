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
  // "Loyola (IL)" is plainly "Loyola", and so are Loyola Maryland and Loyola Marymount to their opponents: a bare stem of a
  // parenthetical name maps to every school named stem + one word (or another parenthetical), so context decides.
  const stems = new Map<string, Set<string>>();
  const plainNames = new Map<string, { id: string; key: string }[]>();
  for (const p of programs) {
    const sc = schools.get(p.school_seo);
    for (const n of [p.name, p.short_name, sc?.name]) {
      if (!n) continue;
      const plain = teamKey(n);
      if (!plain) continue;
      if (/\(.+\)/.test(n)) { const k = `${p.gender}|${plain}`; stems.set(k, (stems.get(k) ?? new Set<string>()).add(p.id)); }
      const list = plainNames.get(p.gender) ?? []; list.push({ id: p.id, key: plain }); plainNames.set(p.gender, list);
    }
  }
  for (const [gk, ids] of stems) {
    const gender = gk.slice(0, gk.indexOf('|')), stem = gk.slice(gk.indexOf('|') + 1);
    const words = stem.split(' ').length;
    for (const { id, key } of plainNames.get(gender) ?? []) if (key.startsWith(`${stem} `) && key.split(' ').length === words + 1) ids.add(id);
    if (ids.size > 1) for (const id of ids) add(gender, stem, id);
  }
  for (const a of extra) {
    for (const p of bySeo.get(a.seo) ?? []) if (!a.gender || a.gender === p.gender) addName(p.gender, a.alias, p.id);
  }
  // Division-scoped fallback: "Missouri Southern" for Missouri Southern St., "Delhi" for SUNY Delhi.
  programTokens = new Map();
  for (const p of programs) {
    const sc = schools.get(p.school_seo);
    const names = [p.name, p.short_name, sc?.name, sc?.long_name].filter((x): x is string => !!x);
    const list = programTokens.get(p.gender) ?? [];
    list.push({ id: p.id, names: names.map((n) => memberTokens(n)) });
    programTokens.set(p.gender, list);
  }

  // A conference name that is also a team name ("American") is a team, not a placeholder.
  for (const m of byGender.values()) for (const k of m.keys()) knownConferenceKeys.delete(k);
  return byGender;
}

/** Conference names known to the database, as teamKey()s; jobs populate this so "Empire 8" is not treated as a team. */
const knownConferenceKeys = new Set<string>();
export function setKnownConferences(names: Iterable<string>): void { for (const n of names) { const k = teamKey(n); if (k) knownConferenceKeys.add(k); } }

const PROMO_WORDS = /\b(day|night|game|opener|senior|seniors|giveaway|appreciation|youth|kids?|alumni|homecoming|fest|dh|doubleheader|out|recognition|welcome|celebration|triple|points|app|student|students|school|pink|purple|white|gold|military|heritage|hispanic|faculty|staff|family|weekend|free|admission|tournament|classic|cup|showcase|tba|tbd)\b/i;

/** "RV TCU", "#2/5 Duke", "#T19 South Carolina", "NR/#20 North Carolina", "[RV] Xavier", "vs. No. 12 Elon" → team name only. */
export function cleanOpponentName(raw: string): string {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/^(?:vs\.?|at|@|versus)\s+/i, '');
  for (let i = 0; i < 3; i++) {
    s = s.replace(/^(?:\[rv\]|\(rv\)|rv|nr)(?:\s*\/\s*|\s+)/i, '')
      .replace(/^(?:#|no\.?\s*)t?\d+(?:\s*\/\s*(?:#|no\.?\s*)?t?\d+)?\s+/i, '');
  }
  return s.trim();
}

/** "Drake (Exh.)", "Hawkeye (Exhibition)", "Alumni scrimmage": not a counted game. */
export function isExhibitionName(raw: string): boolean {
  return /\((?:exh\.?|exhib\.?|exhibition|scrimmage)\)|\bexhibition\b|\bscrimmage\b/i.test(String(raw ?? ''));
}

let programTokens = new Map<string, { id: string; names: string[][] }[]>();
let membership: Map<string, boolean> | null = null;
/** program id → NCAA member; ambiguous names prefer members ("St. Thomas" = St. Thomas (MN), not St. Thomas (FL)). */
export function setMembership(m: Map<string, boolean>): void { membership = m; }

const PLACEHOLDER_EXACT = /^(tba|tbd|opponent (tba|tbd)|to be (announced|determined)|semi-?finals?|quarter-?finals?|finals?|first round|second round|third round|championship( game| match)?|consolation( game)?|winner|loser|title game|play-?in|bye|exhibition|scrimmage|alumni( game)?)$/i;
const PLACEHOLDER_SUFFIX = /\b(semi-?finals?|quarter-?finals?|finals?|championships?|tournament|classic|invitational|college cup|cup|showcase|round(?: \d+| of \d+)?|game \d+|match \d+|bracket|winner|loser)$/i;
const CONFERENCE_LIKE = /(^conference\b|\b(conference|league|athletic association|ncaa)$|^ncaa\b)/i;

/** True for schedule rows that are not a team: "TBD", "Semifinals", "MAC Tournament", "Conference USA", "NCAA College Cup". */
export function isPlaceholderOpponent(name: string): boolean {
  const n = cleanOpponentName(name);
  if (!n) return true;
  if (PLACEHOLDER_EXACT.test(n)) return true;
  if (PLACEHOLDER_SUFFIX.test(n) && !/\(/.test(n)) return true;
  if (CONFERENCE_LIKE.test(n)) return true;
  if (isExhibitionName(n)) return true;
  if (knownConferenceKeys.has(teamKey(n))) return true;
  return false;
}

export interface ResolverScope { gender: string; ownDivision: string | null; ownConference: string | null; divisionOf: Map<string, string>; conferenceOf: Map<string, string | null> }

/**
 * Pick one program for an opponent name: exact parenthetical key first, then the plain key, then the
 * initialism key; ties broken by division, then conference, then D1.
 */
export function resolveName(index: AliasIndex, scope: ResolverScope, rawName: string): string | null {
  const name = cleanOpponentName(rawName);
  if (!name) return null;
  const m = index.get(scope.gender);
  if (!m) return null;
  const direct = resolveExact(m, scope, name);
  if (direct) return direct;
  // School schedules often append promotions to the opponent ("North Dakota State Senior Day",
  // "Hofstra Res-Co Night", "UIC Free admission for alumni…"): try the longest word prefix that names a team.
  // A shortened name that is a prefix subsequence of exactly one program in the same division ("Missouri Southern"
  // for Missouri Southern St.). Never the other way round, so "Miami Dade" cannot become "Miami".
  if (scope.ownDivision) {
    const rt = memberTokens(name);
    if (rt.length) {
      const hits = (programTokens.get(scope.gender) ?? []).filter((p) => scope.divisionOf.get(p.id) === scope.ownDivision && p.names.some((nt) => prefixSubsequence(rt, nt)));
      const ids = [...new Set(hits.map((h) => h.id))];
      if (ids.length === 1) return ids[0]!;
    }
  }
  // Only a program of the same division is accepted this way: "Trinity College of Jacksonville … Night" must not
  // become Trinity (CT).
  // Only promotional text is dropped ("North Dakota State Senior Day", "Hofstra Res-Co Night") or trailing junk with
  // digits; an ordinary trailing word is part of the name, so "Miami Dade" never becomes Miami.
  const words = name.split(/\s*[|/\u2013\u2014-]\s*|\s+/).filter(Boolean);
  for (let k = words.length - 1; k >= 1; k--) {
    const dropped = words.slice(k).join(' ');
    if (!PROMO_WORDS.test(dropped) && !/\d/.test(dropped)) continue;
    const hit = resolveExact(m, scope, words.slice(0, k).join(' '));
    if (hit && (!scope.ownDivision || scope.divisionOf.get(hit) === scope.ownDivision)) return hit;
  }
  return null;
}

/** Like resolveName without the promo-prefix fallback ("Florida Poly" must not match "Florida"). */
export function resolveNameExact(index: AliasIndex, scope: ResolverScope, rawName: string): string | null {
  const m = index.get(scope.gender);
  return m ? resolveExact(m, scope, cleanOpponentName(rawName)) : null;
}

function resolveExact(m: Map<string, string[]>, scope: ResolverScope, name: string): string | null {
  const exact = m.get(teamKeyKeepParens(name));
  const plain = m.get(teamKey(name));
  let cands = (exact && exact.length ? exact : plain) ?? [];
  if (!cands.length && /^[A-Z][A-Za-z&.]{1,6}$/.test(name)) cands = m.get(`~${name.toLowerCase().replace(/[^a-z]/g, '')}`) ?? [];
  if (cands.length === 1) return cands[0]!;
  if (!cands.length) return null;
  if (membership) { const mem = cands.filter((id) => membership!.get(id) !== false); if (mem.length === 1) return mem[0]!; if (mem.length) cands = mem; }
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

/** Tokens for matching a standings row against a conference's own members ("UW-Eau Claire" ≡ "Wis.-Eau Claire"). */
export function memberTokens(name: string): string[] {
  const s = String(name ?? '').toLowerCase().replace(/^uw[-\s]+/, 'wisconsin ').replace(/^umaine[-\s]+/, 'maine ').replace(/[()]/g, ' ').replace(/&/g, ' and ');
  return teamKey(s).replace(/\bsaint\b/g, 'state').split(' ').filter(Boolean);
}

/** Every token of `short` is a prefix of a token of `long`, in order ("e stroudsburg" ⊑ "east stroudsburg"). */
export function prefixSubsequence(short: string[], long: string[]): boolean {
  if (!short.length || short.length > long.length) return false;
  let j = 0;
  for (const t of short) {
    while (j < long.length && !long[j]!.startsWith(t)) j++;
    if (j === long.length) return false;
    j++;
  }
  return true;
}

export interface MemberNames { id: string; names: (string | null | undefined)[] }

/** Unique member of one conference whose names match `rowName` exactly, else by prefix subsequence either way. */
export function matchAmongMembers(rowName: string | null | undefined, members: MemberNames[]): string | null {
  if (!rowName) return null;
  const rt = memberTokens(rowName);
  if (!rt.length) return null;
  const key = rt.join(' ');
  const exact = members.filter((m) => m.names.some((n) => n && memberTokens(n).join(' ') === key));
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) return null;
  const hits = members.filter((m) => m.names.some((n) => { if (!n) return false; const nt = memberTokens(n); return prefixSubsequence(rt, nt) || prefixSubsequence(nt, rt); }));
  return hits.length === 1 ? hits[0]!.id : null;
}


/** A name clean enough to become an opponent record: no promo text, digits or separators, at most five words. */
export function isCleanOpponentName(raw: string): boolean {
  const n = cleanOpponentName(raw);
  if (!n || n.length > 40 || /\d|[|!]/.test(n) || PROMO_WORDS.test(n)) return false;
  if (n.split(' ').length > 5) return false;
  return !isPlaceholderOpponent(n) && !isExhibitionName(n);
}

/** Synthetic school slug for a team NCAA.com does not index ("Monroe University" → "x-monroe"). */
export function opponentSeo(raw: string): string {
  return `x-${teamKey(cleanOpponentName(raw)).replace(/\s+/g, '-')}`;
}
