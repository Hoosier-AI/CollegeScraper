// NCAA.com scoreboard sweep → college_games rows (keyed by ncaa_contest_id) linked to programs by seo.
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { scoreboardDay } from '../sources/ncaa/index.js';
import { makeTransport } from './fetchGamesNcaa.js';
import { kvGet, kvSet } from '../db/client.js';
import { log } from '../log.js';
import { listPrograms, listGames, upsertGameByNcaa, updateGame, reorientGame, upsertSchools, upsertProgram, upsertProgramSeasons } from '../db/repos.js';
import { findGame } from '../identity/gameMatch.js';
import { isCleanOpponentName, opponentSeo, realProgramFor } from '../normalize/aliasIndex.js';
import { currentSeason, eachDate, eastern } from './seasons.js';
import type { Division, Gender } from '../model.js';
import type { ScoreboardGame } from '../sources/ncaa/scoreboard.js';

/** NCAA tournament rounds by number (six rounds in both fields: the men's 48 give the top 16 a first-round bye). */
export function ncaaRoundLabel(round: number): string {
  return ['First round', 'Second round', 'Third round', 'Quarterfinal', 'Semifinal', 'Final'][round - 1] ?? `Round ${round}`;
}

/** NCAA.com lists a game whose opponent isn't known yet (a conference tournament's next round) against a team called
 *  "TBA" (seo tba), then fills in the real opponent on the same contest once it is. "TBA" is not a team. */
export const isPlaceholderTeam = (t: { seo?: string | null; short?: string | null; full?: string | null }): boolean =>
  [t.seo, t.short, t.full].some((v) => !!v && /^(tba|tbd)$/i.test(v.trim()));

/** Days ahead read on every run: the NCAA bracket is announced on a Monday for games from Thursday, and conference
 *  tournament pairings a few days out, so a window of yesterday to tomorrow left the bracket off the site until the
 *  day before (2026-11-16). */
export const LOOKAHEAD_DAYS = 7;

