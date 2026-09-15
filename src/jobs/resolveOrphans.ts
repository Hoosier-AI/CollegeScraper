// Re-run opponent resolution over games that still have a null side (created from a school schedule before
// the alias rules could match the opponent). Resolved orphans are merged into the canonical fixture when one
// exists (their site box-score rows move over), otherwise the missing side is filled in. Scheduled placeholder
// rows ("TBD", "Semifinals") are deleted.  params: { season? }
import { registerJob, type JobContext } from './runner.js';
import { listPrograms, listSchools, listProgramSeasons, listGames, updateGame } from '../db/repos.js';
import { setKnownConferences, buildAliasIndex, resolveName, isPlaceholderOpponent } from '../normalize/aliasIndex.js';
import { listConferences } from '../db/standingsRepo.js';
import { findGame } from '../identity/gameMatch.js';
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
    if (!canonical.site_fetched_at && g.site_fetched_at) {
      for (const t of ['college_game_team_stats', 'college_game_player_stats', 'college_game_events', 'college_game_raw']) {
        await db.from(t).delete().eq('game_id', canonical.id).eq('source', 'site');
        const { error } = await db.from(t).update({ game_id: canonical.id }).eq('game_id', g.id).eq('source', 'site');
        if (error) log.warn({ t, err: error.message }, 'orphan merge repoint failed');
      }
    }
    const patch: Record<string, unknown> = { site_game_refs: { ...(canonical.site_game_refs ?? {}), ...(g.site_game_refs ?? {}) } };
    if (!canonical.site_fetched_at && g.site_fetched_at) { patch.site_fetched_at = g.site_fetched_at; patch.source_of_truth = null; }
    if (canonical.home_score == null && g.home_score != null) { patch.home_score = g.home_score; patch.away_score = g.away_score; }
    await updateGame(db, canonical.id, patch);
    await db.from('college_games').delete().eq('id', g.id);
    merged.add(g.id);
    ctx.inc('orphans_merged');
  }
  if (left.length) ctx.note('orphans_left_sample', left.slice(0, 40));
}

registerJob('resolve-orphans', resolveOrphans);
