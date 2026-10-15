// Home / Away / Form tables (src/standings/views.ts) for a pro competition season (each group of its official
// table; playoff rounds left out) and a college conference (its conference games).
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { teamsById } from '../pro/queries.js';
import { memo } from '../pro/memo.js';
import { tableView, type TableView } from './views.js';

const KNOCKOUT = /final|semi|quarter|round of|play-?offs?|knockout|wild ?card|1\/\d/i;

export async function proTableView(db: Db, league: number, season: number, view: TableView) {
  return memo(`ptv:${league}:${season}:${view}`, async () => {
    const [standing, fx] = await Promise.all([
      selectAll<{ group_name: string | null; team_id: number }>(db, 'pro_standings', 'group_name,team_id', (q) => q.eq('league_id', league).eq('season', season)),
      selectAll<any>(db, 'pro_fixtures', 'home_team_id,away_team_id,home_goals,away_goals,kickoff,round', (q) => q.eq('league_id', league).eq('season', season).eq('status', 'final').not('home_goals', 'is', null)),
    ]);
    if (!standing.length) return { groups: [] };
    const matches = fx.filter((f) => !KNOCKOUT.test(f.round ?? '')).map((f) => ({ home: String(f.home_team_id), away: String(f.away_team_id), hs: f.home_goals, as: f.away_goals, date: f.kickoff }));
    const groups = new Map<string, number[]>();
    for (const s of standing) groups.set(s.group_name ?? '', [...(groups.get(s.group_name ?? '') ?? []), s.team_id]);
    const teams = await teamsById(db, [...new Set(standing.map((s) => s.team_id))]);
    return {
      groups: [...groups].map(([name, ids]) => ({
        name, rows: tableView(matches, [...new Set(ids)].map(String), view).map((r) => ({ ...r, team: teams.get(Number(r.team)) ?? { id: Number(r.team), name: '?', slug: null, logo: null } })),
      })),
    };
  }, { fresh: 10 * 60_000 });
}

export async function collegeTableView(db: Db, conference: string, season: number, gender: 'm' | 'w', view: TableView) {
  return memo(`ctv:${conference}:${season}:${gender}:${view}`, async () => {
    const members = await selectAll<any>(db, 'college_program_seasons', 'program_id,college_programs!inner(id,name,short_name,school_seo,gender,college_schools(logo_svg_url))',
      (q) => q.eq('season', season).eq('conference_id', conference).eq('college_programs.gender', gender));
    const ids = members.map((m) => m.program_id as string);
    if (!ids.length) return { rows: [] };
    const games = await selectAll<any>(db, 'college_games', 'home_program_id,away_program_id,home_score,away_score,game_date',
      (q) => q.eq('season', season).eq('status', 'final').eq('conference_game', true).in('home_program_id', ids).not('home_score', 'is', null));
    const set = new Set(ids);
    const matches = games.filter((g) => set.has(g.away_program_id)).map((g) => ({ home: g.home_program_id, away: g.away_program_id, hs: g.home_score, as: g.away_score, date: g.game_date }));
    const prog = new Map(members.map((m) => [m.program_id, { id: m.program_id, name: m.college_programs.name, short_name: m.college_programs.short_name ?? null, seo: m.college_programs.school_seo ?? null, logo: m.college_programs.college_schools?.logo_svg_url ?? null }]));
    return { rows: tableView(matches, ids, view).map((r) => ({ ...r, team: prog.get(r.team)! })) };
  }, { fresh: 10 * 60_000 });
}
