// NCAA.com scoreboard sweep → college_games rows (keyed by ncaa_contest_id) linked to programs by seo.
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { scoreboardDay } from '../sources/ncaa/index.js';
import { makeTransport } from './fetchGamesNcaa.js';
import { log } from '../log.js';
import { listPrograms, listGames, upsertGameByNcaa, updateGame, reorientGame, upsertSchools, upsertProgram, upsertProgramSeasons } from '../db/repos.js';
import { findGame } from '../identity/gameMatch.js';
import { currentSeason, eachDate } from './seasons.js';
import type { Division, Gender } from '../model.js';

/** params: { season?, gender?, division?, days?: 'all'|'recent', force? } */
export async function sweepScoreboard(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const fetcher = makeFetcher(db, { freshMs: ctx.params.force ? 0 : (ctx.params.days === 'recent' ? 0 : 7 * 86400_000) });
  const { store } = makeTransport(db, fetcher);
  await store.init();
  const genders: Gender[] = ctx.params.gender ? [ctx.params.gender as Gender] : ['m', 'w'];
  const divisions: Division[] = ctx.params.division ? [ctx.params.division as Division] : ['d1', 'd2', 'd3'];
  const programs = await listPrograms(db);
  const bySeo = new Map(programs.map((p) => [`${p.school_seo}|${p.gender}`, p.id]));
  const games = await listGames(db, season);
  const byContest = new Map(games.filter((g) => g.ncaa_contest_id).map((g) => [String(g.ncaa_contest_id), g]));

  let dates: string[];
  if (ctx.params.days === 'recent') {
    const d = new Date(); dates = [];
    for (const off of [-1, 0, 1]) { const x = new Date(d); x.setUTCDate(d.getUTCDate() + off); dates.push(x.toISOString().slice(0, 10)); }
  } else { const today = new Date().toISOString().slice(0, 10); dates = [...eachDate(`${season}-08-10`, `${season}-12-20` < today ? `${season}-12-20` : today)]; }

  for (const gender of genders) for (const division of divisions) for (const date of dates) {
    if (await ctx.cancelled()) return;
    let dayGames;
    try { dayGames = await scoreboardDay(fetcher, store, gender, division, date); }
    catch (err) { ctx.inc('days_failed'); log.warn({ gender, division, date, err: err instanceof Error ? err.message : String(err) }, 'scoreboard day failed'); continue; }
    if (!dayGames.length) { ctx.inc('days_missing'); continue; }
    for (const g of dayGames) {
      // A team NCAA.com lists but we have never registered (NAIA opponent, new member) gets a non-member program, so
      // the game has both sides and counts in its opponent's record. verify-membership promotes real members.
      const ensure = async (t: typeof g.home): Promise<string | null> => {
        if (!t.seo) return null;
        const hit = bySeo.get(`${t.seo}|${gender}`);
        if (hit) return hit;
        const name = t.short || t.full || t.seo;
        await upsertSchools(db, [{ seo: t.seo, name }]);
        const prog = await upsertProgram(db, { school_seo: t.seo, gender, name, short_name: t.short ?? name, name6: t.char6 ?? null });
        await upsertProgramSeasons(db, [{ program_id: prog.id, season, division, conference_id: null, ncaa_member: false, member_source: 'scoreboard' } as any]);
        bySeo.set(`${t.seo}|${gender}`, prog.id);
        ctx.inc('programs_created_from_scoreboard');
        return prog.id;
      };
      const homeId = await ensure(g.home);
      const awayId = await ensure(g.away);
      let existing = byContest.get(g.contestId) ?? (homeId && awayId ? findGame(games, g.date, homeId, awayId) : null);
      if (!existing && homeId && awayId && g.state !== 'cancelled') {
        // Not in the snapshot loaded at start: the fixture may have been inserted meanwhile (a concurrent site sync).
        const { data } = await db.from('college_games').select('*').eq('season', season).in('game_date', [g.date]).or(`and(home_program_id.eq.${homeId},away_program_id.eq.${awayId}),and(home_program_id.eq.${awayId},away_program_id.eq.${homeId})`).limit(1);
        if (data?.[0]) { existing = data[0] as typeof games[number]; games.push(existing); ctx.inc('games_found_late'); }
      }
      const base = {
        season, game_date: g.date, start_epoch: g.startTimeEpoch, gender, division,
        home_program_id: homeId, away_program_id: awayId, home_name: g.home.short ?? g.home.full, away_name: g.away.short ?? g.away.full,
      };
      if (existing) {
        // NCAA.com's home/away is official: a fixture stored the other way round (from a schedule stamp) is flipped.
        if (homeId && awayId && existing.home_program_id === awayId && existing.away_program_id === homeId) {
          ctx.inc(await reorientGame(db, existing) ? 'orientation_fixed' : 'orientation_conflicts');
        }
        const patch: Record<string, unknown> = { ncaa_contest_id: Number(g.contestId), start_epoch: g.startTimeEpoch ?? undefined, division };
        const sameSides = existing.home_program_id === homeId && existing.away_program_id === awayId;
        if (g.state === 'final' && existing.status === 'final' && sameSides && g.home.score != null && g.away.score != null
            && existing.home_score != null && (existing.home_score !== g.home.score || existing.away_score !== g.away.score)) {
          patch.home_score = g.home.score; patch.away_score = g.away.score; patch.source_of_truth = null;
          ctx.inc('scores_corrected');
          log.info({ game: existing.id, date: g.date, ours: `${existing.home_score}-${existing.away_score}`, ncaa: `${g.home.score}-${g.away.score}` }, 'final score corrected from NCAA.com');
        }
        if (!existing.home_program_id && homeId) patch.home_program_id = homeId;
        if (!existing.away_program_id && awayId) patch.away_program_id = awayId;
        if (existing.status !== 'final') {
          if (g.state === 'final') { patch.status = 'final'; patch.home_score = g.home.score; patch.away_score = g.away.score; }
          else if (g.state === 'live') patch.status = 'live';
        }
        if (existing.home_score == null && g.home.score != null && g.state === 'final') { patch.home_score = g.home.score; patch.away_score = g.away.score; }
        await updateGame(db, existing.id, patch);
        existing.ncaa_contest_id = Number(g.contestId);
        byContest.set(g.contestId, existing);
        ctx.inc('games_updated');
      } else {
        try {
          const row = await upsertGameByNcaa(db, { ...base, ncaa_contest_id: Number(g.contestId), status: g.state === 'final' ? 'final' : g.state === 'live' ? 'live' : 'scheduled', home_score: g.state === 'final' ? g.home.score : null, away_score: g.state === 'final' ? g.away.score : null });
          games.push(row); byContest.set(g.contestId, row);
          ctx.inc('games_created');
        } catch (err) {
          // A fixture clash (same date and programs under another contest id or created concurrently) must not stop the sweep.
          ctx.inc('games_insert_conflicts');
          log.warn({ contest: g.contestId, date: g.date, err: err instanceof Error ? err.message : String(err) }, 'scoreboard game insert skipped');
        }
      }
      if (!homeId || !awayId) ctx.inc('games_with_unknown_program');
    }
    ctx.inc('days');
    await ctx.heartbeat();
  }
}

registerJob('sweep-scoreboard', sweepScoreboard);
