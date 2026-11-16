// classify-postseason: mark Division I conference-tournament games (src/college/postseason.ts) and settle level
// knockout games on penalties. NCAA tournament games are marked by sweep-scoreboard from NCAA.com's own flags
// (postseason_source 'ncaa') and are only given their shootout winners here. Runs first in reconcile-games, so its
// conference flag (same conference, not postseason) leaves tournament games out of the conference tables, and in the
// three-hourly standings run so a tournament is followed while it is played. Pure computation: no requests.
import { registerJob, type JobContext } from './runner.js';
import type { Db } from '../db/client.js';
import { kvSet, selectAll } from '../db/client.js';
import { updateGame } from '../db/repos.js';
import { classifyConference, played, type ConferenceTournament, type PsGame } from '../college/postseason.js';
import { currentSeason, eastern } from './seasons.js';

export const POSTSEASON_KEY = (season: number) => `college:postseason:${season}`;

interface Row {
  id: string; game_date: string; gender: string; status: string;
  home_program_id: string; away_program_id: string; home_score: number | null; away_score: number | null;
  shootout: boolean | null; neutral_site: boolean | null; conference_game: boolean;
  postseason: boolean; postseason_source: string | null; tournament: string | null; tournament_round: string | null; round_number: number | null;
  home_seed: number | null; away_seed: number | null; shootout_winner: string | null; tournament_conference_id: string | null; bracket_slot: number | null;
}
const COLS = 'id,game_date,gender,status,home_program_id,away_program_id,home_score,away_score,shootout,neutral_site,conference_game,postseason,postseason_source,tournament,tournament_round,round_number,home_seed,away_seed,shootout_winner,tournament_conference_id,bracket_slot';
const CLEARED = { postseason: false, postseason_source: null, tournament: null, tournament_conference_id: null, tournament_round: null, round_number: null, home_seed: null, away_seed: null, shootout_winner: null };

/** Who won a level game's shootout, from the box score's shootout goals per side (a source whose sides are level, or
 *  two sources that disagree, answer nothing). */
export function pkWinners(rows: { game_id: string; program_id: string; source: string; shootout_goals: number | null }[]): Map<string, string> {
  const by = new Map<string, Map<string, Map<string, number>>>();
  for (const r of rows) {
    if (!r.shootout_goals) continue;
    const g = by.get(r.game_id) ?? new Map(); by.set(r.game_id, g);
    const s = g.get(r.source) ?? new Map(); g.set(r.source, s);
    s.set(r.program_id, (s.get(r.program_id) ?? 0) + r.shootout_goals);
  }
  const out = new Map<string, string>();
  for (const [game, sources] of by) {
    const winners = new Set<string>();
    for (const s of sources.values()) {
      const [a, b] = [...s].sort((x, y) => y[1] - x[1]);
      if (a && (!b || a[1] > b[1])) winners.add(a[0]);
    }
    if (winners.size === 1) out.set(game, [...winners][0]!);
  }
  return out;
}

