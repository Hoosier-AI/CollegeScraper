// Re-run opponent resolution over games that still have a null side (created from a school schedule before
// the alias rules could match the opponent). Resolved orphans are merged into the canonical fixture when one
// exists (their site box-score rows move over), otherwise the missing side is filled in. Scheduled placeholder
// rows ("TBD", "Semifinals") are deleted.  params: { season? }
import { registerJob, type JobContext } from './runner.js';
import { listPrograms, listSchools, listProgramSeasons, listGames, updateGame } from '../db/repos.js';
import { setKnownConferences, buildAliasIndex, resolveName, isPlaceholderOpponent } from '../normalize/aliasIndex.js';
import { listConferences } from '../db/standingsRepo.js';
import { findGame } from '../identity/gameMatch.js';
import { selectAll } from '../db/client.js';
import { currentSeason } from './seasons.js';
import { log } from '../log.js';

export async function resolveOrphans(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const programs = await listPrograms(db);
  const schools = new Map((await listSchools(db)).map((s) => [s.seo, s]));
  const seasons = await listProgramSeasons(db, season);
  const divisionOf = new Map(seasons.map((s) => [s.program_id, s.division as string]));
  const conferenceOf = new Map(seasons.map((s) => [s.program_id, (s.conference_id as string | null) ?? null]));
  setKnownConferences((await listConferences(db)).map((c) => c.name));
  const index = buildAliasIndex(programs, schools);
  const games = await listGames(db, season);
  const orphans = games.filter((g) => !g.home_program_id || !g.away_program_id);
  ctx.inc('orphans', orphans.length);
  const left: string[] = [];
  const merged = new Set<string>();

  for (const g of orphans) {
    if (merged.has(g.id)) continue;
    if (await ctx.cancelled()) return;
    const ownId = g.home_program_id ?? g.away_program_id;
    const name = g.home_program_id ? g.away_name : g.home_name;
    if (!ownId && !name) { ctx.inc('orphans_left'); continue; }
    if (!name || isPlaceholderOpponent(name)) {
      if (g.status !== 'final') { await db.from('college_games').delete().eq('id', g.id); ctx.inc('orphans_deleted'); }
      else { ctx.inc('orphans_left_placeholder'); left.push(`${g.game_date} ${name ?? '?'} (final)`); }
      continue;
    }
    const oppId = ownId ? resolveName(index, { gender: g.gender, ownDivision: divisionOf.get(ownId) ?? null, ownConference: conferenceOf.get(ownId) ?? null, divisionOf, conferenceOf }, name) : null;
    if (!oppId || !ownId) { ctx.inc('orphans_left'); left.push(`${g.game_date} ${name}`); continue; }
    const homeId = g.home_program_id ?? oppId, awayId = g.away_program_id ?? oppId;
    const canonical = games.find((x) => x.id !== g.id && x.home_program_id && x.away_program_id && findGame([x], g.game_date, homeId, awayId) === x) ?? null;
    if (!canonical) {
      await updateGame(db, g.id, g.home_program_id ? { away_program_id: oppId } : { home_program_id: oppId });
      if (g.home_program_id) g.away_program_id = oppId; else g.home_program_id = oppId;
      ctx.inc('orphans_resolved');
      continue;
    }
    // Merge into the canonical fixture: move site rows when the canonical has none, then delete the orphan.
    // The canonical row may have home/away the other way round (created from the opponent's schedule or NCAA.com).
    const flipped = canonical.home_program_id !== homeId;
    if (!canonical.site_fetched_at && g.site_fetched_at) {
      if (flipped) {
        const ts = await selectAll<{ program_id: string; is_home: boolean }>(db, 'college_game_team_stats', 'program_id,is_home', (q) => q.eq('game_id', g.id).eq('source', 'site'));
        for (const r of ts) await db.from('college_game_team_stats').update({ is_home: !r.is_home }).eq('game_id', g.id).eq('source', 'site').eq('program_id', r.program_id);
        const ev = await selectAll<{ id: number; home_score: number | null; away_score: number | null }>(db, 'college_game_events', 'id,home_score,away_score', (q) => q.eq('game_id', g.id).eq('source', 'site'));
        for (const e of ev) await db.from('college_game_events').update({ home_score: e.away_score, away_score: e.home_score }).eq('id', e.id);
        ctx.inc('orphans_merged_flipped');
      }
      for (const t of ['college_game_team_stats', 'college_game_player_stats', 'college_game_events', 'college_game_raw']) {
        await db.from(t).delete().eq('game_id', canonical.id).eq('source', 'site');
        const { error } = await db.from(t).update({ game_id: canonical.id }).eq('game_id', g.id).eq('source', 'site');
        if (error) log.warn({ t, err: error.message }, 'orphan merge repoint failed');
      }
    }
    const patch: Record<string, unknown> = { site_game_refs: { ...(canonical.site_game_refs ?? {}), ...(g.site_game_refs ?? {}) } };
    if (!canonical.site_fetched_at && g.site_fetched_at) { patch.site_fetched_at = g.site_fetched_at; patch.source_of_truth = null; }
    if (canonical.home_score == null && g.home_score != null) { patch.home_score = flipped ? g.away_score : g.home_score; patch.away_score = flipped ? g.home_score : g.away_score; }
    await updateGame(db, canonical.id, patch);
    await db.from('college_games').delete().eq('id', g.id);
    merged.add(g.id);
    ctx.inc('orphans_merged');
  }
  if (left.length) ctx.note('orphans_left_sample', left.slice(0, 40));

  // Box-score-only identities that no longer have any game line (their lines were re-attributed after an
  // orientation fix or a merge) are removed, with their player row when no other season references it.
  const bo = await selectAll<{ id: string; player_id: string }>(db, 'college_player_seasons', 'id,player_id', (q) => q.eq('season', season).eq('source', 'boxscore_only'));
  const withLines = new Set<string>();
  for (let i = 0; i < bo.length; i += 100) {
    const ids = bo.slice(i, i + 100).map((r) => r.id);
    for (const r of await selectAll<{ player_season_id: string }>(db, 'college_game_player_stats', 'player_season_id', (q) => q.in('player_season_id', ids))) withLines.add(r.player_season_id);
  }
  const dead = bo.filter((r) => !withLines.has(r.id));
  for (let i = 0; i < dead.length; i += 100) {
    const chunk = dead.slice(i, i + 100);
    const { error } = await db.from('college_player_seasons').delete().in('id', chunk.map((r) => r.id));
    if (error) { log.warn({ err: error.message }, 'dead identity cleanup failed'); break; }
    const players = [...new Set(chunk.map((r) => r.player_id))];
    const still = new Set((await selectAll<{ player_id: string }>(db, 'college_player_seasons', 'player_id', (q) => q.in('player_id', players))).map((r) => r.player_id));
    const gone = players.filter((x) => !still.has(x));
    if (gone.length) await db.from('college_players').delete().in('id', gone);
  }
  ctx.inc('boxscore_only_removed', dead.length);
}

registerJob('resolve-orphans', resolveOrphans);
