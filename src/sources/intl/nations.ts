// Pure: one name per national team across the International section's sources. martj42's international_results is
// the reference (it covers every nation since 1872 and files successor teams under today's name: Russia for the Soviet
// Union, Germany for West Germany, DR Congo for Zaire, as FIFA counts them); every other source's spelling maps onto
// it here. A nation's key is the slug of that name ("united-states", "dr-congo"); a women's side shares the nation key
// and is told apart by the gender column.
import { stripDiacritics } from '../../normalize/names.js';

/** Other sources' names -> martj42's. API-Football first, then Fjelstul's World Cup database, then openfootball. */
export const NATION_ALIASES: Record<string, string> = {
  // API-Football
  USA: 'United States', Czechia: 'Czech Republic', 'Rep. Of Ireland': 'Republic of Ireland', 'Türkiye': 'Turkey', 'FYR Macedonia': 'North Macedonia',
  Macedonia: 'North Macedonia', 'Bosnia & Herzegovina': 'Bosnia and Herzegovina', Swaziland: 'Eswatini', 'Congo DR': 'DR Congo', 'Chinese Taipei': 'Taiwan',
  'Korea Republic': 'South Korea', 'Korea DPR': 'North Korea', 'IR Iran': 'Iran', "Côte d'Ivoire": 'Ivory Coast', "Cote D'Ivoire": 'Ivory Coast', 'Cape Verde Islands': 'Cape Verde',
  'Cabo Verde': 'Cape Verde', 'China PR': 'China', 'Kyrgyz Republic': 'Kyrgyzstan', 'The Gambia': 'Gambia', 'East Timor': 'Timor-Leste', 'Burma': 'Myanmar',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis', 'St Kitts and Nevis': 'Saint Kitts and Nevis', 'St. Lucia': 'Saint Lucia', 'St. Vincent / Grenadines': 'Saint Vincent and the Grenadines',
  'Sao Tome and Principe': 'São Tomé and Príncipe', 'Curacao': 'Curaçao', 'Brunei Darussalam': 'Brunei', 'Hong Kong China': 'Hong Kong', 'Macao': 'Macau',
  'US Virgin Islands': 'United States Virgin Islands', 'Trinidad & Tobago': 'Trinidad and Tobago', 'Antigua & Barbuda': 'Antigua and Barbuda', 'Turks & Caicos Islands': 'Turks and Caicos Islands',
  // Fjelstul (historical names FIFA folds into today's nation)
  'West Germany': 'Germany', 'Soviet Union': 'Russia', Zaire: 'DR Congo', 'Serbia and Montenegro': 'Serbia', 'Dutch East Indies': 'Indonesia', 'East Germany': 'German DR',
  // openfootball
  Ireland: 'Republic of Ireland', 'Korea Rep.': 'South Korea', 'Korea DPR.': 'North Korea', 'Czech Rep.': 'Czech Republic', 'Ireland Rep.': 'Republic of Ireland', 'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
};

/** martj42's name for any source's spelling (women's sides carry the same name). */
export function canonicalNation(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ').replace(/\s+(W|Women|Fem\.?)$/i, '');
  return NATION_ALIASES[n] ?? n;
}

export function nationKey(name: string): string {
  return stripDiacritics(canonicalNation(name)).toLowerCase().replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** A youth or B side is not the nation's senior team ("Brazil U20", "Guinea A'", "England B"). */
export const isSeniorSide = (name: string) => !/\bU-?\d{2}\b|\bunder[- ]?\d{2}\b|\sA'$|\sB$|\bolympic\b/i.test(name);
