// Plaibook Stats Pro: the shapes /api/pro/* returns (src/pro/queries.ts) and small display helpers.
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { currentLinkSection } from './section';
export interface ProLeagueRef { id: number; name: string; slug: string; logo: string | null; country: string | null; country_flag?: string | null; gender: 'm' | 'w'; type?: 'league' | 'cup'; priority?: number; current_season?: number | null; /** The US scene: a competition in the USA or one US clubs play in. */ us?: boolean;
  /** Club football (Pro) or national teams (International); senior or youth; an international one's confederation. */
  scope?: 'club' | 'intl'; level?: 'senior' | 'youth'; confederation?: string | null }
export interface ProTeamRef { id: number; name: string; slug: string; logo: string | null; country?: string | null; gender?: 'm' | 'w' | null; /** A national team (its pages are International's). */ national?: boolean }
export interface ProSide extends ProTeamRef { score: number | null }
export interface ProMatch {
  id: number; slug: string; kickoff: string; status: string; status_short: string | null; elapsed: number | null; elapsed_extra: number | null; round: string | null; season: number;
  league: ProLeagueRef; home: ProSide; away: ProSide; ht: [number | null, number | null]; et: [number | null, number | null]; pen: [number | null, number | null];
  winner: 'home' | 'away' | 'draw' | null; venue: string | null; detail: boolean;
}
export interface ProDay { date: string; total: number; live: number; groups: { league: ProLeagueRef; priority: number; matches: ProMatch[] }[] }
export interface ProStandingRow { rank: number | null; team: ProTeamRef; played: number | null; win: number | null; draw: number | null; lose: number | null; gf: number | null; ga: number | null; gd: number | null; points: number | null; form: string | null; description: string | null }
export interface ProLeader { player: { id: number; name: string; slug: string; photo: string | null }; team: ProTeamRef | null; apps: number; minutes: number; goals: number; assists: number; rating: number | null }

/** Pro or International: the half a link goes to. `scope` when the link knows (a match's competition); otherwise the
 *  half the reader is in (see lib/section.ts). */
const intl = (scope?: 'club' | 'intl' | null) => (scope ? scope === 'intl' : currentLinkSection() === 'intl');
export const proPath = {
  get home() { return intl() ? '/intl' : '/pro'; },
  get matches() { return intl() ? '/intl/matches' : '/pro/matches'; },
  get leagues() { return intl() ? '/intl/tournaments' : '/pro/leagues'; },
  league: (slug: string, season?: number | null, current?: number | null, scope?: 'club' | 'intl' | null) => `${intl(scope) ? '/intl/tournaments' : '/pro/leagues'}/${slug}${season && season !== current ? `?season=${season}` : ''}`,
  team: (slug: string, season?: number | null, national?: boolean | null) => `${intl(national == null ? null : national ? 'intl' : 'club') ? '/intl/teams' : '/pro/teams'}/${slug}${season ? `?season=${season}` : ''}`,
  player: (slug: string) => `${intl() ? '/intl' : '/pro'}/players/${slug}`,
  match: (slug: string, scope?: 'club' | 'intl' | null) => `${intl(scope) ? '/intl/matches' : '/pro/matches'}/${slug}`,
};

/** "67′", "HT", "90+3′", "ET 105′", "PENS". */
export function proMinute(m: Pick<ProMatch, 'status_short' | 'elapsed' | 'elapsed_extra'>): string {
  const s = m.status_short ?? '';
  if (s === 'HT') return 'HT';
  if (s === 'BT') return 'Break';
  if (s === 'P') return 'Pens';
  if (s === 'SUSP') return 'Susp.';
  if (s === 'INT') return 'Int.';
  if (m.elapsed == null) return 'Live';
  return `${s === 'ET' ? 'ET ' : ''}${m.elapsed}${m.elapsed_extra ? `+${m.elapsed_extra}` : ''}′`;
}

/** What the left column of a match row says: the minute, FT/AET/PENS, a kickoff time, or why there is no score. */
export function proWhen(m: ProMatch): string {
  if (m.status === 'live') return proMinute(m);
  if (m.status === 'final') return m.status_short === 'AET' ? 'AET' : m.status_short === 'PEN' ? 'Pens' : m.status_short === 'AWD' || m.status_short === 'WO' ? 'Awd' : 'FT';
  if (m.status === 'postponed') return 'PPD';
  if (m.status === 'cancelled') return 'Canc';
  if (m.status === 'abandoned') return 'Abd';
  return kickoffTime(m.kickoff);
}

export const kickoffTime = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const kickoffLong = (iso: string): string => new Date(iso).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const genderWord = (g: 'm' | 'w' | null | undefined) => (g === 'w' ? "Women's" : "Men's");

