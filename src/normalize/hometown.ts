const US_STATES: Record<string, string> = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California', co: 'Colorado', ct: 'Connecticut', de: 'Delaware',
  fl: 'Florida', ga: 'Georgia', hi: 'Hawaii', id: 'Idaho', il: 'Illinois', in: 'Indiana', ia: 'Iowa', ks: 'Kansas', ky: 'Kentucky',
  la: 'Louisiana', me: 'Maine', md: 'Maryland', ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota', ms: 'Mississippi', mo: 'Missouri',
  mt: 'Montana', ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire', nj: 'New Jersey', nm: 'New Mexico', ny: 'New York', nc: 'North Carolina',
  nd: 'North Dakota', oh: 'Ohio', ok: 'Oklahoma', or: 'Oregon', pa: 'Pennsylvania', ri: 'Rhode Island', sc: 'South Carolina', sd: 'South Dakota',
  tn: 'Tennessee', tx: 'Texas', ut: 'Utah', vt: 'Vermont', va: 'Virginia', wa: 'Washington', wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming', dc: 'District of Columbia',
};
const AP_STATES: Record<string, string> = {
  'ala': 'al', 'ariz': 'az', 'ark': 'ar', 'calif': 'ca', 'colo': 'co', 'conn': 'ct', 'del': 'de', 'fla': 'fl', 'ga': 'ga', 'ill': 'il', 'ind': 'in',
  'kan': 'ks', 'ky': 'ky', 'la': 'la', 'md': 'md', 'mass': 'ma', 'mich': 'mi', 'minn': 'mn', 'miss': 'ms', 'mo': 'mo', 'mont': 'mt', 'neb': 'ne',
  'nev': 'nv', 'n.h': 'nh', 'n.j': 'nj', 'n.m': 'nm', 'n.y': 'ny', 'n.c': 'nc', 'n.d': 'nd', 'okla': 'ok', 'ore': 'or', 'pa': 'pa', 'r.i': 'ri',
  's.c': 'sc', 's.d': 'sd', 'tenn': 'tn', 'tex': 'tx', 'vt': 'vt', 'va': 'va', 'wash': 'wa', 'w.va': 'wv', 'wis': 'wi', 'wyo': 'wy', 'd.c': 'dc',
};
const CA_PROVINCES = new Set(['ontario', 'ont', 'quebec', 'que', 'british columbia', 'b.c', 'bc', 'alberta', 'alta', 'manitoba', 'man', 'saskatchewan', 'sask', 'nova scotia', 'n.s', 'new brunswick', 'n.b', 'newfoundland', 'pei', 'p.e.i', 'canada']);

export interface Hometown { city: string | null; region: string | null; country: string | null; raw: string | null }

/** "Safety Harbor, Fla." → {city, region:'Florida', country:'USA'}; "Reykjavik, Iceland" → country Iceland. */
export function parseHometown(raw: string | null | undefined): Hometown {
  const r = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!r) return { city: null, region: null, country: null, raw: null };
  const parts = r.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) return { city: parts[0]!, region: null, country: null, raw: r };
  const city = parts[0]!;
  const tail = parts.slice(1).join(', ');
  const t = tail.toLowerCase().replace(/\.$/, '');
  const key = t.replace(/\./g, '');
  if (US_STATES[key]) return { city, region: US_STATES[key]!, country: 'USA', raw: r };
  const ap = AP_STATES[t] ?? AP_STATES[key];
  if (ap) return { city, region: US_STATES[ap]!, country: 'USA', raw: r };
  const full = Object.entries(US_STATES).find(([, name]) => name.toLowerCase() === t);
  if (full) return { city, region: full[1], country: 'USA', raw: r };
  if (CA_PROVINCES.has(t) || CA_PROVINCES.has(key)) return { city, region: tail, country: 'Canada', raw: r };
  if (parts.length >= 3) return { city, region: parts[1]!, country: parts[parts.length - 1]!, raw: r };
  return { city, region: null, country: tail, raw: r };
}

/** PrestoSports "Hometown/Last School" column: "New Britain, Conn. / Central HS" → parts. */
export function splitHometownSchool(raw: string | null | undefined): { hometown: string | null; school: string | null } {
  const r = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!r) return { hometown: null, school: null };
  const idx = r.indexOf(' / ');
  if (idx < 0) return { hometown: r, school: null };
  return { hometown: r.slice(0, idx).trim() || null, school: r.slice(idx + 3).trim() || null };
}
