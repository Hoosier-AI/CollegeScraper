// Choose source_of_truth per final game: 'site' when the school box score validated, else 'ncaa'.
import { registerJob, type JobContext } from './runner.js';
import { selectAll, kvSet } from '../db/client.js';
import { updateGame, listProgramSeasons } from '../db/repos.js';
import { currentSeason } from './seasons.js';

interface G { id: string; status: string; home_program_id: string | null; away_program_id: string | null; home_score: number | null; away_score: number | null; ncaa_contest_id?: number | null; source_of_truth: string | null; site_fetched_at: string | null; ncaa_fetched_at: string | null; conference_game: boolean; postseason: boolean; tournament: string | null }
interface TS { game_id: string; program_id: string; source: string; is_home: boolean; goals: number | null; shots: number | null; yellow_cards: number | null }
interface PS { game_id: string; program_id: string; source: string; goals: number | null; participated: boolean }

/** params: { season?, all?, program? (seo) } — by default only games without a truth source or touched in the last 3 days. */
export async function reconcileGames(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  let programIds: string[] | null = null;
  if (typeof ctx.params.program === 'string') { const { data } = await db.from('college_programs').select('id').eq('school_seo', ctx.params.program); programIds = (data ?? []).map((r: any) => r.id); }
  // Preseason exhibitions: NCAA.com's scoreboard lists every counted contest. A game not linked to one and dated before
  // the first linked contest of its gender and division is an exhibition, whatever the school schedule calls it.
  const openRows = await selectAll<{ id: string; gender: string; division: string | null; game_date: string; ncaa_contest_id: number | null }>(db, 'college_games', 'id,gender,division,game_date,ncaa_contest_id', (q) => q.eq('season', season));
  const opener = new Map<string, string>();
  for (const g of openRows) if (g.ncaa_contest_id && g.division) { const k = `${g.gender}_${g.division}`; if (!opener.has(k) || g.game_date < opener.get(k)!) opener.set(k, g.game_date); }
  for (const [k, d] of [...opener]) if (d > `${season}-09-01`) opener.delete(k); // a sweep that never covered August proves nothing
  // In season, NCAA.com's D1 scoreboard lists every counted game involving a D1 program (including games against NAIA
  // or junior-college teams). A D1 program's final that is not linked to a contest, on a date the scoreboard has
  // contests for that gender, is not in the official record (an exhibition, a scrimmage or a duplicate).
  const d1Seasons = await listProgramSeasons(db, season);
  const d1Member = new Set(d1Seasons.filter((x) => x.division === 'd1' && (x as { ncaa_member?: boolean }).ncaa_member !== false).map((x) => x.program_id));
  const covered = new Set(openRows.filter((g) => g.ncaa_contest_id && g.division === 'd1').map((g) => `${g.gender}|${g.game_date}`));
  const finalsUnlinked = await selectAll<{ id: string; gender: string; game_date: string; home_program_id: string | null; away_program_id: string | null }>(db, 'college_games', 'id,gender,game_date,home_program_id,away_program_id',
    (q) => q.eq('season', season).eq('status', 'final').is('ncaa_contest_id', null));
  // Games against a team outside NCAA membership (NAIA, junior colleges) are counted in official records even when
  // NCAA.com's scoreboard does not list them, so only D1-vs-D1 finals are removed this way.
  const bothD1 = (g: { home_program_id: string | null; away_program_id: string | null }) => !!g.home_program_id && !!g.away_program_id && d1Member.has(g.home_program_id) && d1Member.has(g.away_program_id);
  const uncounted = finalsUnlinked.filter((g) => covered.has(`${g.gender}|${g.game_date}`) && bothD1(g) && g.game_date < new Date(Date.now() - 86400_000).toISOString().slice(0, 10));
  for (let i = 0; i < uncounted.length; i += 100) await db.from('college_games').delete().in('id', uncounted.slice(i, i + 100).map((g) => g.id));
  ctx.inc('d1_unlinked_finals_deleted', uncounted.length);
  if (opener.size) {
    await kvSet(db, `season_open:${season}`, Object.fromEntries(opener));
    const pre = openRows.filter((g) => !g.ncaa_contest_id && g.division && opener.has(`${g.gender}_${g.division}`) && g.game_date < opener.get(`${g.gender}_${g.division}`)!);
    for (let i = 0; i < pre.length; i += 100) await db.from('college_games').delete().in('id', pre.slice(i, i + 100).map((g) => g.id));
    ctx.inc('preseason_exhibitions_deleted', pre.length);
  }
  let games = await selectAll<G>(db, 'college_games', 'id,status,home_program_id,away_program_id,home_score,away_score,source_of_truth,site_fetched_at,ncaa_fetched_at,conference_game,postseason,tournament,ncaa_contest_id',
    (q) => { q = q.eq('season', season).eq('status', 'final'); return ctx.params.all ? q : q.or(`source_of_truth.is.null,site_fetched_at.gte.${new Date(Date.now() - 3 * 86400000).toISOString()},ncaa_fetched_at.gte.${new Date(Date.now() - 3 * 86400000).toISOString()}`); });
  if (programIds) games = games.filter((g) => (g.home_program_id && programIds!.includes(g.home_program_id)) || (g.away_program_id && programIds!.includes(g.away_program_id)));
  const ids = games.map((g) => g.id);
  const team: TS[] = []; const players: PS[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    team.push(...await selectAll<TS>(db, 'college_game_team_stats', 'game_id,program_id,source,is_home,goals,shots,yellow_cards', (q) => q.in('game_id', chunk)));
    players.push(...await selectAll<PS>(db, 'college_game_player_stats', 'game_id,program_id,source,goals,participated', (q) => q.in('game_id', chunk)));
  }
  // Invariant: a team-stat row's is_home matches the game's home program (rows moved between fixtures of
  // opposite orientation would otherwise swap GF/GA in the aggregates).
  const homeOf = new Map(games.map((g) => [g.id, g.home_program_id]));
  for (const t of team) {
    const want = t.program_id === homeOf.get(t.game_id);
    if (homeOf.get(t.game_id) && t.is_home !== want) {
      await db.from('college_game_team_stats').update({ is_home: want }).eq('game_id', t.game_id).eq('program_id', t.program_id).eq('source', t.source);
      t.is_home = want; ctx.inc('is_home_repaired');
    }
  }
  const byGame = new Map<string, { site: TS[]; ncaa: TS[] }>();
  for (const t of team) { const e = byGame.get(t.game_id) ?? { site: [], ncaa: [] }; (t.source === 'site' ? e.site : e.ncaa).push(t); byGame.set(t.game_id, e); }
  // A school's box score paired positionally with an NCAA-linked fixture put each side's stats on the other program
  // (the school listed itself first). The game's score is NCAA.com's; when the site rows fit it only the other way
  // round, move the site rows (team, player lines, event sides) across.
  for (const g of games) {
    if (!g.ncaa_contest_id || g.home_score == null || g.away_score == null || g.home_score === g.away_score || !g.home_program_id || !g.away_program_id) continue;
    const e = byGame.get(g.id); if (!e || e.site.length !== 2) continue;
    const sh = e.site.find((t) => t.program_id === g.home_program_id), sa = e.site.find((t) => t.program_id === g.away_program_id);
    if (!sh || !sa || sh.goals == null || sa.goals == null) continue;
    if (sh.goals === g.home_score && sa.goals === g.away_score) continue;
    if (sh.goals !== g.away_score || sa.goals !== g.home_score) continue;
    // Swap via a placeholder so the (game_id, program_id, source) key never collides mid-way.
    const tmp = '00000000-0000-0000-0000-000000000000';
    for (const table of ['college_game_team_stats', 'college_game_player_stats', 'college_game_events'] as const) {
      await db.from(table).update({ program_id: tmp }).eq('game_id', g.id).eq('source', 'site').eq('program_id', g.home_program_id);
      await db.from(table).update({ program_id: g.home_program_id }).eq('game_id', g.id).eq('source', 'site').eq('program_id', g.away_program_id);
      await db.from(table).update({ program_id: g.away_program_id }).eq('game_id', g.id).eq('source', 'site').eq('program_id', tmp);
    }
    await db.from('college_game_team_stats').update({ is_home: true }).eq('game_id', g.id).eq('source', 'site').eq('program_id', g.home_program_id);
    await db.from('college_game_team_stats').update({ is_home: false }).eq('game_id', g.id).eq('source', 'site').eq('program_id', g.away_program_id);
    // Running scores inside the events are printed home-first by the box; swap them the same way.
    const ev = await selectAll<{ id: number; home_score: number | null; away_score: number | null }>(db, 'college_game_events', 'id,home_score,away_score', (q) => q.eq('game_id', g.id).eq('source', 'site').not('home_score', 'is', null));
    for (const x of ev) await db.from('college_game_events').update({ home_score: x.away_score, away_score: x.home_score }).eq('id', x.id);
    [sh.program_id, sa.program_id] = [sa.program_id, sh.program_id]; sh.is_home = false; sa.is_home = true;
    ctx.inc('site_box_sides_swapped');
  }
  const goalsBy = new Map<string, number>();
  for (const p of players) { const k = `${p.game_id}|${p.program_id}|${p.source}`; goalsBy.set(k, (goalsBy.get(k) ?? 0) + (p.goals ?? 0)); }

  // Non-member opponents (NAIA, junior colleges) rarely have their own box score line: only NCAA members must.
  const seasonRows = await listProgramSeasons(db, season);
  const memberOf = new Map(seasonRows.map((s) => [s.program_id, (s as { ncaa_member?: boolean }).ncaa_member !== false]));
  const valid = (g: G, rows: TS[], source: string) => {
    if (!g.home_program_id || !g.away_program_id || !rows.length) return false;
    const need = [g.home_program_id, g.away_program_id].filter((id) => memberOf.get(id) !== false);
    if (!need.every((id) => rows.some((r) => r.program_id === id))) return false;
    for (const r of rows) {
      const score = r.is_home ? g.home_score : g.away_score;
      if (score == null || r.goals !== score) return false;
      const pg = goalsBy.get(`${g.id}|${r.program_id}|${source}`);
      if (pg != null && pg !== score) return false;
    }
    return true;
  };

  // Conference flag: school schedules mark many non-conference games as "conference" (their descriptor cell also
  // carries TV/network text), so the flag is derived from membership instead: both sides in the same conference
  // for this season and not a postseason/tournament game. Applied to every game of the season (standings need
  // the scheduled ones too); the official conference tables verify the result.
  const conferenceOf = new Map((await listProgramSeasons(db, season)).map((s) => [s.program_id, s.conference_id as string | null]));
  const allGames = await selectAll<{ id: string; game_date: string; status: string; home_program_id: string | null; away_program_id: string | null; conference_game: boolean; postseason: boolean; tournament: string | null }>(db, 'college_games', 'id,game_date,status,home_program_id,away_program_id,conference_game,postseason,tournament', (q) => q.eq('season', season));
  for (const g of allGames) {
    if (!g.home_program_id || !g.away_program_id) continue;
    if (programIds && !programIds.includes(g.home_program_id) && !programIds.includes(g.away_program_id)) continue;
    const hc = conferenceOf.get(g.home_program_id), ac = conferenceOf.get(g.away_program_id);
    const want = !!hc && hc === ac && !g.postseason && !g.tournament;
    if (want !== g.conference_game) { await updateGame(db, g.id, { conference_game: want }); ctx.inc(want ? 'conference_flag_set' : 'conference_flag_cleared'); }
  }
  // Conference mates sometimes meet before conference play (a non-conference game). Where the conference publishes an
  // official table, a team with more flagged conference games than its official conference games played has its
  // earliest excess same-conference games unflagged, provided they precede its last non-conference game (a table that
  // merely lags behind the latest conference game never unflags a real one) and the opponent agrees.
  const official = await selectAll<{ program_id: string; conf_w: number | null; conf_l: number | null; conf_t: number | null }>(db, 'college_standings', 'program_id,conf_w,conf_l,conf_t', (q) => q.eq('season', season).eq('source', 'conference'));
  if (official.length) {
    const offGp = new Map(official.filter((o) => o.conf_w != null).map((o) => [o.program_id, (o.conf_w ?? 0) + (o.conf_l ?? 0) + (o.conf_t ?? 0)]));
    const finalsBoth = allGames.filter((g) => g.status === 'final' && g.home_program_id && g.away_program_id);
    const lastNonConf = new Map<string, string>();
    const flagged = new Map<string, typeof finalsBoth>();
    for (const g of finalsBoth) for (const pid of [g.home_program_id!, g.away_program_id!]) {
      if (g.conference_game) flagged.set(pid, [...(flagged.get(pid) ?? []), g]);
      else if ((lastNonConf.get(pid) ?? '') < g.game_date) lastNonConf.set(pid, g.game_date);
    }
    const excess = new Map<string, Set<string>>();
    for (const [pid, list] of flagged) {
      const off = offGp.get(pid);
      if (off == null || list.length <= off) continue;
      list.sort((a, b) => a.game_date.localeCompare(b.game_date));
      const last = lastNonConf.get(pid) ?? '';
      excess.set(pid, new Set(list.slice(0, list.length - off).filter((g) => g.game_date < last).map((g) => g.id)));
    }
    for (const g of finalsBoth) {
      if (!g.conference_game) continue;
      const h = excess.get(g.home_program_id!), a = excess.get(g.away_program_id!);
      const hOk = h ? h.has(g.id) : !offGp.has(g.home_program_id!);
      const aOk = a ? a.has(g.id) : !offGp.has(g.away_program_id!);
      if ((h?.has(g.id) || a?.has(g.id)) && hOk && aOk) {
        await updateGame(db, g.id, { conference_game: false }); g.conference_game = false; ctx.inc('conference_flag_preseason_meeting');
      }
    }
  }
  for (const g of games) {
    const e = byGame.get(g.id) ?? { site: [], ncaa: [] };
    let truth: 'site' | 'ncaa' | null = null;
    if (valid(g, e.site, 'site')) truth = 'site';
    else if (valid(g, e.ncaa, 'ncaa')) truth = 'ncaa';
    else if (e.site.length === 2) truth = 'site';
    else if (e.ncaa.length === 2) truth = 'ncaa';
    if (e.site.length === 2 && e.ncaa.length === 2) {
      const differs = e.site.some((s) => { const n = e.ncaa.find((x) => x.program_id === s.program_id); return n && (n.goals !== s.goals || n.yellow_cards !== s.yellow_cards); });
      if (differs) ctx.inc('site_ncaa_disagreements');
    }
    if (truth !== g.source_of_truth) { await updateGame(db, g.id, { source_of_truth: truth }); ctx.inc(`truth_${truth ?? 'none'}`); }
    else ctx.inc('unchanged');
    if (!truth) ctx.inc('no_truth_source');
  }
  ctx.inc('games_checked', games.length);
}

registerJob('reconcile-games', reconcileGames);
