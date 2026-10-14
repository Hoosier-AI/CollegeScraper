// Reads behind live RPI (written by the college-rpi job, src/jobs/rpi.ts): the Rankings tab and a team's RPI.
import { kvGet, selectAll, type Db } from '../db/client.js';
import { RPI_AGREEMENT_KEY } from '../jobs/rpi.js';

const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : d; };
const n4 = (v: unknown) => Math.round(Number(v) * 10000) / 10000;

export async function rpiTable(db: Db, o: { gender: 'm' | 'w'; division: string; conference?: string; limit?: unknown; offset?: unknown }) {
  const limit = clamp(o.limit, 1, 400, 100), offset = clamp(o.offset, 0, 2000, 0);
  let q = db.from('college_rpi').select('program_id,division,w,l,t,wp,owp,oowp,rpi,rank,rank_yesterday,official_rank,official_prev,official_as_of,updated_at,college_programs(name,school_seo,college_schools(logo_svg_url)),college_conferences:conference_id(name,short_name)', { count: 'exact' })
    .eq('gender', o.gender).eq('division', o.division);
  if (o.conference) q = q.eq('conference_id', o.conference);
  const { data, error, count } = await q.order('rank').range(offset, offset + limit - 1);
  if (error) throw new Error(`rpi: ${error.message}`);
  const rows = (data ?? []) as any[];
  const agreement = (await kvGet<{ agreement: Record<string, { spearman: number; teams: number; top25_mean_diff: number; as_of: string | null }> }>(db, RPI_AGREEMENT_KEY))?.agreement?.[o.gender] ?? null;
  return {
    total: count ?? rows.length, limit, offset, updated_at: rows[0]?.updated_at ?? null, official_as_of: rows.find((r) => r.official_as_of)?.official_as_of ?? null,
    agreement: o.division === 'd1' ? agreement : null,
    rows: rows.map((r) => ({ rank: r.rank, rank_yesterday: r.rank_yesterday, official_rank: r.official_rank, official_prev: r.official_prev,
      program: { id: r.program_id, name: r.college_programs?.name, seo: r.college_programs?.school_seo, logo: r.college_programs?.college_schools?.logo_svg_url ?? null },
      conference: r.college_conferences?.short_name ?? r.college_conferences?.name ?? null, record: { w: r.w, l: r.l, t: r.t },
      rpi: n4(r.rpi), wp: n4(r.wp), owp: n4(r.owp), oowp: n4(r.oowp) })),
  };
}

/** One program's RPI now and its daily history this season (team page). */
export async function programRpi(db: Db, programId: string, season: number) {
  const [{ data: now }, history] = await Promise.all([
    db.from('college_rpi').select('season,division,rank,rank_yesterday,official_rank,rpi,wp,owp,oowp,updated_at').eq('program_id', programId).maybeSingle(),
    selectAll<any>(db, 'college_rpi_history', 'day,rpi,rank', (q) => q.eq('program_id', programId).eq('season', season).order('day')),
  ]);
  if (!now || (now as any).season !== season) return null;
  const r = now as any;
  return { division: r.division, rank: r.rank, rank_yesterday: r.rank_yesterday, official_rank: r.official_rank, rpi: n4(r.rpi), wp: n4(r.wp), owp: n4(r.owp), oowp: n4(r.oowp), updated_at: r.updated_at,
    history: history.map((h) => ({ day: String(h.day).slice(0, 10), rpi: n4(h.rpi), rank: h.rank })) };
}
