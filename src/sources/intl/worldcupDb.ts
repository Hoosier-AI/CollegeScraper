// Pure: The Fjelstul World Cup Database (github.com/jfjelstul/worldcup, CC BY-SA 4.0, credited as its licence asks)
// -> rows. Every men's World Cup 1930-2022 and women's 1991-2019: matches (extra time and shoot-outs), goals with
// minutes, every squad with shirt numbers and positions, and the players' birth dates and Wikipedia articles.
// Team names map onto the reference spellings (West Germany -> Germany, as FIFA counts it; see nations.ts).
import { csvFields } from '../footballData/parse.js';
import { canonicalNation, nationKey } from './nations.js';
import type { IntlGoalRow, IntlMatchRow } from './results.js';

export const WCDB_BASE = 'https://raw.githubusercontent.com/jfjelstul/worldcup/master/data-csv';
export const WCDB_SOURCE = 'worldcup-db';
export const WCDB_FILES = ['matches', 'goals', 'squads', 'players'] as const;

export interface IntlSquadRow {
  source: string; gender: 'm' | 'w'; tournament: string; year: number; league_id: number; nation: string; player_name: string; ext_player: string;
  shirt: number | null; position: string | null; birth_date: string | null; wiki_title: string | null;
}

function rows(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const head = csvFields(lines[0] ?? '');
  return lines.slice(1).map((l) => { const f = csvFields(l); return Object.fromEntries(head.map((h, i) => [h, f[i] ?? ''])); });
}
const int = (v: string | undefined) => (v == null || v === '' || v === 'NA' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const genderOf = (tournament: string): 'm' | 'w' => (/women/i.test(tournament) ? 'w' : 'm');
const person = (given: string | undefined, family: string | undefined) => [given, family].filter((x) => x && x !== 'not applicable').join(' ').trim();

export function parseWcdbMatches(text: string): IntlMatchRow[] {
  return rows(text).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.match_date ?? '') && r.home_team_name && r.away_team_name).map((r) => {
    const gender = genderOf(r.tournament_name ?? '');
    const pens = r.penalty_shootout === '1';
    return {
      source: WCDB_SOURCE, gender, level: 'senior' as const, date: r.match_date!, home: nationKey(r.home_team_name!), away: nationKey(r.away_team_name!),
      home_name: canonicalNation(r.home_team_name!), away_name: canonicalNation(r.away_team_name!),
      home_score: int(r.home_team_score), away_score: int(r.away_team_score),
      pen_home: pens ? int(r.home_team_score_penalties) : null, pen_away: pens ? int(r.away_team_score_penalties) : null, aet: r.extra_time === '1',
      shootout_winner: pens ? (Number(r.home_team_score_penalties) > Number(r.away_team_score_penalties) ? nationKey(r.home_team_name!) : nationKey(r.away_team_name!)) : null,
      tournament: gender === 'w' ? "FIFA Women's World Cup" : 'FIFA World Cup', league_id: gender === 'w' ? 8 : 1,
      stage: [r.stage_name, r.group_name && r.group_name !== 'not applicable' ? r.group_name : null].filter(Boolean).join(', ') || null,
      city: r.city_name || null, country: r.country_name || null, neutral: null, ext_id: r.match_id || null,
    };
  });
}

/** Goals, placed on their match (the goals file names the match by id). */
export function parseWcdbGoals(text: string, matches: IntlMatchRow[]): IntlGoalRow[] {
  const byId = new Map(matches.filter((m) => m.ext_id).map((m) => [m.ext_id!, m]));
  const seq = new Map<string, number>();
  const out: IntlGoalRow[] = [];
  for (const r of rows(text)) {
    const m = byId.get(r.match_id ?? '');
    if (!m) continue;
    const n = (seq.get(m.ext_id!) ?? 0) + 1; seq.set(m.ext_id!, n);
    out.push({
      source: WCDB_SOURCE, gender: m.gender, date: m.date, home: m.home, away: m.away, seq: n,
      // The side the goal counts for (an own goal is filed under the scorer's own team in the player columns).
      team: nationKey(r.team_name ?? ''), scorer: person(r.given_name, r.family_name),
      minute: int(r.minute_regulation), stoppage: int(r.minute_stoppage) || null, own_goal: r.own_goal === '1', penalty: r.penalty === '1', assist: null, ext_player: r.player_id || null,
    });
  }
  return out;
}

/** FIFA's three-letter codes, by nation (the database's team codes). */
export function wcdbCodes(matchesText: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows(matchesText)) for (const [n, c] of [[r.home_team_name, r.home_team_code], [r.away_team_name, r.away_team_code]]) if (n && c && /^[A-Z]{3}$/.test(c)) out.set(nationKey(n), c);
  return out;
}

export function parseWcdbSquads(squadsText: string, playersText: string): IntlSquadRow[] {
  const people = new Map(rows(playersText).map((p) => [p.player_id!, p]));
  return rows(squadsText).filter((r) => r.tournament_id && r.player_id && r.team_name).map((r) => {
    const p = people.get(r.player_id!);
    const gender = genderOf(r.tournament_name ?? '');
    const link = p?.player_wikipedia_link && /\/wiki\//.test(p.player_wikipedia_link) ? decodeURIComponent(p.player_wikipedia_link.split('/wiki/')[1]!) : null;
    return {
      source: WCDB_SOURCE, gender, tournament: r.tournament_id!, year: Number(/(\d{4})/.exec(r.tournament_id!)?.[1] ?? 0), league_id: gender === 'w' ? 8 : 1,
      nation: nationKey(r.team_name!), player_name: person(r.given_name, r.family_name), ext_player: r.player_id!,
      shirt: int(r.shirt_number) || null, position: r.position_code || null,
      birth_date: p?.birth_date && /^\d{4}-\d{2}-\d{2}$/.test(p.birth_date) ? p.birth_date : null, wiki_title: link,
    };
  });
}
