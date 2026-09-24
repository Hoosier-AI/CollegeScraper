// Where a game is played, from what school schedules print: a city ("Durham, N.C.", "Boulder, Colorado", "Irvine"),
// a facility ("Freeman Field at Koskinen Stadium"), or both. Cities are placed on the map with the US Census
// Bureau's public-domain place list (data/us-places.json, built by scripts/build-places.mjs), so weather can be
// looked up for the ground without calling a geocoding service.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR',
  // AP-style abbreviations as school sites print them
  ala: 'AL', ariz: 'AZ', ark: 'AR', calif: 'CA', cal: 'CA', colo: 'CO', conn: 'CT', del: 'DE', dc: 'DC', 'd c': 'DC', fla: 'FL', ga: 'GA',
  ill: 'IL', ind: 'IN', kan: 'KS', kans: 'KS', ky: 'KY', la: 'LA', md: 'MD', mass: 'MA', mich: 'MI', minn: 'MN', miss: 'MS', mo: 'MO',
  mont: 'MT', neb: 'NE', nebr: 'NE', nev: 'NV', 'n h': 'NH', 'n j': 'NJ', 'n m': 'NM', 'n y': 'NY', 'n c': 'NC', 'n d': 'ND',
  okla: 'OK', ore: 'OR', oreg: 'OR', pa: 'PA', penn: 'PA', 'r i': 'RI', 's c': 'SC', 's d': 'SD', tenn: 'TN', tex: 'TX', vt: 'VT',
  va: 'VA', wash: 'WA', 'w va': 'WV', wis: 'WI', wisc: 'WI', wyo: 'WY',
};
const POSTAL = new Set(Object.values(STATES));

/** "N.C." / "North Carolina" / "NC" → "NC"; null when it is not a US state. */
export function stateCode(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (/^[A-Z]{2}$/.test(s) && POSTAL.has(s)) return s;
  const k = s.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  return STATES[k] ?? null;
}

export interface Venue { name: string | null; city: string | null; state: string | null }

/** A string reads as a place ("Durham, N.C.", "Irvine") rather than a ground ("Koskinen Stadium", "Field 3"). */
const NOT_A_PLACE = /^(home|away|neutral|tba|tbd|tbc|on campus|campus|virtual|n\/a)$/i;
const GROUND = /\b(stadium|field|park|complex|center|centre|arena|pitch|facility|grounds|dome|bowl|sportsplex|turf|oval|yard)\b/i;

/**
 * Splits what a schedule prints into ground and city. `location` is the schedule's location text, `facility`
 * its facility title when separate. "Freeman Field at Koskinen Stadium, Durham, N.C." splits on the last comma
 * that is followed by a state.
 */
export function parseVenue(location: string | null | undefined, facility?: string | null): Venue {
  const clean = (s: string | null | undefined) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t && /[a-z]/i.test(t) ? t : null; };
  let name = clean(facility), city: string | null = null, state: string | null = null;
  const loc = clean(location);
  if (loc) {
    const parts = loc.split(',').map((p) => p.trim()).filter(Boolean);
    const st = parts.length >= 2 ? stateCode(parts[parts.length - 1]) : null;
    if (st) {
      state = st;
      city = parts[parts.length - 2]!;
      const before = parts.slice(0, -2).join(', ');
      if (before && !name) name = before;
    } else if (GROUND.test(loc)) name = name ?? loc;
    else if (parts.length === 1 && loc.length <= 40 && !NOT_A_PLACE.test(loc)) city = loc;
  }
  if (name && city && name.toLowerCase() === city.toLowerCase()) name = null;
  return { name, city, state };
}

/** "Durham, NC" for display and storage (college_games.venue_city). */
export const cityLabel = (v: Pick<Venue, 'city' | 'state'>): string | null => (v.city ? (v.state ? `${v.city}, ${v.state}` : v.city) : null);

export const placeKey = (city: string, state: string): string =>
  `${city.toLowerCase().replace(/^st\.?\s+/, 'saint ').replace(/^ft\.?\s+/, 'fort ').replace(/^mt\.?\s+/, 'mount ').replace(/[^a-z0-9]+/g, ' ').trim()}|${state.toUpperCase()}`;

/** Campus mailing addresses the Census list does not carry as a place. */
const PLACE_ALIASES: Record<string, string> = {
  'university park|PA': 'state college|PA', 'chestnut hill|MA': 'newton|MA', 'annandale on hudson|NY': 'red hook|NY',
  'swarthmore|PA': 'swarthmore|PA', 'villanova|PA': 'radnor|PA', 'mississippi state|MS': 'starkville|MS',
};

let places: Record<string, [number, number]> | null = null;
function loadPlaces(): Record<string, [number, number]> {
  if (places) return places;
  const here = dirname(fileURLToPath(import.meta.url));
  const file = [resolve(here, '../../data/us-places.json'), resolve(process.cwd(), 'data/us-places.json')].find((f) => { try { readFileSync(f); return true; } catch { return false; } });
  places = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return places!;
}

/** Coordinates for a US city, or null when it is not in the Census list. */
export function placeCoords(city: string | null, state: string | null): { lat: number; lon: number } | null {
  if (!city || !state) return null;
  const p = loadPlaces();
  const k = placeKey(city, state);
  const hit = p[k] ?? p[PLACE_ALIASES[k] ?? ''];
  return hit ? { lat: hit[0], lon: hit[1] } : null;
}

/** "Durham, NC" (stored form) back to its parts. */
export function splitCityLabel(label: string | null | undefined): { city: string | null; state: string | null } {
  const v = parseVenue(label);
  return { city: v.city, state: v.state };
}
