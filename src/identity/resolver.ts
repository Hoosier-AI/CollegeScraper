// Player identity resolution. Pure functions: callers load candidates from the DB and pass them in.
import type { PlayerStatLine, RosterPlayer } from '../model.js';
import { nameKey, looseNameMatch, stripDiacritics } from '../normalize/names.js';
import { parseClassYear } from '../normalize/classYear.js';

export interface KnownPlayerSeason {
  playerSeasonId: string;
  playerId: string;
  programId: string;
  season: number;
  nameKey: string;
  firstName: string;
  lastName: string;
  jersey: number | null;
  classYear: number | null;
  isRedshirt: boolean;
  isGrad: boolean;
  /** site player id on this program's host, if known */
  sitePlayerId: string | null;
  hometownRaw: string | null;
  highSchool: string | null;
  previousSchool: string | null;
}

export interface IdentityOverride {
  action: 'merge' | 'split' | 'link';
  fromPlayerId: string | null;
  toPlayerId: string | null;
  playerSeasonId: string | null;
}

export interface ResolvedRosterPlayer {
  roster: RosterPlayer;
  /** Existing player id to attach to, or null to create a new player. */
  playerId: string | null;
  confidence: number;
  rule: string;
}

const norm = (s: string | null | undefined) => stripDiacritics(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]/g, '');

function classProgressed(prev: KnownPlayerSeason, cur: RosterPlayer, seasonGap: number): boolean {
  const c = parseClassYear(cur.classRaw);
  if (prev.classYear == null || c.year == null) return true; // unknown → do not block
  // redshirt / grad players can stay on the same label; otherwise expect +gap (allow +gap±1 for redshirt years)
  const diff = c.year - prev.classYear;
  if (c.grad || prev.isGrad || c.redshirt || prev.isRedshirt) return diff >= 0 && diff <= seasonGap + 1;
  return diff === seasonGap || diff === seasonGap - 1 || diff === seasonGap + 1;
}

/**
 * Attach roster players of (program, season) to existing player identities from the same program's
 * earlier seasons. Rules, highest confidence first:
 *   site player id match            0.98
 *   same name_key + class progressed 0.92
 *   same name_key + same jersey      0.80  (class mismatch)
 *   loose name (last + initial) + same jersey + class progressed 0.75
 * Anything below 0.75 → new player.
 */
export function resolveRoster(
  roster: RosterPlayer[],
  priorSeasons: KnownPlayerSeason[],
  currentSeason: number,
  overridesByPlayerSeason: Map<string, string> = new Map(), // player_season_id (existing, same season) → player_id forced
  currentSeasonExisting: KnownPlayerSeason[] = [],
): ResolvedRosterPlayer[] {
  const usedPlayers = new Set<string>();
  const out: ResolvedRosterPlayer[] = [];
  const prior = priorSeasons.filter((p) => p.season < currentSeason).sort((a, b) => b.season - a.season);

  for (const r of roster) {
    const key = nameKey(r.firstName, r.lastName);
    // 0. an existing row for this same season (re-run): keep its identity, honouring overrides
    const same = currentSeasonExisting.find((p) => (r.sitePlayerId && p.sitePlayerId === r.sitePlayerId) || (p.nameKey === key && (p.jersey == null || r.jersey == null || p.jersey === r.jersey)));
    if (same) {
      const forced = overridesByPlayerSeason.get(same.playerSeasonId);
      out.push({ roster: r, playerId: forced ?? same.playerId, confidence: forced ? 1 : 0.99, rule: forced ? 'override' : 'existing_row' });
      usedPlayers.add(forced ?? same.playerId);
      continue;
    }
    let best: { playerId: string; confidence: number; rule: string } | null = null;
    for (const p of prior) {
      if (usedPlayers.has(p.playerId)) continue;
      const gap = currentSeason - p.season;
      if (gap > 3) continue;
      let cand: { confidence: number; rule: string } | null = null;
      if (r.sitePlayerId && p.sitePlayerId && r.sitePlayerId === p.sitePlayerId) cand = { confidence: 0.98, rule: 'site_player_id' };
      else if (p.nameKey === key) {
        if (classProgressed(p, r, gap)) cand = { confidence: 0.92, rule: 'name_class_progression' };
        else if (r.jersey != null && p.jersey === r.jersey) cand = { confidence: 0.80, rule: 'name_jersey_class_mismatch' };
        else cand = { confidence: 0.70, rule: 'name_only_class_conflict' };
      } else if (r.jersey != null && p.jersey === r.jersey && looseNameMatch(r, p) && classProgressed(p, r, gap)) {
        cand = { confidence: 0.75, rule: 'loose_name_jersey' };
      }
      if (cand && (!best || cand.confidence > best.confidence)) best = { playerId: p.playerId, ...cand };
    }
    if (best && best.confidence >= 0.75) {
      usedPlayers.add(best.playerId);
      out.push({ roster: r, playerId: best.playerId, confidence: best.confidence, rule: best.rule });
    } else {
      out.push({ roster: r, playerId: null, confidence: best ? best.confidence : 0.5, rule: best ? `new_player(${best.rule})` : 'new_player' });
    }
  }
  return out;
}

