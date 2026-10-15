// Reads of the season simulations (college_sim_odds, migration 190): the NCAA tournament page (projected field,
// seeds, bubble and every team's odds), a conference's title race and one team's postseason chances.
import type { Db } from '../db/client.js';
import { kvGet, selectAll } from '../db/client.js';
import { memo } from '../pro/memo.js';
import { SIMS_LAST_KEY } from '../jobs/collegeSims.js';

const FIELD: Record<string, { field: number; seeds: number }> = { m: { field: 48, seeds: 16 }, w: { field: 64, seeds: 16 } };
const COLS = 'program_id,conference_id,reg_title,auto_bid,bid,seed,avg_rank,avg_points,points_now,max_points,conf_left,clinched,eliminated,magic,sims,run_at';
const num = (v: unknown) => (v == null ? null : Number(v));
const shape = (r: any) => ({ ...r, reg_title: num(r.reg_title), auto_bid: num(r.auto_bid), bid: num(r.bid), seed: num(r.seed), avg_rank: num(r.avg_rank), avg_points: num(r.avg_points) });

async function programs(db: Db, ids: string[]) {
  const rows = ids.length ? await selectAll<any>(db, 'college_programs', 'id,name,short_name,school_seo,gender,college_schools(logo_svg_url)', (q) => q.in('id', ids)) : [];
  return new Map(rows.map((p) => [p.id, { id: p.id, name: p.name, short_name: p.short_name ?? null, seo: p.school_seo ?? null, gender: p.gender, logo: p.college_schools?.logo_svg_url ?? null }]));
}

/** Division I, one gender: every team with any chance, the projected field (each automatic-bid conference's likeliest
 *  champion, then the likeliest at-large teams), the top seeds and the bubble. */
export async function tournamentOdds(db: Db, season: number, gender: 'm' | 'w') {
  return memo(`tourney:${season}:${gender}`, async () => {
    const [odds, last] = await Promise.all([
      selectAll<any>(db, 'college_sim_odds', COLS, (q) => q.eq('season', season).eq('gender', gender).eq('division', 'd1').order('program_id')),
      kvGet<{ at: string; sims: number }>(db, SIMS_LAST_KEY),
    ]);
    if (!odds.length) return null;
    const rows = odds.map(shape);
    const ids = rows.map((r) => r.program_id);
    const confIds = [...new Set(rows.map((r) => r.conference_id).filter(Boolean))] as string[];
    const [progs, confs, rpi] = await Promise.all([
      programs(db, ids),
      confIds.length ? selectAll<any>(db, 'college_conferences', 'id,name,short_name', (q) => q.in('id', confIds)) : Promise.resolve([]),
      selectAll<any>(db, 'college_rpi', 'program_id,rank,w,l,t', (q) => q.in('program_id', ids)),
    ]);
    const conf = new Map(confs.map((c) => [c.id, { id: c.id, name: c.name, short: c.short_name ?? null }]));
    const rp = new Map(rpi.map((r) => [r.program_id, r]));
    const f = FIELD[gender]!;
    const teams = rows.map((r) => ({ ...r, program: progs.get(r.program_id) ?? null, conference: r.conference_id ? conf.get(r.conference_id) ?? null : null,
      rpi_rank: rp.get(r.program_id)?.rank ?? null, record: rp.get(r.program_id) ? { w: rp.get(r.program_id).w, l: rp.get(r.program_id).l, t: rp.get(r.program_id).t } : null }))
      .filter((t) => t.program);
    // The projected field: in each automatic-bid conference (any team with an auto chance), its likeliest champion.
    const byConf = new Map<string, typeof teams>();
    for (const t of teams) if (t.conference_id && t.auto_bid > 0) byConf.set(t.conference_id, [...(byConf.get(t.conference_id) ?? []), t]);
    const autos = [...byConf.values()].map((ts) => [...ts].sort((a, b) => b.auto_bid - a.auto_bid || b.bid - a.bid)[0]!);
    const autoIds = new Set(autos.map((t) => t.program_id));
    const atLarge = teams.filter((t) => !autoIds.has(t.program_id)).sort((a, b) => b.bid - a.bid || (a.avg_rank ?? 999) - (b.avg_rank ?? 999));
    const atLargeIn = atLarge.slice(0, Math.max(0, f.field - autos.length));
    const field = [...autos, ...atLargeIn].sort((a, b) => b.seed - a.seed || (a.avg_rank ?? 999) - (b.avg_rank ?? 999));
    return {
      season, gender, run_at: rows[0].run_at, sims: rows[0].sims, as_of: last?.at ?? rows[0].run_at, field_size: f.field, seeds: f.seeds,
      field: field.map((t, i) => ({ ...t, projected_seed: i < f.seeds ? i + 1 : null, how: autoIds.has(t.program_id) ? 'auto' : 'at-large' })),
      last_in: atLargeIn.slice(-4).reverse(),
      first_out: atLarge.slice(atLargeIn.length, atLargeIn.length + 4),
      teams: teams.filter((t) => t.bid >= 0.001 || t.reg_title >= 0.001).sort((a, b) => b.bid - a.bid || b.reg_title - a.reg_title),
    };
  }, { fresh: 10 * 60_000 });
}

/** A conference's title race, or one program's chances. */
export async function simOdds(db: Db, o: { season: number; conference?: string | null; program?: string | null; gender?: 'm' | 'w' | null }) {
  const rows = await selectAll<any>(db, 'college_sim_odds', `${COLS},gender,division`, (q) => {
    let x = q.eq('season', o.season);
    if (o.program) x = x.eq('program_id', o.program);
    if (o.conference) x = x.eq('conference_id', o.conference);
    if (o.gender) x = x.eq('gender', o.gender);
    return x.order('program_id');
  });
  const progs = await programs(db, rows.map((r) => r.program_id));
  return { rows: rows.map((r) => ({ ...shape(r), program: progs.get(r.program_id) ?? null })).sort((a, b) => b.reg_title - a.reg_title || b.points_now - a.points_now) };
}
