// Sidearm roster JSON: GET {base}/api/v2/Rosters/bySport/{sportSlug}?season={year}
import type { Coach, Roster, RosterPlayer, SiteContext } from '../../../model.js';
import { int } from '../../../normalize/num.js';
import { cleanName } from '../../../normalize/names.js';
import { absUrl, arr, bool, isObj, nameJerseyKey, obj, sidearmSportSlug, slugify, str, type Dict } from './common.js';

export function rosterJsonUrl(baseUrl: string, sportSlug: string, season?: number | null): string {
  const base = `${baseUrl.replace(/\/+$/, '')}/api/v2/Rosters/bySport/${sportSlug}`;
  return season == null ? base : `${base}?season=${season}`;
}

/** Sidearm bio URL: /sports/{sportSlug}/roster/{first-last}/{rosterPlayerId}. */
export function sidearmBioUrl(baseUrl: string, sportSlug: string, firstName: string, lastName: string, id: string | number | null): string | null {
  const slug = slugify(`${firstName} ${lastName}`);
  if (!slug || id == null || id === '') return null;
  return absUrl(baseUrl, `/sports/${sportSlug}/roster/${slug}/${id}`);
}

function directUrl(p: Dict, baseUrl: string): string | null {
  for (const k of ['bioUrl', 'url', 'playerUrl', 'rosterUrl', 'profileUrl']) {
    const v = str(p[k]);
    if (v && /\/roster\//i.test(v)) return absUrl(baseUrl, v);
  }
  return null;
}

function headshot(p: Dict, baseUrl: string): string | null {
  const img = obj(p['image']);
  return absUrl(baseUrl, str(img['absoluteUrl']) ?? str(img['url']) ?? str(p['headshotUrl']) ?? str(p['imageUrl']));
}

export function parseRosterPlayer(raw: unknown, ctx: SiteContext, sportSlug: string): RosterPlayer | null {
  if (!isObj(raw)) return null;
  const p = raw;
  const firstName = cleanName(str(p['firstName']) ?? '');
  const lastName = cleanName(str(p['lastName']) ?? '');
  if (!firstName && !lastName) return null;
  const playerId = str(p['playerId']);
  const rosterPlayerId = str(p['rosterPlayerId']);
  const jersey = int(str(p['jerseyNumber']));
  const feet = int(p['heightFeet']);
  const inches = int(p['heightInches']);
  const heightRaw = feet != null && feet > 0 ? `${feet}-${inches ?? 0}` : str(p['height']);
  const sourceKey = playerId ?? nameJerseyKey(lastName, firstName, jersey);
  return {
    sourceKey,
    sitePlayerId: playerId,
    firstName,
    lastName,
    jersey,
    positionRaw: str(p['positionShort']) ?? str(p['positionLong']) ?? str(p['position']),
    classRaw: str(p['academicYearShort']) ?? str(p['academicYearLong']) ?? str(p['academicYear']),
    heightRaw,
    weightLb: int(p['weight']),
    hometownRaw: str(p['hometown']),
    highSchool: str(p['highSchool']),
    previousSchool: str(p['previousSchool']),
    major: str(p['major']),
    isCaptain: bool(p['isCaptain']),
    headshotUrl: headshot(p, ctx.baseUrl),
    bioUrl: directUrl(p, ctx.baseUrl) ?? sidearmBioUrl(ctx.baseUrl, sportSlug, firstName, lastName, rosterPlayerId ?? playerId),
  };
}

export function parseCoach(raw: unknown, baseUrl: string): Coach | null {
  if (!isObj(raw)) return null;
  const c = raw;
  const first = str(c['firstName']) ?? '';
  const last = str(c['lastName']) ?? '';
  const name = cleanName(`${first} ${last}`) || cleanName(str(c['name']) ?? str(c['fullName']) ?? '');
  if (!name) return null;
  const title = str(c['title']) ?? str(c['staffTitle']) ?? str(c['position']);
  return {
    name,
    title,
    isHead: !!title && /head coach/i.test(title) && !/assistant|associate|assoc\.|asst\.?/i.test(title),
    headshotUrl: headshot(c, baseUrl),
  };
}

/** Parse the Rosters/bySport payload into the canonical Roster. */
export function parseRosterJson(json: unknown, ctx: SiteContext, sourceUrl?: string): Roster {
  const root = obj(json);
  const sport = obj(root['sport']);
  const sportSlug = ctx.sportSlug ?? str(sport['globalSportNameSlug']) ?? sidearmSportSlug(ctx.gender);
  const players: RosterPlayer[] = [];
  for (const raw of arr(root['players'])) {
    if (isObj(raw) && bool(raw['hide'])) continue;
    const p = parseRosterPlayer(raw, ctx, sportSlug);
    if (p) players.push(p);
  }
  const coaches: Coach[] = [];
  for (const raw of arr(root['coaches'])) {
    const c = parseCoach(raw, ctx.baseUrl);
    if (c) coaches.push(c);
  }
  return { players, coaches, sourceUrl: sourceUrl ?? rosterJsonUrl(ctx.baseUrl, sportSlug, ctx.season) };
}
