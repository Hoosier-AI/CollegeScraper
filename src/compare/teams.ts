// Two teams side by side (FotMob/UniGol team compare): this season's numbers a game, each with its percentile in the
// team's own division (college) or competition (pro), Plaibook Elo, RPI (college), form and their last meetings.
import type { Db } from '../db/client.js';
import { selectAll, selectIn } from '../db/client.js';
import { programH2H } from '../ui/queries.js';
import { teamH2H } from '../pro/queries.js';

export interface CompareRow { key: string; label: string; better: 'high' | 'low'; d: number; a: number | null; b: number | null; pa: number | null; pb: number | null }

/** Percentile (0 to 1) of `v` in `all`, where higher is better (or lower, for goals against). */
export function percentile(v: number | null, all: number[], better: 'high' | 'low'): number | null {
  if (v == null || all.length < 5) return null;
  const below = all.filter((x) => (better === 'high' ? x < v : x > v)).length, same = all.filter((x) => x === v).length;
  return Math.round(((below + same / 2) / all.length) * 100) / 100;
}

const COLLEGE: { key: string; label: string; better: 'high' | 'low'; d: number; get: (s: any) => number | null }[] = [
  { key: 'ppg', label: 'Points a game', better: 'high', d: 2, get: (s) => (s.gp ? (s.w * 3 + s.t) / s.gp : null) },
  { key: 'gf_pg', label: 'Goals a game', better: 'high', d: 2, get: (s) => (s.gp ? s.gf / s.gp : null) },
  { key: 'ga_pg', label: 'Conceded a game', better: 'low', d: 2, get: (s) => (s.gp ? s.ga / s.gp : null) },
  { key: 'shots_pg', label: 'Shots a game', better: 'high', d: 1, get: (s) => (s.gp && s.shots != null ? s.shots / s.gp : null) },
  { key: 'sog_pg', label: 'Shots on goal a game', better: 'high', d: 1, get: (s) => (s.gp && s.sog != null ? s.sog / s.gp : null) },
  { key: 'corners_pg', label: 'Corners a game', better: 'high', d: 1, get: (s) => (s.gp && s.corners != null ? s.corners / s.gp : null) },
  { key: 'clean', label: 'Clean sheets', better: 'high', d: 0, get: (s) => s.clean_sheets ?? null },
  { key: 'saves_pg', label: 'Saves a game', better: 'high', d: 1, get: (s) => (s.gp && s.saves != null ? s.saves / s.gp : null) },
  { key: 'fouls_pg', label: 'Fouls a game', better: 'low', d: 1, get: (s) => (s.gp && s.fouls != null ? s.fouls / s.gp : null) },
];

export async function collegeTeamCompare(db: Db, a: string, b: string, season: number) {
  const [progs, stats, members, elo, rpi, h2h] = await Promise.all([
    selectAll<any>(db, 'college_programs', 'id,name,gender,school_seo,college_schools(logo_svg_url)', (q) => q.in('id', [a, b])),
    selectAll<any>(db, 'college_team_season_stats', '*', (q) => q.in('program_id', [a, b]).eq('season', season)),
    selectAll<any>(db, 'college_program_seasons', 'program_id,division', (q) => q.in('program_id', [a, b]).eq('season', season)),
    selectAll<any>(db, 'college_elo', 'program_id,rating,rank,division', (q) => q.in('program_id', [a, b])),
    selectAll<any>(db, 'college_rpi', 'program_id,rank,rpi,division', (q) => q.in('program_id', [a, b])),
    programH2H(db, a, b).catch(() => null),
  ]);
  const pa = progs.find((p) => p.id === a), pb = progs.find((p) => p.id === b);
  if (!pa || !pb) return null;
  // Each team's percentiles against its own division and gender this season.
  const peerSets = new Map<string, any[]>();
  for (const id of [a, b]) {
    const div = members.find((m) => m.program_id === id)?.division, gender = progs.find((p) => p.id === id)?.gender;
    const k = `${div}|${gender}`;
    if (!div || peerSets.has(k)) continue;
    const ids = (await selectAll<any>(db, 'college_program_seasons', 'program_id,college_programs!inner(gender)', (q) => q.eq('season', season).eq('division', div).eq('college_programs.gender', gender))).map((r) => r.program_id);
    const peers = (await selectIn<any>(db, 'college_team_season_stats', 'program_id,season,gp,w,l,t,gf,ga,shots,sog,corners,clean_sheets,saves,fouls', 'program_id', ids)).filter((r) => r.season === season && r.gp >= 3);
    peerSets.set(k, peers);
  }
  const peersOf = (id: string) => peerSets.get(`${members.find((m) => m.program_id === id)?.division}|${progs.find((p) => p.id === id)?.gender}`) ?? [];
  const sa = stats.find((s) => s.program_id === a), sb = stats.find((s) => s.program_id === b);
  const rows: CompareRow[] = COLLEGE.map((m) => {
    const va = sa ? m.get(sa) : null, vb = sb ? m.get(sb) : null;
    return { key: m.key, label: m.label, better: m.better, d: m.d, a: va, b: vb, pa: percentile(va, peersOf(a).map(m.get).filter((x): x is number => x != null), m.better), pb: percentile(vb, peersOf(b).map(m.get).filter((x): x is number => x != null), m.better) };
  }).filter((r) => r.a != null || r.b != null);
  const side = (p: any, s: any) => ({
    team: { id: p.id, name: p.name, gender: p.gender, seo: p.school_seo, logo: p.college_schools?.logo_svg_url ?? null },
    division: members.find((m) => m.program_id === p.id)?.division ?? null,
    record: s ? { w: s.w, l: s.l, t: s.t, gp: s.gp } : null, form: s?.form_last5 ?? null,
    elo: (() => { const e = elo.find((x) => x.program_id === p.id); return e ? { rating: Math.round(Number(e.rating)), rank: e.rank } : null; })(),
    rpi: (() => { const r = rpi.find((x) => x.program_id === p.id); return r ? { rank: r.rank, rpi: Number(r.rpi) } : null; })(),
  });
  return { season, a: side(pa, sa), b: side(pb, sb), rows, meetings: h2h?.summary ?? null };
}

