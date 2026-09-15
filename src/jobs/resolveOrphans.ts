// Re-run opponent resolution over games that still have a null side (created from a school schedule before
// the alias rules could match the opponent). Resolved orphans are merged into the canonical fixture when one
// exists (their site box-score rows move over), otherwise the missing side is filled in. Scheduled placeholder
// rows ("TBD", "Semifinals") are deleted.  params: { season? }
import { registerJob, type JobContext } from './runner.js';
import { listPrograms, listSchools, listProgramSeasons, listGames, updateGame, upsertSchools, upsertProgram, upsertProgramSeasons, type GameRow } from '../db/repos.js';
import { setMembership, setKnownConferences, buildAliasIndex, resolveName, isPlaceholderOpponent, isExhibitionName, isCleanOpponentName, opponentSeo, cleanOpponentName } from '../normalize/aliasIndex.js';
import { listConferences } from '../db/standingsRepo.js';
import { findGame } from '../identity/gameMatch.js';
import { teamKey as teamKeyOf } from '../normalize/teamIdentity.js';
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
  setMembership(new Map(seasons.map((x) => [x.program_id, (x as { ncaa_member?: boolean }).ncaa_member !== false])));
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
      // Scheduled placeholders and exhibitions (even played ones) are not counted games.
      if (g.status !== 'final' || isExhibitionName(name ?? '')) { await db.from('college_games').delete().eq('id', g.id); ctx.inc(g.status === 'final' ? 'exhibitions_deleted' : 'orphans_deleted'); }
      else { ctx.inc('orphans_left_placeholder'); left.push(`${g.game_date} ${name ?? '?'} (final)`); }
      continue;
    }
    let oppId = ownId ? resolveName(index, { gender: g.gender, ownDivision: divisionOf.get(ownId) ?? null, ownConference: conferenceOf.get(ownId) ?? null, divisionOf, conferenceOf }, name) : null;
    // A played game against a team NCAA.com does not index (NAIA, junior college, new members) still counts in the
    // official record: give the opponent a non-member program so both sides exist.
    if (!oppId && ownId && g.status === 'final' && g.home_score != null && isCleanOpponentName(name)) {
      const other = g.gender === 'm' ? 'w' : 'm';
      const otherHit = resolveName(index, { gender: other, ownDivision: null, ownConference: null, divisionOf, conferenceOf }, name);
      if (!otherHit) {
        const seo = opponentSeo(name);
        const display = cleanOpponentName(name);
        await upsertSchools(db, [{ seo, name: display }]);
        const prog = await upsertProgram(db, { school_seo: seo, gender: g.gender, name: display, short_name: display });
        await upsertProgramSeasons(db, [{ program_id: prog.id, season, division: (divisionOf.get(ownId) ?? 'd3') as 'd1' | 'd2' | 'd3', conference_id: null, ncaa_member: false, member_source: 'opponent' } as any]);
        divisionOf.set(prog.id, divisionOf.get(ownId) ?? 'd3');
        const m = index.get(g.gender) ?? new Map<string, string[]>();
        for (const k of [teamKeyOf(display)]) m.set(k, [prog.id]);
        index.set(g.gender, m);
        oppId = prog.id;
        ctx.inc('opponents_created');
      }
    }
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

  // Same program, same date, two final rows, exactly one linked to an NCAA contest: the other is a duplicate made from
  // a schedule line whose opponent resolved wrongly or not at all. Merged when the result agrees (or is missing).
  const fresh = await listGames(db, season);
  const byProgDate = new Map<string, GameRow[]>();
  for (const x of fresh) if (x.status === 'final') for (const pid of [x.home_program_id, x.away_program_id]) if (pid) { const k = `${pid}|${x.game_date}`; byProgDate.set(k, [...(byProgDate.get(k) ?? []), x]); }
  const removed = new Set<string>();
  for (const [k, list] of byProgDate) {
    const live = list.filter((x) => !removed.has(x.id));
    const linked = live.filter((x) => x.ncaa_contest_id);
    if (live.length < 2 || linked.length !== 1) continue;
    const canon = linked[0]!; const pid = k.slice(0, k.indexOf('|'));
    const ours = (x: GameRow) => (x.home_program_id === pid ? [x.home_score, x.away_score] : [x.away_score, x.home_score]);
    const [cf, ca] = ours(canon);
    for (const dup of live.filter((x) => x !== canon && !x.ncaa_contest_id)) {
      const [df, da] = ours(dup);
      // Same result, or the same two scores reversed (a schedule that printed the winner's score first).
      if (df != null && cf != null && !((df === cf && da === ca) || (df === ca && da === cf))) continue;
      // The duplicate's lines may be attributed to a wrong opponent: never moved. The canonical keeps its refs and
      // is marked for a fresh site fetch when it has no site data yet.
      const patch: Record<string, unknown> = { site_game_refs: { ...(canon.site_game_refs ?? {}), ...(dup.site_game_refs ?? {}) } };
      if (!canon.site_fetched_at) patch.site_fetched_at = null;
      await updateGame(db, canon.id, patch);
      await db.from('college_games').delete().eq('id', dup.id);
      removed.add(dup.id);
      ctx.inc('same_day_duplicates_merged');
    }
  }

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