export interface StatLineCandidate {
  playerSeasonId: string;
  nameKey: string;
  firstName: string;
  lastName: string;
  jersey: number | null;
}

export interface StatLineMatch { playerSeasonId: string; confidence: number; rule: string }

/** Match a box-score line to a roster row of the same program-season. */
export function matchStatLine(line: PlayerStatLine, candidates: StatLineCandidate[]): StatLineMatch | null {
  const key = nameKey(line.firstName, line.lastName);
  const byKey = candidates.filter((c) => c.nameKey === key);
  if (byKey.length) {
    const j = line.jersey != null ? byKey.find((c) => c.jersey === line.jersey) : undefined;
    if (j) return { playerSeasonId: j.playerSeasonId, confidence: 0.95, rule: 'name_jersey' };
    if (byKey.length === 1) return { playerSeasonId: byKey[0]!.playerSeasonId, confidence: 0.85, rule: 'name' };
  }
  if (line.jersey != null) {
    const byJersey = candidates.filter((c) => c.jersey === line.jersey && looseNameMatch(line, c));
    if (byJersey.length === 1) return { playerSeasonId: byJersey[0]!.playerSeasonId, confidence: 0.75, rule: 'jersey_loose_name' };
  }
  // last name unique on the roster (box scores sometimes abbreviate first names)
  const last = norm(line.lastName);
  const byLast = candidates.filter((c) => norm(c.lastName) === last);
  if (byLast.length === 1 && (!line.firstName || looseNameMatch(line, byLast[0]!))) return { playerSeasonId: byLast[0]!.playerSeasonId, confidence: 0.70, rule: 'unique_last_name' };
  // Same jersey + same first name token: NCAA.com prints full legal names ("JARAN LILLEHOLT KLEVBERG",
  // "BRIAN MOHL II", "TOFTEVAAG" for Toftevåg) that fail the last-name rules above.
  const firstTok = (s: string) => norm(s.split(/\s+/)[0] ?? '');
  if (line.jersey != null && firstTok(line.firstName)) {
    const byJerseyFirst = candidates.filter((c) => c.jersey === line.jersey && firstTok(c.firstName) === firstTok(line.firstName));
    if (byJerseyFirst.length === 1) return { playerSeasonId: byJerseyFirst[0]!.playerSeasonId, confidence: 0.72, rule: 'jersey_first_name' };
    // ...or any surname token shared (multi-word / partly transliterated last names) with the same jersey.
    const toks = (s: string) => new Set(s.split(/[\s-]+/).map(norm).filter((t) => t.length > 2));
    const lineToks = toks(line.lastName);
    const byJerseyTok = candidates.filter((c) => c.jersey === line.jersey && [...toks(c.lastName)].some((t) => lineToks.has(t)));
    if (byJerseyTok.length === 1) return { playerSeasonId: byJerseyTok[0]!.playerSeasonId, confidence: 0.7, rule: 'jersey_surname_token' };
  }
  return null;
}

export interface TransferCandidate {
  playerId: string;
  programId: string;
  season: number;
  nameKey: string;
  hometownRaw: string | null;
  highSchool: string | null;
  schoolNames: string[]; // names/aliases of the candidate's program school
}

export interface TransferMatch { playerId: string; fromProgramId: string; fromSeason: number; confidence: number; evidence: Record<string, unknown> }

/**
 * A new player_season with no prior identity at this program: look for the same person at another
 * program in season-1 / season-2. previous_school evidence → 0.90; hometown + high school → 0.80.
 */
export function findTransfer(
  roster: RosterPlayer,
  season: number,
  candidates: TransferCandidate[],
): TransferMatch | null {
  const key = nameKey(roster.firstName, roster.lastName);
  const prev = norm(roster.previousSchool);
  let best: TransferMatch | null = null;
  for (const c of candidates) {
    if (c.nameKey !== key) continue;
    if (c.season >= season || season - c.season > 2) continue;
    let confidence = 0;
    const evidence: Record<string, unknown> = { rule: '', from_season: c.season };
    if (prev && c.schoolNames.some((n) => norm(n) && (prev.includes(norm(n)) || norm(n).includes(prev)))) {
      confidence = 0.9; evidence.rule = 'previous_school'; evidence.previous_school = roster.previousSchool;
    } else if (roster.hometownRaw && c.hometownRaw && norm(roster.hometownRaw) === norm(c.hometownRaw) && roster.highSchool && c.highSchool && norm(roster.highSchool) === norm(c.highSchool)) {
      confidence = 0.8; evidence.rule = 'hometown_high_school'; evidence.hometown = roster.hometownRaw;
    } else if (roster.hometownRaw && c.hometownRaw && norm(roster.hometownRaw) === norm(c.hometownRaw)) {
      confidence = 0.7; evidence.rule = 'hometown_only';
    } else {
      confidence = 0.4; evidence.rule = 'name_only';
    }
    if (!best || confidence > best.confidence) best = { playerId: c.playerId, fromProgramId: c.programId, fromSeason: c.season, confidence, evidence };
  }
  return best;
}