/** The tournament fields each D1 game should have. Pure, given the season's games, membership and tables. */
export function planPostseason(input: {
  games: Row[];
  members: { program_id: string; conference_id: string; gender: string }[];
  conferences: { id: string; name: string; short_name: string | null }[];
  official: { program_id: string; conf_w: number | null; conf_l: number | null; conf_t: number | null; rank: number | null }[];
  pk: Map<string, string>;
  asOf: string;
}): { patches: Map<string, Record<string, unknown>>; tournaments: (ConferenceTournament & { conference: string; gender: string })[] } {
  const want = new Map<string, Record<string, unknown>>();
  const groups = new Map<string, string[]>();
  for (const m of input.members) { const k = `${m.conference_id}|${m.gender}`; groups.set(k, [...(groups.get(k) ?? []), m.program_id]); }
  const conf = new Map(input.conferences.map((c) => [c.id, c]));
  const confOf = new Map(input.members.map((m) => [m.program_id, m.conference_id]));
  const byId = new Map(input.games.map((g) => [g.id, g]));
  // The NCAA tournament field per gender (every team in an NCAA tournament game), once it is out.
  const fieldOf = new Map<string, Set<string>>();
  for (const g of input.games) if (g.postseason_source === 'ncaa') {
    const f = fieldOf.get(g.gender) ?? new Set<string>(); fieldOf.set(g.gender, f);
    f.add(g.home_program_id); f.add(g.away_program_id);
  }
  const officialGp = new Map(input.official.filter((o) => o.conf_w != null).map((o) => [o.program_id, (o.conf_w ?? 0) + (o.conf_l ?? 0) + (o.conf_t ?? 0)]));
  const officialRank = new Map(input.official.filter((o) => o.rank != null).map((o) => [o.program_id, o.rank!]));
  const tournaments: (ConferenceTournament & { conference: string; gender: string })[] = [];
  for (const [k, members] of groups) {
    const [conference, gender] = k.split('|') as [string, string];
    const set = new Set(members);
    const games: PsGame[] = input.games
      .filter((g) => g.postseason_source !== 'ncaa' && set.has(g.home_program_id) && set.has(g.away_program_id))
      .map((g) => ({ id: g.id, date: g.game_date, home: g.home_program_id, away: g.away_program_id, hs: g.home_score, as: g.away_score, status: g.status,
        shootout: !!g.shootout, neutral: !!g.neutral_site, pkWinner: input.pk.get(g.id) ?? null }));
    const t = classifyConference({
      members, games, asOf: input.asOf,
      officialGp: new Map(members.filter((m) => officialGp.has(m)).map((m) => [m, officialGp.get(m)!])),
      officialRank: new Map(members.filter((m) => officialRank.has(m)).map((m) => [m, officialRank.get(m)!])),
    });
    if (!t) continue;
    // A final level after extra time: the NCAA field settles it when only one finalist is in it (the automatic bid is
    // the champion's); otherwise the box-score shootout tally stands (it agreed with who played on 51 times in 53).
    const last = t.games.at(-1)!, lg = byId.get(last.id);
    if (t.complete && lg && lg.home_score === lg.away_score) {
      const field = fieldOf.get(gender) ?? new Set<string>();
      const inH = field.has(lg.home_program_id), inA = field.has(lg.away_program_id);
      if (inH !== inA) { t.champion = inH ? lg.home_program_id : lg.away_program_id; last.shootoutWinner = t.champion; t.finalShootout = null; }
    }
    tournaments.push({ ...t, conference, gender });
    const c = conf.get(conference);
    const name = `${c?.short_name ?? c?.name ?? 'Conference'} Tournament`;
    for (const tg of t.games) want.set(tg.id, {
      postseason: true, postseason_source: 'inferred', tournament: name, tournament_conference_id: conference,
      tournament_round: tg.label, round_number: tg.round, home_seed: tg.homeSeed, away_seed: tg.awaySeed, shootout_winner: tg.shootoutWinner,
      conference_game: false,
    });
  }
  // NCAA tournament games: the shootout winner from the box score, else the side found in the next round's slot.
  const ncaa = input.games.filter((g) => g.postseason_source === 'ncaa');
  const bySlot = new Map<string, Row>();
  for (const g of ncaa) if (g.bracket_slot != null) bySlot.set(`${g.gender}|${g.bracket_slot}`, g);
  for (const g of ncaa) {
    if (!played({ status: g.status, hs: g.home_score, as: g.away_score }) || g.home_score !== g.away_score) continue;
    let w = input.pk.get(g.id) ?? null;
    if (!w && g.bracket_slot != null) {
      const r = Math.floor(g.bracket_slot / 100), i = g.bracket_slot % 100;
      const next = bySlot.get(`${g.gender}|${(r + 1) * 100 + Math.ceil(i / 2)}`);
      if (next) w = [g.home_program_id, g.away_program_id].find((t) => t === next.home_program_id || t === next.away_program_id) ?? null;
    }
    if (w && w !== g.shootout_winner) want.set(g.id, { shootout_winner: w });
  }
  // Only what changes; games this module marked before and no longer finds go back to plain games.
  const patches = new Map<string, Record<string, unknown>>();
  for (const g of input.games) {
    const w = want.get(g.id);
    if (w) {
      const diff = Object.fromEntries(Object.entries(w).filter(([f, v]) => (g as any)[f] !== v));
      if (Object.keys(diff).length) patches.set(g.id, diff);
    } else if (g.postseason_source === 'inferred') {
      // Back to a plain game: a conference game again when both sides are in the same conference.
      const hc = confOf.get(g.home_program_id), ac = confOf.get(g.away_program_id);
      patches.set(g.id, { ...CLEARED, conference_game: !!hc && hc === ac });
    }
  }
  return { patches, tournaments };
}

