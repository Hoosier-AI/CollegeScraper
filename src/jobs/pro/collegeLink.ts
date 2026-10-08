// pro-college-link: which pro players played NCAA soccer. Spends no API-Football requests: Wikidata (CC0) for the
// documented careers, and our own college rosters for recent players who went straight from them to a pro club.
// Links that a person verified or rejected (pro_college_links.verified / rejected) are never overwritten.
import { registerJob, type JobContext } from '../runner.js';
import { selectAll, upsertChunked } from '../../db/client.js';
import { loadConfig } from '../../config.js';
import { chunk } from './shared.js';
import { matchNameAge, matchWikidata, parseWikidata, schoolIndex, WIKIDATA_QUERY, type CollegeLite, type LinkProposal, type ProNameLite, type SchoolLite } from './collegeMatch.js';
import { log } from '../../log.js';

const WDQS = 'https://query.wikidata.org/sparql';

async function wikidataRows(userAgent: string, contact: string): Promise<ReturnType<typeof parseWikidata>> {
  const res = await fetch(`${WDQS}?format=json&query=${encodeURIComponent(WIKIDATA_QUERY)}`, {
    headers: { accept: 'application/sparql-results+json', 'user-agent': `PlaibookStats/1.0 (https://www.plaibook.live; ${contact}) ${userAgent.split(' ').pop()}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  return parseWikidata(await res.json() as Parameters<typeof parseWikidata>[0]);
}

export async function proCollegeLink(ctx: JobContext): Promise<void> {
  const cfg = loadConfig();
  const db = ctx.db;
  const schools = await selectAll<SchoolLite>(db, 'college_schools', 'seo,name,long_name');
  const index = schoolIndex(schools);
  const proposals: LinkProposal[] = [];

  // 1. Wikidata.
  try {
    const rows = await wikidataRows(cfg.userAgent, cfg.contactEmail);
    ctx.inc('wikidata_rows', rows.length);
    const pros = await selectAll<{ id: number; last_name: string | null; birth_date: string | null; gender: 'm' | 'w' | null }>(db, 'pro_players', 'id,last_name,birth_date,gender', (q) => q.not('birth_date', 'is', null));
    const found = matchWikidata(rows, pros, index);
    ctx.inc('wikidata_matches', found.length);
    proposals.push(...found);
    for (const f of found) await db.from('pro_players').update({ wikidata_qid: String(f.evidence.qid) }).eq('id', f.pro_player_id);
  } catch (err) {
    ctx.note('wikidata_error', err instanceof Error ? err.message : String(err));
    log.warn({ err: String(err) }, 'wikidata college query failed');
  }

  // 2. Name and age against our own college rosters.
  const collegePlayers = await selectAll<{ id: string; name_key: string }>(db, 'college_players', 'id,name_key', (q) => q.eq('suppress', false));
  const collegeKeys = new Set(collegePlayers.map((c) => c.name_key));
  const pros = (await selectAll<{ id: number; name_key: string | null; birth_date: string | null; gender: 'm' | 'w' | null }>(db, 'pro_players', 'id,name_key,birth_date,gender', (q) => q.not('name_key', 'is', null)))
    .filter((p) => p.name_key && collegeKeys.has(p.name_key));
  ctx.inc('name_candidates', pros.length);
  if (pros.length) {
    const firstSeason = new Map<number, number>();
    for (const ids of chunk(pros.map((p) => p.id), 300)) {
      const rows = await selectAll<{ player_id: number; season: number }>(db, 'pro_player_season_stats', 'player_id,season', (q) => q.in('player_id', ids));
      for (const r of rows) firstSeason.set(r.player_id, Math.min(firstSeason.get(r.player_id) ?? 9999, r.season));
    }
    const keys = new Set(pros.map((p) => p.name_key!));
    const matching = collegePlayers.filter((c) => keys.has(c.name_key));
    const programs = new Map((await selectAll<{ id: string; gender: 'm' | 'w'; school_seo: string }>(db, 'college_programs', 'id,gender,school_seo')).map((p) => [p.id, p]));
    const schoolName = new Map(schools.map((s) => [s.seo, s.long_name ?? s.name]));
    const seasons = new Map<string, { seasons: number[]; program: string }>();
    for (const ids of chunk(matching.map((c) => c.id), 150)) {
      const rows = await selectAll<{ player_id: string; season: number; program_id: string }>(db, 'college_player_seasons', 'player_id,season,program_id', (q) => q.in('player_id', ids));
      for (const r of rows) { const s = seasons.get(r.player_id) ?? { seasons: [], program: r.program_id }; s.seasons.push(r.season); if (r.season >= Math.max(...s.seasons)) s.program = r.program_id; seasons.set(r.player_id, s); }
    }
    const college: CollegeLite[] = matching.flatMap((c) => {
      const s = seasons.get(c.id); const prog = s ? programs.get(s.program) : null;
      return s && prog ? [{ player_id: c.id, name_key: c.name_key, gender: prog.gender, seasons: s.seasons, school_seo: prog.school_seo, school_name: schoolName.get(prog.school_seo) ?? prog.school_seo }] : [];
    });
    const lite: ProNameLite[] = pros.map((p) => ({ ...p, first_season: firstSeason.get(p.id) ?? null }));
    const found = matchNameAge(lite, college);
    ctx.inc('name_age_matches', found.length);
    proposals.push(...found);
  }

  // 3. Store, leaving reviewed links alone. The same college from both methods: Wikidata's dates, our player id.
  const existing = await selectAll<{ pro_player_id: number; college_name: string; verified: boolean; rejected: boolean; method: string }>(db, 'pro_college_links', 'pro_player_id,college_name,verified,rejected,method');
  const frozen = new Set(existing.filter((e) => e.verified || e.rejected || e.method === 'manual').map((e) => `${e.pro_player_id}|${e.college_name}`));
  const merged = new Map<string, LinkProposal>();
  for (const p of proposals) {
    const k = `${p.pro_player_id}|${p.school_seo ?? p.college_name}`;
    const prev = merged.get(k);
    if (!prev) { merged.set(k, p); continue; }
    merged.set(k, { ...(prev.confidence >= p.confidence ? prev : p), college_player_id: prev.college_player_id ?? p.college_player_id, first_season: prev.first_season ?? p.first_season, last_season: prev.last_season ?? p.last_season, confidence: Math.max(prev.confidence, p.confidence) });
  }
  // One row per (player, college name) in a batch, or the upsert would touch the same row twice.
  const byDbKey = new Map<string, LinkProposal>();
  for (const p of merged.values()) { const k = `${p.pro_player_id}|${p.college_name}`; if (!frozen.has(k) && (byDbKey.get(k)?.confidence ?? -1) < p.confidence) byDbKey.set(k, p); }
  const rows = [...byDbKey.values()].map((p) => ({ ...p, updated_at: new Date().toISOString() }));
  ctx.inc('links_written', await upsertChunked(db, 'pro_college_links', rows, { onConflict: 'pro_player_id,college_name' }));
  ctx.inc('links_shown', rows.filter((r) => r.confidence >= 0.85).length);
}

registerJob('pro-college-link', proCollegeLink);
