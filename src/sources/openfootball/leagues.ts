// The openfootball leagues we read (github.com/openfootball, public domain, CC0), mapped to API-Football's league ids.
// A season is API-Football's: the year a season starts ("2024-25" is 2024; Brazil's 2024 is 2024). Paths are under
// https://raw.githubusercontent.com/openfootball/. A missing file (404) means "not published", never an error.

export const OF_RAW = 'https://raw.githubusercontent.com/openfootball';

export interface OfLeague {
  league: number;
  name: string;
  /** Country prefix for club ids ("eng:Arsenal FC"); null keeps plain names (MLS, from before worldwide). */
  country: string | null;
  first: number;
  path: (season: number) => string;
  /** UTC offset of local kickoff times (files carry none): close enough to keep the date right. */
  tz: string;
}

const span = (s: number) => `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
const dir = (repo: string, file: string) => (s: number) => `${repo}/master/${span(s)}/${file}`;
const europe = (country: string, code: string) => (s: number) => `europe/master/${country}/${span(s)}_${code}.txt`;

export const OF_LEAGUES: OfLeague[] = [
  { league: 253, name: 'MLS', country: null, first: 2005, tz: '-05:00', path: (s) => `world/master/north-america/major-league-soccer/${s}_mls.txt` },
  { league: 39, name: 'Premier League', country: 'eng', first: 2010, tz: '+00:00', path: dir('england', '1-premierleague.txt') },
  { league: 40, name: 'Championship', country: 'eng', first: 2010, tz: '+00:00', path: dir('england', '2-championship.txt') },
  { league: 41, name: 'League One', country: 'eng', first: 2010, tz: '+00:00', path: dir('england', '3-league1.txt') },
  { league: 42, name: 'League Two', country: 'eng', first: 2010, tz: '+00:00', path: dir('england', '4-league2.txt') },
  { league: 43, name: 'National League', country: 'eng', first: 2020, tz: '+00:00', path: dir('england', '5-nationalleague.txt') },
  { league: 78, name: 'Bundesliga', country: 'ger', first: 2010, tz: '+01:00', path: dir('deutschland', '1-bundesliga.txt') },
  { league: 79, name: '2. Bundesliga', country: 'ger', first: 2010, tz: '+01:00', path: dir('deutschland', '2-bundesliga2.txt') },
  { league: 80, name: '3. Liga', country: 'ger', first: 2017, tz: '+01:00', path: dir('deutschland', '3-liga3.txt') },
  { league: 140, name: 'La Liga', country: 'esp', first: 2010, tz: '+01:00', path: dir('espana', '1-liga.txt') },
  { league: 141, name: 'Segunda División', country: 'esp', first: 2010, tz: '+01:00', path: dir('espana', '2-liga2.txt') },
  { league: 135, name: 'Serie A', country: 'ita', first: 2013, tz: '+01:00', path: dir('italy', '1-seriea.txt') },
  { league: 136, name: 'Serie B', country: 'ita', first: 2013, tz: '+01:00', path: dir('italy', '2-serieb.txt') },
  { league: 61, name: 'Ligue 1', country: 'fra', first: 2014, tz: '+01:00', path: europe('france', 'fr1') },
  { league: 62, name: 'Ligue 2', country: 'fra', first: 2014, tz: '+01:00', path: europe('france', 'fr2') },
  { league: 88, name: 'Eredivisie', country: 'ned', first: 2014, tz: '+01:00', path: europe('netherlands', 'nl1') },
  { league: 89, name: 'Eerste Divisie', country: 'ned', first: 2020, tz: '+01:00', path: europe('netherlands', 'nl2') },
  { league: 94, name: 'Primeira Liga', country: 'por', first: 2014, tz: '+00:00', path: europe('portugal', 'pt1') },
  { league: 95, name: 'Segunda Liga', country: 'por', first: 2020, tz: '+00:00', path: europe('portugal', 'pt2') },
  { league: 179, name: 'Scottish Premiership', country: 'sco', first: 2014, tz: '+00:00', path: europe('scotland', 'sco1') },
  { league: 203, name: 'Süper Lig', country: 'tur', first: 2014, tz: '+03:00', path: europe('turkey', 'tr1') },
  { league: 204, name: '1. Lig', country: 'tur', first: 2019, tz: '+03:00', path: europe('turkey', 'tr2') },
  { league: 144, name: 'Belgian Pro League', country: 'bel', first: 2014, tz: '+01:00', path: dir('belgium', 'be1.txt') },
  { league: 218, name: 'Austrian Bundesliga', country: 'aut', first: 2014, tz: '+01:00', path: dir('austria', '1-bundesliga.txt') },
  { league: 219, name: 'Austrian 2. Liga', country: 'aut', first: 2018, tz: '+01:00', path: dir('austria', '2-liga2.txt') },
  { league: 2, name: 'Champions League', country: 'uefa', first: 2011, tz: '+01:00', path: dir('champions-league', 'cl.txt') },
  { league: 3, name: 'Europa League', country: 'uefa', first: 2011, tz: '+01:00', path: dir('champions-league', 'el.txt') },
  { league: 848, name: 'Conference League', country: 'uefa', first: 2021, tz: '+01:00', path: dir('champions-league', 'conf.txt') },
  { league: 71, name: 'Brasileirão Série A', country: 'bra', first: 2013, tz: '-03:00', path: (s) => `south-america/master/brazil/${s}_br1.txt` },
  { league: 72, name: 'Brasileirão Série B', country: 'bra', first: 2013, tz: '-03:00', path: (s) => `south-america/master/brazil/${s}_br2.txt` },
  // Argentina switched to calendar-year seasons in 2020 ("2018-19", then "2020").
  { league: 128, name: 'Liga Profesional', country: 'arg', first: 2018, tz: '-03:00', path: (s) => `south-america/master/argentina/${s >= 2020 ? s : span(s)}_ar1.txt` },
  { league: 262, name: 'Liga MX', country: 'mex', first: 2021, tz: '-06:00', path: (s) => `world/master/north-america/mexico/${span(s)}_mx1.txt` },
];

export const ofLeagueFor = (league: number): OfLeague | undefined => OF_LEAGUES.find((l) => l.league === league);

/**
 * A club's id and name from a match line. European cup files tag clubs with a country code ("Aston Villa FC (ENG)"):
 * the code becomes the prefix and is cut from the name. League files use the league's own prefix.
 */
export function ofClub(raw: string, l: Pick<OfLeague, 'country'>): { ext_id: string; name: string } {
  const tagged = /^(.*?)\s*\(([A-Z]{3})\)\s*$/.exec(raw);
  const name = (tagged ? tagged[1]! : raw).trim();
  const prefix = tagged ? tagged[2]!.toLowerCase() : l.country;
  return { ext_id: prefix ? `${prefix}:${name}` : name, name };
}