/** Classify one season (D1). Returns counts; writes only changed rows. */
export async function classifySeason(db: Db, season: number, inc: (k: string, n?: number) => void): Promise<void> {
  const today = eastern().date;
  const asOf = `${season}-12-31` < today ? `${season}-12-31` : today;
  const [seasons, programs, conferences, official, games] = await Promise.all([
    selectAll<{ program_id: string; conference_id: string | null; division: string; ncaa_member: boolean }>(db, 'college_program_seasons', 'program_id,conference_id,division,ncaa_member', (q) => q.eq('season', season).eq('division', 'd1').order('program_id')),
    selectAll<{ id: string; gender: string }>(db, 'college_programs', 'id,gender', (q) => q.order('id')),
    selectAll<{ id: string; name: string; short_name: string | null }>(db, 'college_conferences', 'id,name,short_name', (q) => q.order('id')),
    selectAll<any>(db, 'college_standings', 'program_id,conf_w,conf_l,conf_t,rank', (q) => q.eq('season', season).eq('source', 'conference').order('program_id')),
    selectAll<Row>(db, 'college_games', COLS, (q) => q.eq('season', season).in('status', ['final', 'scheduled', 'live']).not('home_program_id', 'is', null).not('away_program_id', 'is', null).order('id')),
  ]);
  const gender = new Map(programs.map((p) => [p.id, p.gender]));
  const indep = new Set(conferences.filter((c) => /independent/i.test(c.name)).map((c) => c.id));
  const members = seasons.filter((s) => s.ncaa_member !== false && s.conference_id && !indep.has(s.conference_id) && gender.has(s.program_id))
    .map((s) => ({ program_id: s.program_id, conference_id: s.conference_id!, gender: gender.get(s.program_id)! }));
  // Shootout goals for level finals that could be knockout games (late season: from the last week of October).
  const level = games.filter((g) => g.status === 'final' && g.home_score != null && g.home_score === g.away_score && g.game_date >= `${season}-10-20`).map((g) => g.id);
  const pkRows: { game_id: string; program_id: string; source: string; shootout_goals: number | null }[] = [];
  for (let i = 0; i < level.length; i += 100) {
    const chunk = level.slice(i, i + 100);
    pkRows.push(...await selectAll<any>(db, 'college_game_player_stats', 'game_id,program_id,source,shootout_goals', (q) => q.in('game_id', chunk).gt('shootout_goals', 0).order('game_id')));
  }
  const { patches, tournaments } = planPostseason({ games, members, conferences, official, pk: pkWinners(pkRows), asOf });
  for (const [id, patch] of patches) {
    await updateGame(db, id, patch);
    inc(patch.postseason === false ? 'postseason_cleared' : patch.postseason === true ? 'postseason_marked' : 'postseason_updated');
  }
  inc('conference_tournaments', tournaments.length);
  inc('conference_champions', tournaments.filter((t) => t.champion).length);
  await kvSet(db, POSTSEASON_KEY(season), {
    at: new Date().toISOString(),
    tournaments: tournaments.map((t) => ({ conference: t.conference, gender: t.gender, start: t.start, how: t.how, complete: t.complete, champion: t.champion, teams: t.teams.length, games: t.games.length, final_shootout_unknown: !!t.finalShootout })),
  });
}

/** params: { season? } */
export async function classifyPostseason(ctx: JobContext): Promise<void> {
  const season = Number(ctx.params.season ?? currentSeason());
  await classifySeason(ctx.db, season, (k, n) => ctx.inc(k, n));
}

registerJob('classify-postseason', classifyPostseason);