/** params: { season?, gender?, division?, days?: 'all'|'recent', force? } */
export async function sweepScoreboard(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const fetcher = makeFetcher(db, { freshMs: ctx.params.force ? 0 : (ctx.params.days === 'recent' ? 0 : 7 * 86400_000) });
  const freshFetcher = makeFetcher(db, { freshMs: 0 });
  // Days ahead change slowly (pairings, kickoff times): read at most every three hours.
  const aheadFetcher = makeFetcher(db, { freshMs: 3 * 3600_000 });
  const { store } = makeTransport(db, fetcher);
  await store.init();
  const genders: Gender[] = ctx.params.gender ? [ctx.params.gender as Gender] : ['m', 'w'];
  const divisions: Division[] = ctx.params.division ? [ctx.params.division as Division] : ['d1', 'd2', 'd3'];
  const programs = await listPrograms(db);
  const bySeo = new Map(programs.map((p) => [`${p.school_seo}|${p.gender}`, p.id]));
  // "TBA" programs made from NCAA.com placeholders before this was caught (2026: one per gender, 118 games).
  const placeholderIds = new Set(programs.filter((p) => /^(tba|tbd)$/i.test(p.school_seo ?? '')).map((p) => p.id));
  const games = await listGames(db, season);
  const byContest = new Map(games.filter((g) => g.ncaa_contest_id).map((g) => [String(g.ncaa_contest_id), g]));
  type DupContest = { gender: string; division: string; date: string; home: string | null; away: string | null; homeScore: number | null; awayScore: number | null; contests: string[] };
  const dupContests = new Map<string, DupContest>(Object.entries((await kvGet<Record<string, DupContest>>(db, `ncaa_duplicate_contests:${season}`)) ?? {}));

  let dates: string[];
  const dayOff = (off: number) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + off); return x.toISOString().slice(0, 10); };
  const seasonEnd = `${season}-12-20`;
  const ahead = [...Array(LOOKAHEAD_DAYS - 1).keys()].map((i) => dayOff(i + 2)).filter((d) => d <= seasonEnd && d >= `${season}-08-10`);
  if (ctx.params.days === 'recent') dates = [...[-1, 0, 1].map(dayOff), ...ahead];
  else { const today = dayOff(0); dates = [...eachDate(`${season}-08-10`, seasonEnd < today ? seasonEnd : today), ...ahead]; }
  const tomorrow = dayOff(1);

  // NCAA tournament games. A division's scoreboard also lists other divisions' championship games now and then (a D2
  // second-round game on the D1 men's page, 2025-11-23), so a game counts only under the championship id that most of
  // that division's tournament games carry, remembered per season once a day shows four or more of them.
  const champKey = (gender: Gender, division: Division) => `ncaa_championship:${season}:${gender}:${division}`;
  const champIds = new Map<string, number | null>();
  const champOf = async (gender: Gender, division: Division, day: ScoreboardGame[]): Promise<number | null> => {
    const k = champKey(gender, division);
    if (!champIds.has(k)) champIds.set(k, (await kvGet<number>(db, k)) ?? null);
    const counts = new Map<number, number>();
    for (const x of day) if (x.championship?.id != null) counts.set(x.championship.id, (counts.get(x.championship.id) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 4 && champIds.get(k) !== top[0]) { champIds.set(k, top[0]); await kvSet(db, k, top[0]); }
    return champIds.get(k) ?? (counts.size === 1 ? top![0] : null);
  };
  const ncaaTournament = (g: ScoreboardGame, champ: number | null): Record<string, unknown> | null => {
    const c = g.championship;
    if (!c || c.id == null || c.id !== champ) return null;
    return { postseason: true, postseason_source: 'ncaa', tournament: 'NCAA Tournament', tournament_conference_id: null, conference_game: false,
      tournament_round: ncaaRoundLabel(c.round), round_number: c.round, bracket_slot: c.slot, home_seed: g.home.seed ?? null, away_seed: g.away.seed ?? null };
  };

  for (const gender of genders) for (const division of divisions) for (const date of dates) {
    if (await ctx.cancelled()) return;
    let dayGames;
    // Scoreboard days change until their games end: the last three days are always refetched, older days may be cached.
    const recentDay = Date.now() - Date.parse(`${date}T00:00:00Z`) < 3 * 86400_000;
    try { dayGames = await scoreboardDay(date > tomorrow ? aheadFetcher : recentDay ? freshFetcher : fetcher, store, gender, division, date); }
    catch (err) { ctx.inc('days_failed'); log.warn({ gender, division, date, err: err instanceof Error ? err.message : String(err) }, 'scoreboard day failed'); continue; }
    if (!dayGames.length) { ctx.inc('days_missing'); continue; }
    // NCAA.com leaves some finished games marked 'pre' while still counting them in its records: a past date with
    // both scores is final (Presbyterian 1 @ Wofford 0, 2026-09-06).
    // Judged against the Eastern date: from 20:00 ET every Eastern-today game is already "yesterday" in UTC.
    const played = (x: typeof dayGames[number]) => x.state === 'final' || (x.home.score != null && x.away.score != null && x.date < eastern().date);
    const champ = await champOf(gender, division, dayGames);
    for (const g of dayGames) {
      const tourney = ncaaTournament(g, champ);
      if (tourney) ctx.inc('ncaa_tournament_games');
      // A team NCAA.com lists but we have never registered (NAIA opponent, new member) gets a non-member program, so
      // the game has both sides and counts in its opponent's record. verify-membership promotes real members.
      const ensure = async (t: typeof g.home): Promise<string | null> => {
        if (isPlaceholderTeam(t)) return null;
        const name = (t.short || t.full || t.seo || '').trim();
        // Teams NCAA.com lists without a school page (NAIA, junior colleges) get a synthetic slug from their name.
        const seo = t.seo || (isCleanOpponentName(name) ? opponentSeo(name) : null);
        if (!seo) return null;
        const hit = bySeo.get(`${seo}|${gender}`);
        if (hit) return hit;
        // A team listed without its school page whose name is exactly one real program's is that program, not an x- twin.
        if (!t.seo) { const real = realProgramFor(programs, null, gender, name); if (real) { bySeo.set(`${seo}|${gender}`, real); return real; } }
        await upsertSchools(db, [{ seo, name }]);
        const prog = await upsertProgram(db, { school_seo: seo, gender, name, short_name: (t.short ?? name).trim(), name6: t.char6 ?? null });
        await upsertProgramSeasons(db, [{ program_id: prog.id, season, division, conference_id: null, ncaa_member: false, member_source: 'scoreboard' } as any]);
        bySeo.set(`${seo}|${gender}`, prog.id);
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
      if (existing && existing.ncaa_contest_id && String(existing.ncaa_contest_id) !== g.contestId && !byContest.has(g.contestId)) {
        // NCAA.com sometimes lists one game twice under two contest ids (often with home and away swapped) and counts it
        // twice in its leaderboards. The first link is kept; the pair is recorded so record checks can explain it.
        const k = [String(existing.ncaa_contest_id), g.contestId].sort().join('|');
        dupContests.set(k, { gender, division, date: g.date, home: g.home.seo ?? null, away: g.away.seo ?? null, homeScore: g.home.score ?? null, awayScore: g.away.score ?? null, contests: k.split('|') });
        ctx.inc('ncaa_duplicate_contests');
        continue;
      }
      const placeholderSide = !!existing && (placeholderIds.has(existing.home_program_id ?? '') || placeholderIds.has(existing.away_program_id ?? ''));
      if (existing && homeId && awayId && (placeholderSide || !existing.home_program_id || !existing.away_program_id)) {
        // Stored against "TBA", or with one side still empty (a seeded team waiting for its opponent, from ncaa-bracket),
        // and NCAA.com now names both teams: take them. The team we already had says which way round our scores are;
        // a game with no real side yet keeps NCAA.com's orientation.
        const ours = [existing.home_program_id, existing.away_program_id].filter((id) => id && !placeholderIds.has(id));
        if (ours.length && !ours.some((id) => id === homeId || id === awayId)) { ctx.inc('placeholder_side_conflicts'); }
        else {
          const swap = existing.home_program_id === awayId || existing.away_program_id === homeId;
          const reread = placeholderSide || swap;
          const fix: Record<string, unknown> = {
            home_program_id: homeId, away_program_id: awayId, home_name: base.home_name, away_name: base.away_name,
            home_score: swap ? existing.away_score : existing.home_score, away_score: swap ? existing.home_score : existing.away_score,
            ...(swap ? { home_seed: (existing as any).away_seed ?? null, away_seed: (existing as any).home_seed ?? null } : {}),
            // Box scores read against "TBA" (or the wrong way round) are read again with the real teams.
            ...(reread ? { site_fetched_at: null, ncaa_fetched_at: null, source_of_truth: null, detail_attempts: 0 } : {}),
          };
          // NCAA.com sometimes lists the game twice: the played one against "TBA" and an unplayed copy with both teams
          // (Worcester St., 2026-11-06, contests 6666330 and 6671276). The played row is kept and the copy removed; any
          // other clash is left alone and counted, never allowed to stop the sweep.
          const { data: clash } = await db.from('college_games').select('id,status,home_score,away_score,ncaa_contest_id')
            .eq('game_date', existing.game_date).eq('home_program_id', homeId).eq('away_program_id', awayId).neq('id', existing.id).limit(1);
          const other = clash?.[0];
          const unplayedCopy = !!other && other.status !== 'final' && other.home_score == null && other.away_score == null && existing.home_score != null;
          if (other && !unplayedCopy) {
            ctx.inc('placeholder_side_duplicates');
            log.warn({ game: existing.id, other: other.id }, 'TBA side not replaced: the real pairing is already stored');
          } else {
            if (other) {
              // The copy's contest is left unlinked: when the sweep reaches it, it finds this game by date and teams and
              // records the pair as a duplicate contest (above) instead of moving the link.
              await db.from('college_games').delete().eq('id', other.id);
              if (other.ncaa_contest_id) byContest.delete(String(other.ncaa_contest_id));
              const at = games.findIndex((x) => x.id === other.id); if (at >= 0) games.splice(at, 1);
              ctx.inc('placeholder_copies_removed');
            }
            await updateGame(db, existing.id, fix);
            if (reread) for (const t of ['college_game_team_stats', 'college_game_player_stats', 'college_game_events', 'college_game_raw']) {
              const { error } = await db.from(t).delete().eq('game_id', existing.id);
              if (error) log.warn({ t, id: existing.id, err: error.message }, 'TBA game detail cleanup failed');
            }
            Object.assign(existing, fix);
            ctx.inc(placeholderSide ? 'placeholder_sides_fixed' : 'empty_sides_filled');
            log.info({ game: existing.id, date: g.date, home: base.home_name, away: base.away_name, swap, copyRemoved: !!other }, 'TBA side replaced from NCAA.com');
          }
        }
      }
      if (existing) {
        // NCAA.com's home/away is official: a fixture stored the other way round (from a schedule stamp) is flipped.
        if (homeId && awayId && existing.home_program_id === awayId && existing.away_program_id === homeId) {
          ctx.inc(await reorientGame(db, existing) ? 'orientation_fixed' : 'orientation_conflicts');
        }
        const patch: Record<string, unknown> = { ncaa_contest_id: Number(g.contestId), start_epoch: g.startTimeEpoch ?? undefined, division };
        const sameSides = existing.home_program_id === homeId && existing.away_program_id === awayId;
        if (played(g) && existing.status === 'final' && sameSides && g.home.score != null && g.away.score != null
            && existing.home_score != null && (existing.home_score !== g.home.score || existing.away_score !== g.away.score)) {
          patch.home_score = g.home.score; patch.away_score = g.away.score; patch.source_of_truth = null;
          ctx.inc('scores_corrected');
          log.info({ game: existing.id, date: g.date, ours: `${existing.home_score}-${existing.away_score}`, ncaa: `${g.home.score}-${g.away.score}` }, 'final score corrected from NCAA.com');
        }
        if (!existing.home_program_id && homeId) patch.home_program_id = homeId;
        if (!existing.away_program_id && awayId) patch.away_program_id = awayId;
        // A game called off part-way and ruled a no contest (Akron at West Virginia, 2026-09-03, weather) keeps its
        // score on NCAA.com but is never final there and counts in no record: stored 'cancelled', only NCAA.com's own
        // 'final' brings it back.
        const noContest = existing.status === 'cancelled' && g.state !== 'final';
        if (existing.status !== 'final' && !noContest) {
          if (played(g)) { Object.assign(patch, { status: 'final', home_score: g.home.score, away_score: g.away.score, live_period: 'FINAL', live_clock: null }); }
          else if (g.state === 'live') Object.assign(patch, { status: 'live', home_score: g.home.score, away_score: g.away.score, live_period: g.currentPeriod, live_clock: g.contestClock, live_updated_at: new Date().toISOString() });
        }
        if (existing.home_score == null && g.home.score != null && played(g) && !noContest) { patch.home_score = g.home.score; patch.away_score = g.away.score; }
        // Where it is shown: NCAA.com's broadcaster only when neither school's schedule named one.
        if (g.network && !(existing as any).broadcast) { patch.broadcast = g.network; patch.broadcast_source = 'ncaa'; }
        if (tourney) Object.assign(patch, tourney);
        await updateGame(db, existing.id, patch);
        existing.ncaa_contest_id = Number(g.contestId);
        byContest.set(g.contestId, existing);
        ctx.inc('games_updated');
      } else {
        try {
          const row = await upsertGameByNcaa(db, { ...base, ...(g.network ? { broadcast: g.network, broadcast_source: 'ncaa' } : {}), ...(tourney ?? {}), ncaa_contest_id: Number(g.contestId), status: played(g) ? 'final' : g.state === 'live' ? 'live' : 'scheduled', home_score: played(g) ? g.home.score : null, away_score: played(g) ? g.away.score : null });
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
  await kvSet(db, `ncaa_duplicate_contests:${season}`, Object.fromEntries(dupContests));
}

registerJob('sweep-scoreboard', sweepScoreboard);
