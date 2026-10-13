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

// ---------- International (national-team football) ----------
// The site's International section holds every national-team competition; Pro is club football only. The provider
// files both under country "World" and its national-team flag on teams is patchy (half of the OFC Nations Cup's sides
// are not marked), so the split is this hand-kept list, built from who actually played in each competition
// (2026-10-12), plus a name rule for competitions the provider adds later. pro_intl_audit() (migration 164) lists
// competitions whose sides disagree with it.
export type LeagueScope = 'club' | 'intl';
export type LeagueLevel = 'senior' | 'youth';
export type Confederation = 'FIFA' | 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'CAF' | 'AFC' | 'OFC' | 'Other';

/** Senior national-team competitions: tournaments, qualifiers, nations leagues, friendlies, invitationals, the
 *  Olympics and the regional multi-sport games. */
export const INTL_SENIOR = new Set([
  1, 4, 5, 6, 7, 8, 9, 10, 19, 21, 22, 23, 24, 25, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 480, 524, 535, 536, 666, 743,
  770, 803, 804, 805, 806, 807, 808, 849, 858, 859, 860, 880, 894, 897, 902, 904, 911, 913, 916, 919, 922, 926, 927, 941,
  960, 1008, 1016, 1038, 1040, 1045, 1046, 1057, 1072, 1083, 1105, 1163, 1169, 1188, 1189, 1206, 1207, 1222, 1237, 1245,
  1247,
]);
/** Youth national teams: the U-17/U-20 World Cups, the age-group continental championships and their qualifiers. Club
 *  youth competitions (UEFA Youth League, Libertadores U20, Viareggio, COTIF) stay in Pro. */
export const INTL_YOUTH = new Set([
  38, 490, 493, 532, 537, 538, 587, 771, 773, 850, 881, 882, 886, 890, 893, 908, 912, 914, 918, 920, 921, 928, 934, 950,
  951, 952, 953, 963, 965, 970, 973, 1001, 1012, 1015, 1047, 1060, 1066, 1070, 1077, 1081, 1085, 1101, 1102, 1122, 1153,
  1159, 1161, 1208,
]);
/** Club competitions whose names read like national-team ones. */
const CLUB_NAMED_LIKE_INTL = new Set([14, 540, 910, 940, 1213, 1246]);
const INTL_NAME = /\bworld cup\b|\bnations (league|cup)\b|cup of nations|\bcopa am[eé]rica|\bgold cup\b|\basian cup\b|\beuro championship\b|\bolympics?\b|\bfriendlies( women)?$|\b(u|under[- ]?)\d{2}\b.*\bchampionship\b|\bchampionship\b.*\bwomen\b|\bqualification\b/i;
const CLUB_NAME = /\bclubs?\b|\bchampions\b|libertadores|sudamericana|recopa|super ?cup|super shield|\bcup winners\b|\bpro league\b/i;

/** Club or international. Only "World" competitions can be international (a national cup is club football). */
export function leagueScope(id: number, name: string, country?: string | null): LeagueScope {
  if (INTL_SENIOR.has(id) || INTL_YOUTH.has(id)) return 'intl';
  if (CLUB_NAMED_LIKE_INTL.has(id) || (country != null && country !== 'World')) return 'club';
  return INTL_NAME.test(name) && !CLUB_NAME.test(name) ? 'intl' : 'club';
}

/** Senior or youth: the International section's switch. Club competitions are senior unless their kind is youth. */
export function leagueLevel(id: number, name: string): LeagueLevel {
  if (INTL_YOUTH.has(id)) return 'youth';
  if (INTL_SENIOR.has(id)) return 'senior';
  return YOUTH.test(name) || /\bpre-olympic\b/i.test(name) ? 'youth' : 'senior';
}

/** Which confederation runs an international competition, from its name (FIFA for the world ones). Null for clubs. */
export function leagueConfederation(id: number, name: string, scope: LeagueScope): Confederation | null {
  if (scope !== 'intl') return null;
  const o = CONFEDERATION_OVERRIDE[id];
  if (o) return o;
  if (/\bUEFA\b|\beuro\b|\beurope(an)?\b|\bbaltic\b/i.test(name)) return 'UEFA';
  if (/\bCONMEBOL\b|copa am[eé]rica|sudamericano|south america/i.test(name)) return 'CONMEBOL';
  if (/\bCONCACAF\b|gold cup|caribbean|centroamericana|central american|shebelieves/i.test(name)) return 'CONCACAF';
  if (/\bCAF\b|\bafrica|\bCOSAFA\b|\bCECAFA\b|\bWAFU\b/i.test(name)) return 'CAF';
  if (/\bAFC\b|\basian?\b|\bASEAN\b|\bEAFF\b|\bSAFF\b|\bWAFF\b|\bCAFA\b|\bgulf\b|\bkirin\b|\bking'?s cup\b/i.test(name)) return 'AFC';
  if (/\bOFC\b|\boceania\b|\bpacific\b/i.test(name)) return 'OFC';
  if (/\bworld cup\b|\bolympics?\b|\bfriendlies\b|\bFIFA\b|\bconfederations\b|finalissima/i.test(name)) return 'FIFA';
  return 'Other';
}
/** Names the rules above would misread: invitationals, the Arab and multi-sport games, and Finalissima (two confederations). */
const CONFEDERATION_OVERRIDE: Record<number, Confederation> = {
  860: 'Other', 934: 'Other', 941: 'Other', 919: 'Other', 1072: 'CAF', 1045: 'CONCACAF', 1016: 'CONCACAF', 1237: 'CONCACAF',
  902: 'Other', 914: 'Other', 1222: 'FIFA', 1247: 'AFC', 911: 'AFC', 803: 'AFC', 1245: 'AFC', 770: 'OFC', 913: 'FIFA',
  1207: 'CONCACAF', 1060: 'CONMEBOL', 1105: 'FIFA', 37: 'FIFA',
};

/** "Chicago Red Stars W" -> "Chicago Red Stars": the provider marks women's sides with a trailing W. */
export const teamDisplayName = (name: string): string => name.replace(/\s+W$/, '').trim() || name;
