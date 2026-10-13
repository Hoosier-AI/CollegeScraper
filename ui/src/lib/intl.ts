// International (/intl): the shapes /api/intl/* returns (src/pro/intl.ts) and small display helpers.
import type { ProMatch } from './pro';

export interface NationRef { key: string; name: string; slug: string | null; logo: string | null; fifa_code: string | null; confederation: string | null }
export interface IntlResult {
  date: string; home: NationRef; away: NationRef; home_score: number | null; away_score: number | null; aet: boolean | null; pen: [number | null, number | null]; shootout_winner: string | null;
  tournament: string; stage: string | null; city: string | null; country: string | null; neutral: boolean | null; source: string; match_slug: string | null;
}
export interface Tally { played: number; w: number; d: number; l: number; gf: number; ga: number }
export interface Credit { name: string; url: string; license: string }
export interface NationHistory {
  nation: NationRef & { first_match: string | null; fifa: boolean }; gender: 'm' | 'w'; record: Tally; first_match: string | null;
  competitions: (Tally & { name: string; first: string; last: string })[];
  opponents: (Tally & { nation: NationRef; last: string })[];
  biggest_wins: IntlResult[]; worst_defeats: IntlResult[]; recent: IntlResult[];
  scorers: { name: string; goals: number; penalties: number; first: string; last: string; slug: string | null }[];
  caps: { name: string; caps: number | null; goals: number | null; first_year: number | null; last_year: number | null; slug: string | null; photo: string | null }[];
  world_cups: { editions: number; years: number[] };
  elo: { rating: number; rank: number | null; matches: number; last_match: string; change_1y: number | null; best: number; best_date: string; best_rank: number | null; best_rank_date: string | null; series: { date: string; rating: number }[] } | null;
  credits: Credit[];
}
export interface IntlTournament {
  id: number; name: string; slug: string; logo: string | null; gender: 'm' | 'w'; type: 'league' | 'cup'; level: 'senior' | 'youth'; confederation: string;
  priority: number; current_season: number | null; starts_on: string | null; ends_on: string | null; state: 'live' | 'upcoming' | 'off';
}
export interface IntlNation { id: number; name: string; slug: string; logo: string | null; gender: 'm' | 'w'; level: 'senior' | 'youth'; confederation: string; competitions: number; country: string | null }
export interface IntlHome { date: string; matches: { date: string; total: number; live: number; groups: { league: ProMatch['league']; priority: number; matches: ProMatch[] }[] }; upcoming: ProMatch[]; recent: ProMatch[]; tournaments: IntlTournament[]; counts: { tournaments: number; nations: number; nations_all: number } }
export interface IntlRankings { gender: 'm' | 'w'; updated_at: string | null; credit: Credit | null; rows: { nation: NationRef; rating: number; rank: number; matches: number; last_match: string; change_1y: number | null; best: number; best_date: string; best_rank: number | null; best_rank_date: string | null }[] }

/** "Sep 2005": the month of a best rank. */
export const monthLabel = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '');

/** The confederations in the section's order, and how they read. */
export const CONFEDERATIONS = ['FIFA', 'CONCACAF', 'UEFA', 'CONMEBOL', 'CAF', 'AFC', 'OFC', 'Other'] as const;
export const CONFEDERATION_LABEL: Record<string, string> = {
  FIFA: 'Worldwide', CONCACAF: 'CONCACAF: North and Central America, Caribbean', UEFA: 'UEFA: Europe', CONMEBOL: 'CONMEBOL: South America', CAF: 'CAF: Africa',
  AFC: 'AFC: Asia', OFC: 'OFC: Oceania', Other: 'Other tournaments',
};
export const confRank = (c: string | null | undefined) => { const i = (CONFEDERATIONS as readonly string[]).indexOf(c ?? 'Other'); return i < 0 ? CONFEDERATIONS.length : i; };

/** W, D or L for a nation in a result (a shoot-out is a draw, its winner noted). */
export function outcome(r: IntlResult, key: string): 'W' | 'D' | 'L' | null {
  if (r.home_score == null || r.away_score == null) return null;
  const us = r.home.key === key ? r.home_score : r.away_score, them = r.home.key === key ? r.away_score : r.home_score;
  return us > them ? 'W' : us < them ? 'L' : 'D';
}
export const winPct = (t: Tally) => (t.played ? Math.round((t.w / t.played) * 100) : 0);
