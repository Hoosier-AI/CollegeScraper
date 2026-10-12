// pro-college-link: which pro players played NCAA soccer. Spends no API-Football requests: Wikidata (CC0) for the
// documented careers, and our own college rosters for recent players who went straight from them to a pro club.
// Links that a person verified or rejected (pro_college_links.verified / rejected) are never overwritten.
import { registerJob, type JobContext } from '../runner.js';
import { selectAll, upsertChunked } from '../../db/client.js';
import { loadConfig } from '../../config.js';
import { chunk } from './shared.js';
import { matchNameAge, matchWikidata, matchWikipediaSpells, parseWikidata, schoolIndex, withLabels, WIKIDATA_QUERY, type CollegeLite, type LinkProposal, type ProNameLite, type SchoolLite } from './collegeMatch.js';
import { leagueIndex } from '../../db/proRepo.js';
import { isUsScene } from '../../sources/apiFootball/leagues.js';
import { log } from '../../log.js';

const WDQS = 'https://query.wikidata.org/sparql';
const WD_API = 'https://www.wikidata.org/w/api.php';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function wikidataRows(ua: string): Promise<ReturnType<typeof parseWikidata>> {
  const res = await fetch(`${WDQS}?format=json&query=${encodeURIComponent(WIKIDATA_QUERY)}`, {
    headers: { accept: 'application/sparql-results+json', 'user-agent': ua },
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  return parseWikidata(await res.json() as Parameters<typeof parseWikidata>[0]);
}

/** English labels for QIDs, 50 per request (the API's limit), one request a second. */
async function wikidataLabels(ids: string[], ua: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const batch of chunk([...new Set(ids)], 50)) {
    const res = await fetch(`${WD_API}?action=wbgetentities&format=json&props=labels&languages=en&ids=${batch.join('|')}`, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Wikidata labels HTTP ${res.status}`);
    const body = await res.json() as { entities?: Record<string, { labels?: { en?: { value: string } } }> };
    for (const [id, e] of Object.entries(body.entities ?? {})) { const v = e.labels?.en?.value; if (v) out.set(id, v); }
    await sleep(1000);
  }
  return out;
}

export async function proCollegeLink(ctx: JobContext): Promise<void> {
  const cfg = loadConfig();
  const db = ctx.db;
  const schools = await selectAll<SchoolLite>(db, 'college_schools', 'seo,name,long_name');
  const index = schoolIndex(schools);
  const proposals: LinkProposal[] = [];

  // 1. Wikidata: the footballers educated in the US, then names only for those born on a day one of ours was.
  try {
    const ua = `PlaibookStats/1.0 (https://www.plaibook.live; ${cfg.contactEmail})`;
    const raw = await wikidataRows(ua);
    ctx.inc('wikidata_rows', raw.length);
    const pros = await selectAll<{ id: number; last_name: string | null; birth_date: string | null; gender: 'm' | 'w' | null }>(db, 'pro_players', 'id,last_name,birth_date,gender', (q) => q.not('birth_date', 'is', null));
    const dobs = new Set(pros.map((p) => p.birth_date!.slice(0, 10)));
    const near = raw.filter((r) => r.dob && dobs.has(r.dob));
    ctx.inc('wikidata_dob_matches', near.length);
    const labels = near.length ? await wikidataLabels(near.flatMap((r) => [r.qid, r.collegeQid]), ua) : new Map<string, string>();
    const found = matchWikidata(withLabels(near, labels), pros, index);
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
    // The first season in a professional competition: college players turn out for amateur summer sides (USL League
    // Two, NPSL, WPSL, the W League) while still in college, which made their "first pro season" come before their
    // last college one. And whether they have played in a US competition (where college players go).
    const leagues = await leagueIndex(db);
    const firstSeason = new Map<number, number>();
    const inUs = new Set<number>();
    for (const ids of chunk(pros.map((p) => p.id), 300)) {
      const rows = await selectAll<{ player_id: number; season: number; league_id: number }>(db, 'pro_player_season_stats', 'player_id,season,league_id', (q) => q.in('player_id', ids));
      for (const r of rows) {
        const l = leagues.get(r.league_id);
        if (l && isUsScene(l.id, l.country)) inUs.add(r.player_id);
        // Professional leagues only: cups take amateur clubs (the US Open Cup) and national teams (youth World Cups).
        if (l && (l.kind !== 'pro' || l.type !== 'league')) continue;
        firstSeason.set(r.player_id, Math.min(firstSeason.get(r.player_id) ?? 9999, r.season));
      }
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
    const lite: ProNameLite[] = pros.map((p) => ({ ...p, first_season: firstSeason.get(p.id) ?? null, us: inUs.has(p.id) }));
    // Two pro players with the same name and gender (two Ahmed Ibrahims): which one went to college is a guess, so
    // the link waits for review instead of showing.
    const sameName = new Map<string, number>();
    for (const p of pros) if (p.gender) { const k = `${p.name_key}|${p.gender}`; sameName.set(k, (sameName.get(k) ?? 0) + 1); }
    const found = matchNameAge(lite, college).map((f) => {
      const p = pros.find((x) => x.id === f.pro_player_id);
      return p && (sameName.get(`${p.name_key}|${p.gender}`) ?? 0) > 1 ? { ...f, confidence: Math.min(f.confidence, 0.5), evidence: { ...f.evidence, pro_namesakes: sameName.get(`${p.name_key}|${p.gender}`) } } : f;
    });
    ctx.inc('name_age_matches', found.length);
    proposals.push(...found);
  }

  // 3. Wikipedia: the "College career" rows of the articles of players we matched through Wikidata.
  try {
    const spells = await selectAll<{ qid: string; team: string; start_year: number | null; end_year: number | null }>(db, 'pro_src_spells', 'qid,team,start_year,end_year', (q) => q.eq('kind', 'college'));
    const ids = await selectAll<{ ext_id: string; pro_id: number }>(db, 'pro_source_ids', 'ext_id,pro_id', (q) => q.eq('source', 'wikidata').eq('kind', 'player').not('pro_id', 'is', null).in('ext_id', [...new Set(spells.map((s) => s.qid))].concat(['-'])));
    const proOf = new Map(ids.map((r) => [r.ext_id, Number(r.pro_id)]));
    const found = matchWikipediaSpells(spells.flatMap((s) => (proOf.has(s.qid) ? [{ ...s, pro_player_id: proOf.get(s.qid)! }] : [])), index);
    ctx.inc('wikipedia_matches', found.length);
    proposals.push(...found);
  } catch (err) { ctx.note('wikipedia_error', err instanceof Error ? err.message : String(err)); }

  // 4. Store, leaving reviewed links alone. The same college from both methods: Wikidata's dates, our player id.
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
