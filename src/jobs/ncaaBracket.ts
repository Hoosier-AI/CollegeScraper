// The NCAA tournament field from NCAA.com's bracket page, as soon as the bracket is announced. The scoreboard sweep
// only sees a game once both teams are known, so before this the men's 16 seeded teams (first-round byes) were not
// on the site until the second round was set, and the tournament page stayed on "projected" (2026-11-16). This writes
// every bracket game with a known team: contest id, slot, round, seeds and kickoff. Scores and results stay with
// sweep-scoreboard, which later fills the other side from the same contest.
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { log } from '../log.js';
import { listPrograms, listGames, updateGame, upsertGameByNcaa } from '../db/repos.js';
import { findGame } from '../identity/gameMatch.js';
import { currentSeason } from './seasons.js';
import { ncaaRoundLabel } from './sweepScoreboard.js';
import { bracketPageUrl, parseBracketPage } from '../sources/ncaa/bracketPage.js';
import type { Division, Gender } from '../model.js';

/** params: { season?, gender?, division? (default d1), force? } */
export async function ncaaBracketJob(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  // Brackets exist from Selection Monday (mid-November) to the College Cup (mid-December).
  const today = new Date().toISOString().slice(0, 10);
  if (!ctx.params.force && (today < `${season}-11-01` || today > `${season}-12-20`)) { ctx.inc('out_of_window'); return; }
  const fetcher = makeFetcher(db, { freshMs: ctx.params.force ? 0 : 3600_000 });
  const genders: Gender[] = ctx.params.gender ? [ctx.params.gender as Gender] : ['m', 'w'];
  const divisions: Division[] = ctx.params.division ? [ctx.params.division as Division] : ['d1'];
  const programs = await listPrograms(db);
  const bySeo = new Map(programs.map((p) => [`${p.school_seo}|${p.gender}`, p]));
  const games = await listGames(db, season);
  const byContest = new Map(games.filter((g) => g.ncaa_contest_id).map((g) => [String(g.ncaa_contest_id), g]));

  for (const gender of genders) for (const division of divisions) {
    if (await ctx.cancelled()) return;
    let html: string;
    try { html = (await fetcher.get(bracketPageUrl(gender, division, season), { accept: 'text/html' })).text; }
    catch (err) {
      // No bracket yet (404 before Selection Monday) is normal.
      ctx.inc('pages_missing');
      log.info({ gender, division, err: err instanceof Error ? err.message : String(err) }, 'ncaa bracket page not read');
      continue;
    }
    const page = parseBracketPage(html);
    if (!page) { ctx.inc('pages_unparsed'); log.warn({ gender, division }, 'ncaa bracket page had no bracket data'); continue; }
    ctx.inc('pages');
    for (const g of page.games) {
      if (!g.teams.length || !g.date) continue;
      const side = (home: boolean) => {
        const t = g.teams.find((x) => x.isHome === home) ?? (g.teams.length === 1 ? null : g.teams[home ? 0 : 1]);
        if (!t) return null;
        const p = bySeo.get(`${t.seo}|${gender}`);
        if (!p) { ctx.inc('teams_unknown'); log.warn({ seo: t.seo, gender, contest: g.contestId }, 'ncaa bracket team not found'); }
        return { id: p?.id ?? null, name: p?.short_name ?? t.name, seed: t.seed };
      };
      const home = side(true), away = side(false);
      const tourney = {
        postseason: true, postseason_source: 'ncaa', tournament: 'NCAA Tournament', tournament_conference_id: null, conference_game: false,
        tournament_round: ncaaRoundLabel(g.round), round_number: g.round, bracket_slot: g.slot, home_seed: home?.seed ?? null, away_seed: away?.seed ?? null,
      };
      const existing = byContest.get(String(g.contestId)) ?? (home?.id && away?.id ? findGame(games, g.date, home.id, away.id) : null);
      if (existing) {
        const patch: Record<string, unknown> = { ...tourney, ncaa_contest_id: g.contestId };
        // Only fill a side that is empty and only on the side NCAA.com gives: turning a stored game round is the sweep's job.
        if (!existing.home_program_id && home?.id && existing.away_program_id !== home.id) Object.assign(patch, { home_program_id: home.id, home_name: home.name });
        if (!existing.away_program_id && away?.id && existing.home_program_id !== away.id) Object.assign(patch, { away_program_id: away.id, away_name: away.name });
        // Seeds are NCAA.com's; a stored game turned the other way round takes them the other way round.
        if (existing.home_program_id && existing.home_program_id === away?.id) Object.assign(patch, { home_seed: away.seed, away_seed: home?.seed ?? null });
        if (existing.status !== 'final' && existing.status !== 'live') Object.assign(patch, { game_date: g.date, ...(g.startEpoch ? { start_epoch: g.startEpoch } : {}) });
        await updateGame(db, existing.id, patch);
        Object.assign(existing, patch);
        byContest.set(String(g.contestId), existing);
        ctx.inc('games_updated');
      } else {
        try {
          const row = await upsertGameByNcaa(db, {
            ...tourney, ncaa_contest_id: g.contestId, season, gender, division, game_date: g.date, start_epoch: g.startEpoch,
            home_program_id: home?.id ?? null, away_program_id: away?.id ?? null, home_name: home?.name ?? null, away_name: away?.name ?? null, status: 'scheduled',
          });
          games.push(row); byContest.set(String(g.contestId), row);
          ctx.inc('games_created');
        } catch (err) {
          ctx.inc('games_insert_conflicts');
          log.warn({ contest: g.contestId, err: err instanceof Error ? err.message : String(err) }, 'ncaa bracket game insert skipped');
        }
      }
    }
    await ctx.heartbeat();
  }
}

registerJob('ncaa-bracket', ncaaBracketJob);
