// Builds data/us-places.json from the US Census Bureau Gazetteer place file (public domain):
//   https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip
// Usage: node scripts/build-places.mjs path/to/2024_Gaz_place_national.txt
// Output: { "durham|NC": [lat, lon], ... } — every incorporated place and census-designated place, the name without
// its legal suffix ("city", "town", "CDP"…). Where two places share a name in one state the larger one wins.
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/build-places.mjs <Gaz_place_national.txt>'); process.exit(1); }
const SUFFIX = /\s+(city and borough|consolidated government \(balance\)|metropolitan government \(balance\)|unified government \(balance\)|\(balance\)|city|town|township|village|borough|municipality|CDP|comunidad|zona urbana|urban county|plantation|corporation)$/i;
export const placeKey = (name, state) => `${name.toLowerCase().replace(/^st\.?\s+/, 'saint ').replace(/^ft\.?\s+/, 'fort ').replace(/^mt\.?\s+/, 'mount ').replace(/[^a-z0-9]+/g, ' ').trim()}|${state.toUpperCase()}`;
const lines = readFileSync(src, 'utf8').split('\n').slice(1).filter(Boolean);
const out = new Map();
for (const line of lines) {
  const c = line.split('\t').map((s) => s.trim());
  const [usps, , , rawName] = c; const area = Number(c[8]); const lat = Number(c[10]), lon = Number(c[11]);
  let name = rawName; for (let i = 0; i < 2; i++) name = name.replace(SUFFIX, '');
  const k = placeKey(name, usps);
  const prev = out.get(k);
  if (!prev || area > prev[2]) out.set(k, [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4, area]);
}
const obj = Object.fromEntries([...out].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [v[0], v[1]]]));
writeFileSync('data/us-places.json', JSON.stringify(obj));
console.log('places', Object.keys(obj).length);