/** Age in whole years from an ISO birth date. */
export function ageFrom(birth: string | null | undefined, now = Date.now()): number | null {
  if (!birth) return null;
  const b = new Date(`${birth.slice(0, 10)}T12:00:00Z`); const n = new Date(now);
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a -= 1;
  return a;
}

/** A league's season as people say it: 2026 for calendar-year leagues, 2026/27 for August-to-May ones. */
export function seasonLabel(season: number, startsOn?: string | null, endsOn?: string | null): string {
  if (startsOn && endsOn && startsOn.slice(0, 4) !== endsOn.slice(0, 4)) return `${season}/${String(season + 1).slice(2)}`;
  return String(season);
}

// ---------- v2 ----------

export const proPaths2 = {
  players: '/pro/players', leaders: '/pro/leaders', countries: '/pro/countries', transfers: '/pro/transfers', college: '/pro/college', abroad: '/pro/abroad',
  country: (slug: string) => `/pro/countries/${slug}`,
  compare: (a: string, b?: string) => `/pro/compare?a=${encodeURIComponent(a)}${b ? `&b=${encodeURIComponent(b)}` : ''}`,
};

/** Stat keys the leaders and directory sort by (pro_leaders), with how people say them. */
export const PRO_STATS: { key: string; label: string; short: string; rate?: boolean; decimals?: number }[] = [
  { key: 'goals', label: 'Goals', short: 'G', rate: true }, { key: 'assists', label: 'Assists', short: 'A', rate: true },
  { key: 'rating', label: 'Average rating', short: 'Rtg', decimals: 2 }, { key: 'minutes', label: 'Minutes', short: 'Min' },
  { key: 'apps', label: 'Appearances', short: 'Apps' }, { key: 'starts', label: 'Starts', short: 'GS' },
  { key: 'shots', label: 'Shots', short: 'Sh', rate: true }, { key: 'shots_on', label: 'Shots on target', short: 'SoT', rate: true },
  { key: 'key_passes', label: 'Key passes', short: 'KP', rate: true }, { key: 'passes', label: 'Passes', short: 'Pass', rate: true },
  { key: 'tackles', label: 'Tackles', short: 'Tkl', rate: true }, { key: 'interceptions', label: 'Interceptions', short: 'Int', rate: true },
  { key: 'duels_won', label: 'Duels won', short: 'Duels', rate: true }, { key: 'dribbles_won', label: 'Dribbles completed', short: 'Drb', rate: true },
  { key: 'blocks', label: 'Blocks', short: 'Blk', rate: true }, { key: 'fouls_drawn', label: 'Fouls drawn', short: 'FD', rate: true },
  { key: 'saves', label: 'Saves', short: 'Sv', rate: true }, { key: 'clean_sheets', label: 'Clean sheets', short: 'CS' },
  { key: 'pen_scored', label: 'Penalties scored', short: 'Pen' }, { key: 'yellow', label: 'Yellow cards', short: 'YC' }, { key: 'red', label: 'Red cards', short: 'RC' },
];
export const statLabel = (k: string) => PRO_STATS.find((s) => s.key === k)?.label ?? k;
export const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'] as const;
export const positionShort = (p: string | null | undefined) => (p ? ({ Goalkeeper: 'GK', Defender: 'DF', Midfielder: 'MF', Attacker: 'FW' } as Record<string, string>)[p] ?? p.slice(0, 3) : '');

export interface ProCountry { name: string; code: string | null; flag: string | null; slug: string; leagues: number }
/** The provider's country list (flags), loaded once per visit. */
export function useCountries() {
  const q = useQuery({ queryKey: ['pro-countries'], queryFn: () => api<ProCountry[]>('/api/pro/countries'), staleTime: 3600_000 });
  const byName = new Map((q.data ?? []).map((c) => [c.name, c]));
  return { list: q.data ?? [], byName, flag: (name: string | null | undefined) => (name ? byName.get(name)?.flag ?? null : null) };
}

/** A per-90 number from a season total, or null under 90 minutes. */
export const per90 = (v: number | null | undefined, minutes: number | null | undefined) => (v == null || !minutes || minutes < 90 ? null : Math.round((v * 9000) / minutes) / 100);

// A cup or one-off tournament: the provider's type, or a name that says so (it files "USL League One Cup", "Copa de la
// Liga Profesional" and a few super cups as leagues).
const CUP_NAME = /\b(cup|copa|coupe|coppa|pokal|ta[cç]a|trophy|shield|beker|kupa|puchar|supercopa|supercoppa|supercup)\b/i;
export const isCup = (l: { type?: string | null; name: string }) => l.type === 'cup' || CUP_NAME.test(l.name);

/** US first (most visitors are American): the scope switch on Leaders, Players and Transfers. */
export const SCOPE_OPTIONS = [{ value: 'us', label: 'US' }, { value: 'world', label: 'Worldwide' }] as const;
export type ProScope = 'us' | 'world';
