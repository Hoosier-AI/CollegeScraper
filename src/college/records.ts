// College records and streaks (/records, the team page's Streaks card): runs still going (teams unbeaten, winning,
// keeping clean sheets, scoring; players scoring or getting a point in consecutive games they played) and the
// season's best single games (goals, points, saves, rating), for a gender and division. From finished games and
// the box-score lines (college_player_ratings, migration 189).
import type { Db } from '../db/client.js';
import { selectAll, selectIn } from '../db/client.js';
import { memo } from '../pro/memo.js';
import { titleCase } from './teamOfWeek.js';

export interface TeamRun { program_id: string; unbeaten: number; winning: number; clean: number; scoring: number; winless: number; last: string | null }

/** Each team's runs still going, from its finished games newest first. */
export function teamRuns(games: { home: string; away: string; hs: number; as: number; date: string }[]): Map<string, TeamRun> {
  const by = new Map<string, { gf: number; ga: number; date: string }[]>();
  for (const g of games) {
    by.set(g.home, [...(by.get(g.home) ?? []), { gf: g.hs, ga: g.as, date: g.date }]);
    by.set(g.away, [...(by.get(g.away) ?? []), { gf: g.as, ga: g.hs, date: g.date }]);
  }
  const out = new Map<string, TeamRun>();
  for (const [id, ls] of by) {
    ls.sort((a, b) => b.date.localeCompare(a.date));
    const run = (ok: (x: { gf: number; ga: number }) => boolean) => { let n = 0; for (const x of ls) { if (!ok(x)) break; n++; } return n; };
    out.set(id, { program_id: id, unbeaten: run((x) => x.gf >= x.ga), winning: run((x) => x.gf > x.ga), clean: run((x) => x.ga === 0), scoring: run((x) => x.gf > 0), winless: run((x) => x.gf <= x.ga), last: ls[0]?.date ?? null });
  }
  return out;
}

/** A player's runs still going: games in a row (of those they played) with a goal, and with a goal or an assist. */
export function playerRuns(lines: { player: string; date: string; goals: number; assists: number }[]): Map<string, { goals: number; points: number; last: string }> {
  const by = new Map<string, typeof lines>();
  for (const l of lines) by.set(l.player, [...(by.get(l.player) ?? []), l]);
  const out = new Map<string, { goals: number; points: number; last: string }>();
  for (const [p, ls] of by) {
    ls.sort((a, b) => b.date.localeCompare(a.date));
    let g = 0; for (const l of ls) { if (l.goals <= 0) break; g++; }
    let pt = 0; for (const l of ls) { if (l.goals + l.assists <= 0) break; pt++; }
    out.set(p, { goals: g, points: pt, last: ls[0]!.date });
  }
  return out;
}

export async function collegeRecords(db: Db, o: { season: number; gender: 'm' | 'w'; division: string }) {
  return memo(`records:${o.season}:${o.gender}:${o.division}`, async () => {
    // The runs and best games are worked out in the database (migration 191); teamRuns / playerRuns above are the
    // same rules in TypeScript, kept for the tests.
    const { data, error } = await db.rpc('college_records', { p_season: o.season, p_gender: o.gender, p_division: o.division });
    if (error) throw new Error(error.message);
    const r = data as any;
    // A player run is still going only if they have played in the last three weeks (an injured scorer's run from
    // September is not one to follow).
    const recent = new Date(Date.now() - 21 * 86400_000).toISOString().slice(0, 10);
    for (const k of Object.keys(r.player)) r.player[k] = (r.player[k] as any[]).filter((p) => String(p.last).slice(0, 10) >= recent);
    // A player under a takedown request is left out of the runs and the best games (src/api/redact.ts).
    const named = [...new Set([...Object.values(r.player), ...Object.values(r.games)].flatMap((list: any) => (list as any[]).map((x) => x.player_id)).filter(Boolean))] as string[];
    const hidden = new Set(named.length ? (await selectIn<any>(db, 'college_players', 'id,suppress', 'id', named)).filter((p) => p.suppress).map((p) => p.id) : []);
    if (hidden.size) for (const part of [r.player, r.games]) for (const k of Object.keys(part)) part[k] = (part[k] as any[]).filter((x) => !hidden.has(x.player_id));
    const ids = new Set<string>();
    for (const list of Object.values(r.team) as any[][]) for (const t of list) ids.add(t.program_id);
    for (const list of Object.values(r.player) as any[][]) for (const p of list) { if (p.program_id) ids.add(p.program_id); p.name = titleCase(String(p.name ?? '')); }
    for (const list of Object.values(r.games) as any[][]) for (const g of list) { ids.add(g.program_id); if (g.opponent_id) ids.add(g.opponent_id); g.name = titleCase(String(g.name ?? '')); g.rating = Number(g.rating); }
    const progs = ids.size ? await selectAll<any>(db, 'college_programs', 'id,name,short_name,school_seo,gender,college_schools(logo_svg_url)', (q) => q.in('id', [...ids])) : [];
    const programs = Object.fromEntries(progs.map((p) => [p.id, { id: p.id, name: p.name, short_name: p.short_name ?? null, seo: p.school_seo ?? null, logo: p.college_schools?.logo_svg_url ?? null }]));
    return { season: o.season, gender: o.gender, division: o.division, played: Number(r.played), team: r.team, player: r.player, games: r.games, programs, runs: r.runs as Record<string, Omit<TeamRun, 'program_id'>> };
  }, { fresh: 15 * 60_000 });
}
