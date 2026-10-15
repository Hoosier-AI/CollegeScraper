// Reads behind Plaibook Elo for college programs and pro clubs (written nightly by src/jobs/elo.ts): the rankings
// pages, and win/draw/win chances on match previews.
import { kvGet, selectIn, type Db } from '../db/client.js';
import { COLLEGE_DRAW_KEY, PRO_DRAW_KEY, expected, predict, type DrawModel } from '../sources/intl/elo.js';

const HOME = { college: 60, pro: 70 } as const;
const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : d; };
const num = (v: unknown) => (v == null ? null : Number(v));

export interface EloSide { rating: number; rank: number | null; games: number }
export interface EloChances { home: EloSide; away: EloSide; home_win: number; draw: number; away_win: number; as_of: string }

/** Chances for a match between two rated sides (null when either has too few games to say). */
export async function eloChances(db: Db, kind: 'college' | 'pro', homeId: string | number, awayId: string | number, gender: 'm' | 'w', neutral = false): Promise<EloChances | null> {
  const table = kind === 'college' ? 'college_elo' : 'pro_elo', key = kind === 'college' ? 'program_id' : 'team_id';
  const rows = await selectIn<any>(db, table, `${key},rating,rank,games,updated_at`, key, [homeId, awayId]);
  const h = rows.find((r) => String(r[key]) === String(homeId)), a = rows.find((r) => String(r[key]) === String(awayId));
  if (!h || !a || h.games < 5 || a.games < 5) return null;
  const model = (await kvGet<DrawModel>(db, kind === 'college' ? COLLEGE_DRAW_KEY(gender) : PRO_DRAW_KEY(gender))) ?? [0.27, 0.26, 0.24, 0.22, 0.2, 0.17, 0.14, 0.11, 0.08, 0.05];
  const we = expected(Number(h.rating) + (neutral ? 0 : HOME[kind]) - Number(a.rating));
  const p = predict(we, model);
  const side = (r: any): EloSide => ({ rating: Math.round(Number(r.rating)), rank: num(r.rank), games: r.games });
  return { home: side(h), away: side(a), home_win: Math.round(p.win * 1000) / 1000, draw: Math.round(p.draw * 1000) / 1000, away_win: Math.round(p.loss * 1000) / 1000, as_of: String(h.updated_at).slice(0, 10) };
}

/** College Plaibook Elo rankings: a division's (or every division's) ranked programs, best first. */
export async function collegeElo(db: Db, o: { gender: 'm' | 'w'; division?: string; conference?: string; limit?: unknown; offset?: unknown }) {
  const limit = clamp(o.limit, 1, 200, 100), offset = clamp(o.offset, 0, 10_000, 0);
  const col = o.division ? 'rank' : 'rank_all';
  let q = db.from('college_elo').select('program_id,division,conference_id,rating,games,rank,rank_all,change_30d,last_match,updated_at,college_programs(name,school_seo,college_schools(logo_svg_url)),college_conferences:conference_id(name,short_name)', { count: 'exact' })
    .eq('gender', o.gender).not(col, 'is', null);
  if (o.division) q = q.eq('division', o.division);
  if (o.conference) q = q.eq('conference_id', o.conference);
  const { data, error, count } = await q.order(col).range(offset, offset + limit - 1);
  if (error) throw new Error(`college elo: ${error.message}`);
  const rows = (data ?? []) as any[];
  return {
    total: count ?? rows.length, limit, offset, as_of: rows[0]?.updated_at?.slice(0, 10) ?? null,
    rows: rows.map((r, i) => ({ rank: o.conference ? offset + i + 1 : r[col], division_rank: r.rank, program: { id: r.program_id, name: r.college_programs?.name, seo: r.college_programs?.school_seo, logo: r.college_programs?.college_schools?.logo_svg_url ?? null },
      division: r.division, conference: r.college_conferences?.short_name ?? r.college_conferences?.name ?? null, rating: Math.round(Number(r.rating)), change_30d: num(r.change_30d), games: r.games, last_match: r.last_match })),
  };
}

/** Pro club Plaibook Elo: the world's ranked clubs, or one country's (US first: rank within the country too). */
export async function proElo(db: Db, o: { gender: 'm' | 'w'; country?: string | null; limit?: unknown; offset?: unknown }) {
  const limit = clamp(o.limit, 1, 200, 100), offset = clamp(o.offset, 0, 20_000, 0);
  let q = db.from('pro_elo').select('team_id,country,rating,games,rank,change_30d,last_match,updated_at,pro_teams(display_name,slug,logo)', { count: 'exact' }).eq('gender', o.gender).not('rank', 'is', null);
  if (o.country) q = q.eq('country', o.country);
  const { data, error, count } = await q.order('rank').range(offset, offset + limit - 1);
  if (error) throw new Error(`pro elo: ${error.message}`);
  const rows = (data ?? []) as any[];
  return {
    total: count ?? rows.length, limit, offset, as_of: rows[0]?.updated_at?.slice(0, 10) ?? null,
    rows: rows.map((r, i) => ({ rank: o.country ? offset + i + 1 : r.rank, world_rank: r.rank, team: { id: r.team_id, name: r.pro_teams?.display_name, slug: r.pro_teams?.slug, logo: r.pro_teams?.logo ?? null },
      country: r.country, rating: Math.round(Number(r.rating)), change_30d: num(r.change_30d), games: r.games, last_match: r.last_match })),
  };
}

/** One program's Plaibook Elo with its season trend (college_elo_history, written by the college-elo job). */
export async function programElo(db: Db, programId: string) {
  const { data, error } = await db.from('college_elo').select('rating,rank,rank_all,division,games,change_30d,season').eq('program_id', programId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: hist, error: e2 } = await db.from('college_elo_history').select('day,rating').eq('program_id', programId).order('day').limit(400);
  // Before migration 182 the table is missing: the trend is simply left out.
  return { ...data, rating: Number(data.rating), history: e2 ? [] : (hist ?? []).map((h: any) => ({ day: String(h.day), rating: Number(h.rating) })) };
}
