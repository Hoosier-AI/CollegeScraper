// Derive college_transfers: a player_season whose player has a season at a different program earlier.
import type { JobContext } from './runner.js';
import { selectAll, upsertChunked } from '../db/client.js';
import { findTransfer } from '../identity/resolver.js';
import { splitName } from '../normalize/names.js';

interface PsRow { id: string; player_id: string; program_id: string; season: number; previous_school: string | null; hometown_raw: string | null; high_school: string | null; source: string; college_players: { first_name: string; last_name: string; name_key: string } }

/**
 * Two passes:
 *  A. Same identity at two programs (resolver already linked them via a transfer rule) → transfer row.
 *  B. New identities with a previous_school hint → look for a same-name player at that school in season-1/-2, link and record.
 */
export async function deriveTransfers(ctx: JobContext, season: number): Promise<number> {
  const db = ctx.db;
  const cur = await selectAll<PsRow>(db, 'college_player_seasons', 'id,player_id,program_id,season,previous_school,hometown_raw,high_school,source,college_players!inner(first_name,last_name,name_key)', (q) => q.eq('season', season));
  const rows: Record<string, unknown>[] = [];
  // Pass A: player has an earlier season at another program.
  const playerIds = [...new Set(cur.map((r) => r.player_id))];
  const prior = new Map<string, { program_id: string; season: number }[]>();
  for (let i = 0; i < playerIds.length; i += 100) {
    const chunk = playerIds.slice(i, i + 100);
    const rs = await selectAll<{ player_id: string; program_id: string; season: number }>(db, 'college_player_seasons', 'player_id,program_id,season', (q) => q.in('player_id', chunk).lt('season', season));
    for (const r of rs) { if (!prior.has(r.player_id)) prior.set(r.player_id, []); prior.get(r.player_id)!.push(r); }
  }
  for (const r of cur) {
    const p = (prior.get(r.player_id) ?? []).filter((x) => x.program_id !== r.program_id).sort((a, b) => b.season - a.season)[0];
    if (p) rows.push({ player_id: r.player_id, from_program_id: p.program_id, to_program_id: r.program_id, from_season: p.season, to_season: season, confidence: 0.95, evidence: { rule: 'linked_identity' } });
  }
  // Pass B: previous_school hints for players with no earlier seasons anywhere.
  const schools = await selectAll<{ seo: string; name: string; long_name: string | null }>(db, 'college_schools', 'seo,name,long_name');
  const programs = await selectAll<{ id: string; school_seo: string; gender: string; name: string }>(db, 'college_programs', 'id,school_seo,gender,name');
  const schoolNames = new Map(schools.map((s) => [s.seo, [s.name, s.long_name ?? ''].filter(Boolean)]));
  const hinted = cur.filter((r) => r.previous_school && !(prior.get(r.player_id) ?? []).length);
  for (const r of hinted) {
    const cands = await selectAll<PsRow>(db, 'college_player_seasons', 'id,player_id,program_id,season,previous_school,hometown_raw,high_school,source,college_players!inner(first_name,last_name,name_key)',
      (q) => q.eq('college_players.name_key', r.college_players.name_key).lt('season', season).gte('season', season - 2).neq('program_id', r.program_id));
    const gender = programs.find((p) => p.id === r.program_id)?.gender;
    const m = findTransfer({
      sourceKey: r.id, sitePlayerId: null, firstName: r.college_players.first_name, lastName: r.college_players.last_name, jersey: null, positionRaw: null, classRaw: null, heightRaw: null,
      weightLb: null, hometownRaw: r.hometown_raw, highSchool: r.high_school, previousSchool: r.previous_school, major: null, isCaptain: false, headshotUrl: null, bioUrl: null,
    }, season, cands.filter((c) => programs.find((p) => p.id === c.program_id)?.gender === gender).map((c) => ({
      playerId: c.player_id, programId: c.program_id, season: c.season, nameKey: c.college_players.name_key, hometownRaw: c.hometown_raw, highSchool: c.high_school,
      schoolNames: schoolNames.get(programs.find((p) => p.id === c.program_id)?.school_seo ?? '') ?? [],
    })));
    if (m && m.confidence >= 0.8) {
      // Merge identities: repoint this season's row to the earlier player id.
      const { error } = await db.from('college_player_seasons').update({ player_id: m.playerId, confidence: m.confidence }).eq('id', r.id);
      if (error) { ctx.inc('transfer_merge_failed'); continue; }
      await db.from('college_players').delete().eq('id', r.player_id).then(() => {});
      rows.push({ player_id: m.playerId, from_program_id: m.fromProgramId, to_program_id: r.program_id, from_season: m.fromSeason, to_season: season, confidence: m.confidence, evidence: m.evidence });
      ctx.inc('transfer_merges');
    } else if (m) {
      ctx.inc('transfer_candidates_low_confidence');
    }
  }
  void splitName;
  if (!rows.length) return 0;
  const dedup = new Map(rows.map((r) => [`${r.player_id}|${r.to_season}`, r]));
  return upsertChunked(db, 'college_transfers', [...dedup.values()], { onConflict: 'player_id,to_season' });
}