const PRO: { key: string; label: string; better: 'high' | 'low'; d: number; get: (s: any) => number | null }[] = [
  { key: 'ppg', label: 'Points a match', better: 'high', d: 2, get: (s) => (s.played ? (s.w * 3 + s.d) / s.played : null) },
  { key: 'gf_pg', label: 'Goals a match', better: 'high', d: 2, get: (s) => (s.played ? s.gf / s.played : null) },
  { key: 'ga_pg', label: 'Conceded a match', better: 'low', d: 2, get: (s) => (s.played ? s.ga / s.played : null) },
  { key: 'shots_pg', label: 'Shots a match', better: 'high', d: 1, get: (s) => (s.played && s.shots != null ? s.shots / s.played : null) },
  { key: 'shots_on_pg', label: 'Shots on target a match', better: 'high', d: 1, get: (s) => (s.played && s.shots_on != null ? s.shots_on / s.played : null) },
  { key: 'possession', label: 'Possession', better: 'high', d: 1, get: (s) => (s.possession == null ? null : Number(s.possession)) },
  { key: 'corners_pg', label: 'Corners a match', better: 'high', d: 1, get: (s) => (s.played && s.corners != null ? s.corners / s.played : null) },
  { key: 'clean', label: 'Clean sheets', better: 'high', d: 0, get: (s) => s.clean_sheets ?? null },
  { key: 'cards_pg', label: 'Cards a match', better: 'low', d: 2, get: (s) => (s.played && s.yellow != null ? (s.yellow + (s.red ?? 0)) / s.played : null) },
];

export async function proTeamCompare(db: Db, aSlug: string, bSlug: string) {
  const { data: ts } = await db.from('pro_teams').select('id,name,slug,logo,country,national').in('slug', [aSlug, bSlug]);
  const ta = (ts ?? []).find((t: any) => t.slug === aSlug), tb = (ts ?? []).find((t: any) => t.slug === bSlug);
  if (!ta || !tb) return null;
  // Each club's main competition this season: its league (not a cup) with the most matches in the latest season.
  const main = async (t: any) => {
    const raw = await selectAll<any>(db, 'pro_team_season_stats', 'league_id,season,played,w,d,l,gf,ga,clean_sheets,shots,shots_on,corners,yellow,red,possession', (q) => q.eq('team_id', t.id).order('season', { ascending: false }).limit(20));
    const lgs = new Map((raw.length ? await selectAll<any>(db, 'pro_leagues', 'id,name,slug,type,current_season,logo', (q) => q.in('id', [...new Set(raw.map((r) => r.league_id))])) : []).map((l) => [l.id, l]));
    const rows = raw.map((r) => ({ ...r, pro_leagues: lgs.get(r.league_id) ?? null }));
    const cur = rows.filter((r) => r.pro_leagues && r.pro_leagues.type !== 'cup' && r.season === r.pro_leagues.current_season && r.played > 0).sort((x, y) => y.played - x.played)[0] ?? null;
    if (!cur) return { row: null, peers: [] as any[] };
    const peers = await selectAll<any>(db, 'pro_team_season_stats', 'played,w,d,l,gf,ga,clean_sheets,shots,shots_on,corners,yellow,red,possession', (q) => q.eq('league_id', cur.league_id).eq('season', cur.season).gte('played', 3));
    return { row: cur, peers };
  };
  const [ma, mb, elo, h2h] = await Promise.all([main(ta), main(tb), selectAll<any>(db, 'pro_elo', 'team_id,rating,rank,games', (q) => q.in('team_id', [ta.id, tb.id])), teamH2H(db, aSlug, bSlug).catch(() => null)]);
  const rows: CompareRow[] = PRO.map((m) => {
    const va = ma.row ? m.get(ma.row) : null, vb = mb.row ? m.get(mb.row) : null;
    return { key: m.key, label: m.label, better: m.better, d: m.d, a: va, b: vb, pa: percentile(va, ma.peers.map(m.get).filter((x): x is number => x != null), m.better), pb: percentile(vb, mb.peers.map(m.get).filter((x): x is number => x != null), m.better) };
  }).filter((r) => r.a != null || r.b != null);
  const side = (t: any, m: { row: any }) => ({
    team: { id: t.id, name: t.name, slug: t.slug, logo: t.logo ?? null, national: !!t.national },
    competition: m.row ? { name: m.row.pro_leagues.name, slug: m.row.pro_leagues.slug, season: m.row.season, logo: m.row.pro_leagues.logo ?? null } : null,
    record: m.row ? { w: m.row.w, d: m.row.d, l: m.row.l, played: m.row.played } : null,
    elo: (() => { const e = elo.find((x) => x.team_id === t.id); return e && e.games >= 10 ? { rating: Math.round(Number(e.rating)), rank: e.rank } : null; })(),
  });
  return { a: side(ta, ma), b: side(tb, mb), rows, meetings: h2h ? { record: h2h.record, matches: h2h.matches.slice(0, 5) } : null };
}
