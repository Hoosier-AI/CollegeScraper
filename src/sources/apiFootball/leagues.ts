// Which of API-Football's ~1,250 competitions Plaibook Stats Pro crawls, in what order, and for which gender. The
// provider has no gender or level field, so both come from the name plus a hand-kept list of the competitions
// Plaibook's audience follows first (the US pyramid, then the big European leagues and the women's top flights).
// The US scene (every competition in the USA, amateur and pre-pro ones included, plus the international club
// competitions US clubs play in) is crawled first and in full: see isUsScene and jobs/pro/plan.ts.

export type LeagueKind = 'pro' | 'youth' | 'friendly' | 'amateur';
export type Gender = 'm' | 'w';

/** Hand-picked order, lowest first. Everything else: 500 leagues, 600 cups, then youth/friendlies/amateur. */
export const PRIORITY: Record<number, number> = {
  // The US scene: pro pyramid, men's and women's, its cups and international club competitions, then the pre-pro and
  // amateur leagues (USL League Two, USL W League, NPSL, WPSL, NISA) and the MLS All-Star game
  253: 1, 254: 2, 1130: 3, 255: 4, 489: 5, 909: 6, 257: 7, 772: 8, 16: 9, 641: 10, 1136: 11, 885: 12,
  256: 13, 1117: 14, 1118: 15, 1116: 16, 523: 17, 1095: 18, 1119: 19, 866: 19,
  // Big five, European cups, women's top flights, international tournaments
  39: 20, 140: 21, 78: 22, 135: 23, 61: 24, 2: 25, 3: 26, 848: 27, 525: 28, 44: 29, 82: 30, 64: 31, 142: 32, 139: 33,
  1: 34, 8: 35, 4: 36, 9: 37, 15: 38, 743: 39, 5: 40, 1217: 41, 1186: 42,
  // Canada, Mexico, CONCACAF
  479: 43, 1182: 44, 262: 45, 22: 46, 536: 47,
  // Next tier of interest
  40: 50, 88: 51, 94: 52, 71: 53, 128: 54, 179: 55, 144: 56, 203: 57, 98: 58, 307: 59, 13: 60, 11: 61, 17: 62, 12: 63,
  188: 64, 190: 65, 113: 66, 103: 67, 141: 68, 79: 69, 136: 70, 62: 71, 41: 72, 42: 73, 263: 74, 74: 75, 146: 76,
};

/** Name rules miss a few women's competitions; and a few amateur leagues look professional by name. */
const GENDER_OVERRIDE: Record<number, Gender> = { 1130: 'w', 1182: 'w', 1117: 'w', 1116: 'w', 254: 'w', 641: 'w', 64: 'w' };
const KIND_OVERRIDE: Record<number, LeagueKind> = {
  256: 'amateur', 1116: 'amateur', 1117: 'amateur', 1118: 'amateur', 523: 'amateur', // USL League Two, WPSL, USL W, NPSL, NISA
  909: 'pro', // MLS Next Pro: a reserve league in name, professional in fact
  10: 'friendly', 666: 'friendly', 667: 'friendly',
};

const WOMEN = /\bwomen|\bwomen's|\bfemin|\bfemen|\bfrauen|\bfemminil|\bwsl\b|\bnwsl\b|\bw[- ]league\b|\bwe league\b|damallsvenskan|toppserien|kvinde|shebelieves|\bdames\b|\bvrouwen|\bmulheres|\bfeminino/i;
const YOUTH = /\bu-?\s?\d{2}s?\b|\bunder[- ]?\d{2}\b|youth|junior|primavera|\bacademy\b|reserve|premier league 2\b|professional development|\bjuvenil|\bsub-?\d{2}\b|\bolympics?\b.*qualif/i;
const FRIENDLY = /friendl|\bexhibition|\ball-?star\b/i;
const AMATEUR = /amateur|provincial|non league|\bnpl\b|regionalliga|\bregional\b|county|\bdistrict\b|state league|oberliga|landesliga|\bsunday\b|\bdivision [3-9]\b|\b[4-9]\. (liga|division)\b|national 2|national 3|tercera|serie d\b|\bfederal\b|\bdivisie - sunday/i;

/** International club competitions US clubs play in: Leagues Cup, CONCACAF Champions Cup, Campeones Cup, CONCACAF W
 * Champions Cup, FIFA Club World Cup and its play-in. */
export const US_SCENE = new Set([772, 16, 885, 1136, 15, 1186]);

/** Part of the US scene: any competition in the USA, or one of the international ones above. */
export const isUsScene = (id: number, country: string | null | undefined): boolean => country === 'USA' || US_SCENE.has(id);

export function leagueGender(id: number, name: string): Gender {
  return GENDER_OVERRIDE[id] ?? (WOMEN.test(name) || /\sW$/.test(name) ? 'w' : 'm');
}

export function leagueKind(id: number, name: string): LeagueKind {
  const o = KIND_OVERRIDE[id];
  if (o) return o;
  if (FRIENDLY.test(name)) return 'friendly';
  if (YOUTH.test(name)) return 'youth';
  if (AMATEUR.test(name)) return 'amateur';
  return 'pro';
}

export function leaguePriority(id: number, type: 'league' | 'cup', kind: LeagueKind): number {
  const p = PRIORITY[id];
  if (p != null) return p;
  if (kind === 'pro') return type === 'league' ? 500 : 600;
  return kind === 'youth' ? 800 : kind === 'friendly' ? 850 : 900;
}

/** "Chicago Red Stars W" -> "Chicago Red Stars": the provider marks women's sides with a trailing W. */
export const teamDisplayName = (name: string): string => name.replace(/\s+W$/, '').trim() || name;
