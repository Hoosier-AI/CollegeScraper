// College Team of the Week (migration 189): a week's best-rated XI (Monday to Sunday, Eastern) for a gender and
// division, or one conference, from the box-score ratings, with each player's name, photo, school and the game.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { memo } from '../pro/memo.js';

export const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : s);

export interface TotwFilter { season: number; gender: 'm' | 'w'; division: string | null; week: string | null; conference: string | null }

export async function collegeTeamOfWeek(db: Db, f: TotwFilter) {
  return memo(`ctotw:${f.season}:${f.gender}:${f.division ?? ''}:${f.week ?? ''}:${f.conference ?? ''}`, async () => {
    const { data, error } = await db.rpc('college_team_of_week', { p_season: f.season, p_gender: f.gender, p_division: f.division, p_week: f.week, p_conference: f.conference });
    if (error) throw new Error(error.message);
    const r = data as { week: string | null; current: string; weeks: { week: string; games: number }[]; xi: any[] };
    const playerIds = [...new Set(r.xi.map((x) => x.player_id).filter(Boolean))] as string[];
    const progIds = [...new Set(r.xi.flatMap((x) => [x.program_id, x.opponent_id]).filter(Boolean))] as string[];
    const [people, photos, progs] = await Promise.all([
      playerIds.length ? selectAll<any>(db, 'college_players', 'id,display_name,first_name,last_name,slug,suppress', (q) => q.in('id', playerIds)) : Promise.resolve([]),
      playerIds.length ? selectAll<any>(db, 'college_player_seasons', 'player_id,headshot_url,position,class_year', (q) => q.in('player_id', playerIds).eq('season', f.season)) : Promise.resolve([]),
      progIds.length ? selectAll<any>(db, 'college_programs', 'id,name,short_name,school_seo,gender,college_schools(logo_svg_url)', (q) => q.in('id', progIds)) : Promise.resolve([]),
    ]);
    const who = new Map(people.map((p) => [p.id, p]));
    const photo = new Map(photos.map((p) => [p.player_id, p]));
    const prog = new Map(progs.map((p) => [p.id, { id: p.id, name: p.name, short_name: p.short_name ?? null, seo: p.school_seo ?? null, gender: p.gender, logo: p.college_schools?.logo_svg_url ?? null }]));
    const row: Record<string, number> = { G: 1, D: 2, M: 3, F: 4 };
    const col = new Map<string, number>();
    const xi = r.xi
      // A player who asked not to be named is left out of the XI rather than shown without a name.
      .filter((x) => !(x.player_id && who.get(x.player_id)?.suppress))
      .map((x) => {
        const p = x.player_id ? who.get(x.player_id) : null;
        const c = (col.get(x.pos) ?? 0) + 1; col.set(x.pos, c);
        return {
          ...x, rating: Number(x.rating), name: titleCase(p?.display_name ?? x.name), slug: p?.slug ?? null, photo: x.player_id ? photo.get(x.player_id)?.headshot_url ?? null : null,
          class_year: x.player_id ? photo.get(x.player_id)?.class_year ?? null : null, grid: `${row[x.pos]}:${c}`, team: prog.get(x.program_id) ?? null, opponent: x.opponent_id ? prog.get(x.opponent_id) ?? null : null,
        };
      });
    return { week: r.week, current: r.current, weeks: r.weeks, xi };
  }, { fresh: 15 * 60_000 });
}
