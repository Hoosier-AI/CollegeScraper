// Typed write/read helpers over the college_* tables. Every write is a natural-key upsert.
import type { Db } from './client.js';
import { upsertChunked, selectAll } from './client.js';
import type { BoxScore, Coach, Division, Gender, PlayerBio, PlayerStatLine, Roster, RosterPlayer, ScheduleEntry, SeasonStats, SitePlatform } from '../model.js';
import { nameKey, splitName, displayName, cleanName } from '../normalize/names.js';
import { parseClassYear } from '../normalize/classYear.js';
import { normalizePosition } from '../normalize/position.js';
import { heightToCm } from '../normalize/height.js';
import { parseHometown } from '../normalize/hometown.js';
import { matchStatLine, resolveRoster, type KnownPlayerSeason, type StatLineCandidate } from '../identity/resolver.js';
import { log } from '../log.js';

export interface SchoolRow {
  seo: string; ncaa_tid: number | null; name: string; long_name: string | null; athletics_url: string | null; athletics_host: string | null;
  site_platform: SitePlatform; site_detected_at: string | null; logo_svg_url: string | null; logo_dark_url: string | null;
}
export interface ProgramRow {
  id: string; school_seo: string; gender: Gender; ncaa_team_id: number | null; site_sport_slug: string | null; site_sport_id: number | null;
  site_team_slug: string | null; site_status: string; name: string; short_name: string | null; name6: string | null;
}
export interface ProgramSeasonRow { program_id: string; season: number; division: Division; conference_id: string | null }
export interface GameRow {
  id: string; season: number; game_date: string; gender: Gender; division: Division | null; home_program_id: string | null; away_program_id: string | null;
  home_name: string | null; away_name: string | null; home_score: number | null; away_score: number | null; status: string; ncaa_contest_id: number | null;
  site_game_refs: Record<string, string>; source_of_truth: 'site' | 'ncaa' | null; site_fetched_at: string | null; ncaa_fetched_at: string | null; detail_attempts: number;
}

// ---------- schools / programs ----------
export async function upsertSchools(db: Db, rows: Partial<SchoolRow>[]): Promise<number> {
  return upsertChunked(db, 'college_schools', rows as Record<string, unknown>[], { onConflict: 'seo' });
}

export async function getSchool(db: Db, seo: string): Promise<SchoolRow | null> {
  const { data, error } = await db.from('college_schools').select('*').eq('seo', seo).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SchoolRow) ?? null;
}

export async function listSchools(db: Db, filter?: (q: any) => any): Promise<SchoolRow[]> {
  return selectAll<SchoolRow>(db, 'college_schools', '*', filter);
}

export async function upsertProgram(db: Db, row: Omit<Partial<ProgramRow>, 'id'> & { school_seo: string; gender: Gender; name: string }): Promise<ProgramRow> {
  const { data, error } = await db.from('college_programs').upsert(row as any, { onConflict: 'school_seo,gender' }).select('*').single();
  if (error) throw new Error(`upsert program ${row.school_seo}/${row.gender}: ${error.message}`);
  return data as ProgramRow;
}

export async function listPrograms(db: Db, filter?: (q: any) => any): Promise<ProgramRow[]> {
  return selectAll<ProgramRow>(db, 'college_programs', '*', filter);
}

export async function getProgram(db: Db, id: string): Promise<ProgramRow | null> {
  const { data, error } = await db.from('college_programs').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProgramRow) ?? null;
}

export async function upsertProgramSeasons(db: Db, rows: (ProgramSeasonRow & Record<string, unknown>)[]): Promise<number> {
  return upsertChunked(db, 'college_program_seasons', rows, { onConflict: 'program_id,season' });
}

export async function listProgramSeasons(db: Db, season: number, filter?: (q: any) => any): Promise<(ProgramSeasonRow & Record<string, unknown>)[]> {
  return selectAll(db, 'college_program_seasons', '*', (q) => { q = q.eq('season', season); return filter ? filter(q) : q; });
}

export async function upsertConference(db: Db, ncaaSeo: string, name: string, division: string | null): Promise<string> {
  const { data, error } = await db.from('college_conferences').upsert({ ncaa_seo: ncaaSeo, name, division }, { onConflict: 'ncaa_seo' }).select('id').single();
  if (error) throw new Error(`upsert conference ${ncaaSeo}: ${error.message}`);
  return data.id as string;
}

export async function markProgramSeason(db: Db, programId: string, season: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('college_program_seasons').update(patch).eq('program_id', programId).eq('season', season);
  if (error) log.warn({ programId, season, err: error.message }, 'markProgramSeason failed');
}

// ---------- players / rosters ----------
export async function knownPlayerSeasons(db: Db, programId: string, host: string | null): Promise<KnownPlayerSeason[]> {
  const rows = await selectAll<any>(db, 'college_player_seasons',
    'id,player_id,program_id,season,jersey,class_year,is_redshirt,is_grad,hometown_raw,high_school,previous_school,college_players!inner(first_name,last_name,name_key,site_player_ids)',
    (q) => q.eq('program_id', programId));
  return rows.map((r) => ({
    playerSeasonId: r.id, playerId: r.player_id, programId: r.program_id, season: r.season,
    nameKey: r.college_players.name_key, firstName: r.college_players.first_name, lastName: r.college_players.last_name,
    jersey: r.jersey, classYear: r.class_year, isRedshirt: r.is_redshirt, isGrad: r.is_grad,
    sitePlayerId: host ? (r.college_players.site_player_ids?.[host] ?? null) : null,
    hometownRaw: r.hometown_raw, highSchool: r.high_school, previousSchool: r.previous_school,
  }));
}

export interface RosterWriteResult { created: number; linked: number; playerSeasonIds: Map<string, string>; lowConfidence: number }

/** Resolve identities and upsert players + player_seasons for one program-season. */
export async function writeRoster(db: Db, programId: string, season: number, host: string | null, roster: Roster, source: 'site_json' | 'site_html'): Promise<RosterWriteResult> {
  const known = await knownPlayerSeasons(db, programId, host);
  const prior = known.filter((k) => k.season < season);
  const current = known.filter((k) => k.season === season);
  const resolved = resolveRoster(roster.players, prior, season, new Map(), current);
  let created = 0, linked = 0, lowConfidence = 0;
  const playerSeasonIds = new Map<string, string>();

  for (const r of resolved) {
    const p = r.roster;
    const key = nameKey(p.firstName, p.lastName);
    const home = parseHometown(p.hometownRaw);
    let playerId = r.playerId;
    const identity = {
      first_name: cleanName(p.firstName), last_name: cleanName(p.lastName), display_name: displayName(p.firstName, p.lastName), name_key: key,
      hometown_city: home.city, hometown_region: home.region, hometown_country: home.country, high_school: p.highSchool,
      headshot_url: p.headshotUrl, bio_url: p.bioUrl,
    };
    if (!playerId) {
      const { data, error } = await db.from('college_players').insert({ ...identity, site_player_ids: host && p.sitePlayerId ? { [host]: p.sitePlayerId } : {} }).select('id').single();
      if (error) throw new Error(`insert player ${key}: ${error.message}`);
      playerId = data.id as string;
      created += 1;
    } else {
      linked += 1;
      const patch: Record<string, unknown> = { ...identity };
      if (host && p.sitePlayerId) {
        const { data } = await db.from('college_players').select('site_player_ids').eq('id', playerId).maybeSingle();
        patch.site_player_ids = { ...(data?.site_player_ids ?? {}), [host]: p.sitePlayerId };
      }
      const { error } = await db.from('college_players').update(patch).eq('id', playerId);
      if (error) log.warn({ playerId, err: error.message }, 'player update failed');
    }
    const cls = parseClassYear(p.classRaw);
    const row = {
      player_id: playerId, program_id: programId, season, jersey: p.jersey, position: normalizePosition(p.positionRaw), position_raw: p.positionRaw,
      class_year: cls.year, class_raw: cls.raw, is_redshirt: cls.redshirt, is_grad: cls.grad, height_cm: heightToCm(p.heightRaw), weight_lb: p.weightLb,
      hometown_raw: p.hometownRaw, high_school: p.highSchool, previous_school: p.previousSchool, major: p.major, is_captain: p.isCaptain,
      headshot_url: p.headshotUrl, bio_url: p.bioUrl, source, confidence: r.playerId ? r.confidence : 1,
    };
    const { data, error } = await db.from('college_player_seasons').upsert(row, { onConflict: 'player_id,season,program_id' }).select('id').single();
    if (error) throw new Error(`upsert player_season ${key}: ${error.message}`);
    playerSeasonIds.set(p.sourceKey, data.id as string);
    if (r.confidence < 0.75 && r.playerId) lowConfidence += 1;
  }
  return { created, linked, playerSeasonIds, lowConfidence };
}

export async function writeCoaches(db: Db, programId: string, season: number, coaches: Coach[]): Promise<number> {
  let n = 0;
  for (const c of coaches) {
    const { firstName, lastName } = splitName(c.name);
    const key = nameKey(firstName, lastName);
    const { data: existing } = await db.from('college_coaches').select('id').eq('name_key', key).limit(1).maybeSingle();
    let coachId = existing?.id as string | undefined;
    if (!coachId) {
      const { data, error } = await db.from('college_coaches').insert({ name: cleanName(c.name), name_key: key, headshot_url: c.headshotUrl }).select('id').single();
      if (error) { log.warn({ coach: c.name, err: error.message }, 'coach insert failed'); continue; }
      coachId = data.id as string;
    }
    const { error } = await db.from('college_coach_seasons').upsert({ coach_id: coachId, program_id: programId, season, title: c.title, is_head: c.isHead }, { onConflict: 'coach_id,program_id,season' });
    if (!error) n += 1;
  }
  return n;
}

export async function writeHonors(db: Db, playerSeasonId: string, bio: PlayerBio): Promise<number> {
  if (!bio.honors.length) return 0;
  const rows = bio.honors.map((text) => ({ player_season_id: playerSeasonId, text: text.slice(0, 300), source_url: bio.sourceUrl }));
  return upsertChunked(db, 'college_player_honors', rows, { onConflict: 'player_season_id,text', ignoreDuplicates: true });
}

export async function statLineCandidates(db: Db, programId: string, season: number): Promise<StatLineCandidate[]> {
  const rows = await selectAll<any>(db, 'college_player_seasons', 'id,jersey,college_players!inner(first_name,last_name,name_key)', (q) => q.eq('program_id', programId).eq('season', season));
  return rows.map((r) => ({ playerSeasonId: r.id, nameKey: r.college_players.name_key, firstName: r.college_players.first_name, lastName: r.college_players.last_name, jersey: r.jersey }));
}

/** Create a boxscore_only player + player_season for a line that matched nobody on the roster. */
export async function createBoxscoreOnlyPlayer(db: Db, programId: string, season: number, line: PlayerStatLine): Promise<string> {
  const key = nameKey(line.firstName, line.lastName);
  const { data: p, error: e1 } = await db.from('college_players').insert({
    first_name: cleanName(line.firstName), last_name: cleanName(line.lastName), display_name: displayName(line.firstName, line.lastName), name_key: key,
  }).select('id').single();
  if (e1) throw new Error(`insert boxscore-only player ${key}: ${e1.message}`);
  const { data: ps, error: e2 } = await db.from('college_player_seasons').insert({
    player_id: p.id, program_id: programId, season, jersey: line.jersey, position: normalizePosition(line.position), position_raw: line.position,
    source: 'boxscore_only', confidence: 0.5,
  }).select('id').single();
  if (e2) throw new Error(`insert boxscore-only player_season ${key}: ${e2.message}`);
  return ps.id as string;
}

export async function writeSiteSeasonStats(db: Db, programId: string, season: number, stats: SeasonStats, candidates: StatLineCandidate[]): Promise<{ written: number; unmatched: number }> {
  let written = 0, unmatched = 0;
  const rows: Record<string, unknown>[] = [];
  for (const l of stats.players) {
    const { firstName, lastName } = splitName(l.name);
    const m = matchStatLine({ ...emptyLine(l.sourceKey, firstName, lastName), jersey: l.jersey }, candidates);
    if (!m) { unmatched += 1; continue; }
    rows.push({ player_season_id: m.playerSeasonId, gp: l.gp, gs: l.gs, minutes: l.minutes, goals: l.goals, assists: l.assists, points: l.points,
      shots: l.shots, sog: l.sog, yc: l.yellow, rc: l.red, gwg: l.gwg, pk_g: l.pkGoals, pk_a: l.pkAttempts, ga: l.goalsAllowed, saves: l.saves, shutouts: l.shutouts, fetched_at: new Date().toISOString() });
  }
  if (rows.length) written = await upsertChunked(db, 'college_site_season_stats', rows, { onConflict: 'player_season_id' });
  return { written, unmatched };
}

function emptyLine(sourceKey: string, firstName: string, lastName: string): PlayerStatLine {
  return { sourceKey, firstName, lastName, jersey: null, position: null, starter: false, participated: true, minutes: null, goals: null, assists: null, points: null,
    shots: null, sog: null, shotsOffTarget: null, pkGoals: null, pkAttempts: null, fouls: null, yellow: null, red: null, green: null, corners: null, offsides: null,
    isGoalie: false, goalsAllowed: null, saves: null, gkMinutes: null, gwg: null, unassistedGoals: null, firstGoals: null, otGoals: null, emptyNetGoals: null,
    tyingGoals: null, shootoutGoals: null, hatTrick: false };
}

// ---------- games ----------
export async function listGames(db: Db, season: number, filter?: (q: any) => any): Promise<GameRow[]> {
  return selectAll<GameRow>(db, 'college_games', '*', (q) => { q = q.eq('season', season); return filter ? filter(q) : q; });
}

export async function upsertGameByNcaa(db: Db, row: Record<string, unknown> & { ncaa_contest_id: number }): Promise<GameRow> {
  const { data, error } = await db.from('college_games').upsert(row, { onConflict: 'ncaa_contest_id' }).select('*').single();
  if (error) throw new Error(`upsert game ncaa ${row.ncaa_contest_id}: ${error.message}`);
  return data as GameRow;
}

export async function insertGame(db: Db, row: Record<string, unknown>): Promise<GameRow> {
  const { data, error } = await db.from('college_games').insert(row).select('*').single();
  if (error) throw new Error(`insert game: ${error.message}`);
  return data as GameRow;
}

export async function updateGame(db: Db, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('college_games').update(patch).eq('id', id);
  if (error) throw new Error(`update game ${id}: ${error.message}`);
}

export interface BoxScoreWrite {
  gameId: string;
  source: 'site' | 'ncaa';
  homeProgramId: string | null;
  awayProgramId: string | null;
  box: BoxScore;
  /** roster candidates per program id for player matching */
  candidates: Map<string, StatLineCandidate[]>;
  season: number;
  /** create boxscore_only player_seasons for unmatched lines (site source = tenant's own team only) */
  createMissing: boolean;
}

export interface BoxScoreWriteResult { teamRows: number; playerRows: number; events: number; unmatched: number; createdPlayers: number; valid: boolean; problems: string[] }

/** Persist one box score (team stats, player stats, events, raw) under its source label and update the game header. */
export async function writeBoxScore(db: Db, w: BoxScoreWrite): Promise<BoxScoreWriteResult> {
  const { box, gameId, source } = w;
  const problems: string[] = [];
  const teamRows: Record<string, unknown>[] = [];
  const playerRows: Record<string, unknown>[] = [];
  let unmatched = 0, createdPlayers = 0;
  const sides: { team: BoxScore['home']; programId: string | null }[] = [
    { team: box.home, programId: w.homeProgramId },
    { team: box.away, programId: w.awayProgramId },
  ];
  for (const { team, programId } of sides) {
    if (!programId) { problems.push(`unresolved ${team.isHome ? 'home' : 'away'} program ${team.name}`); continue; }
    const t = team.totals;
    const oppGoals = team.isHome ? box.away.score : box.home.score;
    teamRows.push({
      game_id: gameId, program_id: programId, source, is_home: team.isHome,
      goals: t.goals ?? team.score, assists: t.assists, shots: t.shots, shots_on_goal: t.sog, shots_off_target: t.shotsOffTarget,
      corners: t.corners, fouls: t.fouls, offsides: t.offsides, saves: t.saves, yellow_cards: t.yellow, red_cards: t.red,
      pk_goals: t.pkGoals, pk_attempts: t.pkAttempts, gk_minutes: t.gkMinutes, gk_goals_allowed: t.gkGoalsAllowed, gk_saves: t.gkSaves,
      shutout: oppGoals == null ? null : oppGoals === 0, period_lines: t.periodLines.length ? t.periodLines : null,
    });
    const cands = w.candidates.get(programId) ?? [];
    const sumGoals = team.players.reduce((a, p) => a + (p.goals ?? 0), 0);
    if (team.score != null && team.players.length && sumGoals !== team.score) problems.push(`${team.name}: player goals ${sumGoals} != score ${team.score}`);
    for (const p of team.players) {
      let psId: string | null = null;
      const m = matchStatLine(p, cands);
      if (m) psId = m.playerSeasonId;
      else if (w.createMissing && (p.firstName || p.lastName)) {
        psId = await createBoxscoreOnlyPlayer(db, programId, w.season, p);
        cands.push({ playerSeasonId: psId, nameKey: nameKey(p.firstName, p.lastName), firstName: p.firstName, lastName: p.lastName, jersey: p.jersey });
        createdPlayers += 1;
      } else unmatched += 1;
      playerRows.push({
        game_id: gameId, program_id: programId, source, source_key: p.sourceKey, player_season_id: psId,
        first_name: p.firstName, last_name: p.lastName, jersey: p.jersey, position: p.position, starter: p.starter, participated: p.participated,
        minutes: p.minutes, goals: p.goals, assists: p.assists, points: p.points, shots: p.shots, shots_on_goal: p.sog, shots_off_target: p.shotsOffTarget,
        pk_goals: p.pkGoals, pk_attempts: p.pkAttempts, fouls: p.fouls, yellow_cards: p.yellow, red_cards: p.red, green_cards: p.green,
        corners: p.corners, offsides: p.offsides, is_goalie: p.isGoalie, goals_allowed: p.goalsAllowed, saves: p.saves, gk_minutes: p.gkMinutes,
        gwg: p.gwg, unassisted_goals: p.unassistedGoals, first_goals: p.firstGoals, ot_goals: p.otGoals, empty_net_goals: p.emptyNetGoals,
        tying_goals: p.tyingGoals, shootout_goals: p.shootoutGoals, hat_trick: p.hatTrick,
      });
    }
  }
  if (teamRows.length) await upsertChunked(db, 'college_game_team_stats', teamRows, { onConflict: 'game_id,program_id,source' });
  if (playerRows.length) await upsertChunked(db, 'college_game_player_stats', playerRows, { onConflict: 'game_id,program_id,source,source_key' });

  // events: replace the set for this game+source
  const nameIndex = new Map<string, string>(); // "programId|nameKey" → player_season_id
  for (const [pid, cands] of w.candidates) for (const c of cands) nameIndex.set(`${pid}|${c.nameKey}`, c.playerSeasonId);
  const sideProgram = (side: 'home' | 'away' | null) => side === 'home' ? w.homeProgramId : side === 'away' ? w.awayProgramId : null;
  const lookup = (side: 'home' | 'away' | null, raw: string | null) => {
    const pid = sideProgram(side); if (!pid || !raw) return null;
    const { firstName, lastName } = splitName(raw);
    return nameIndex.get(`${pid}|${nameKey(firstName, lastName)}`) ?? null;
  };
  await db.from('college_game_events').delete().eq('game_id', gameId).eq('source', source);
  const seen = new Set<string>();
  const eventRows = box.events.filter((e) => { const k = `${e.period}|${e.seq}`; if (seen.has(k)) return false; seen.add(k); return true; }).map((e) => ({
    game_id: gameId, source, period: e.period, clock: e.clock, clock_seconds: e.clockSeconds, seq: e.seq, program_id: sideProgram(e.side), event_type: e.type,
    player_season_id: lookup(e.side, e.playerNameRaw), player_name_raw: e.playerNameRaw, assist_player_season_id: lookup(e.side, e.assistNameRaw), assist_name_raw: e.assistNameRaw,
    home_score: e.homeScore, away_score: e.awayScore, play_text: e.text.slice(0, 500),
  }));
  if (eventRows.length) await upsertChunked(db, 'college_game_events', eventRows, { onConflict: 'game_id,source,period,seq' });
  await db.from('college_game_raw').upsert({ game_id: gameId, source, payload: stripRaw(box), fetched_at: new Date().toISOString() }, { onConflict: 'game_id,source' });

  const headerPatch: Record<string, unknown> = {
    [source === 'site' ? 'site_fetched_at' : 'ncaa_fetched_at']: new Date().toISOString(),
  };
  if (box.status === 'final') {
    Object.assign(headerPatch, { status: 'final', home_score: box.home.score, away_score: box.away.score, overtime: box.overtime, shootout: box.shootout });
  }
  if (source === 'site') {
    Object.assign(headerPatch, { attendance: box.attendance, venue_name: box.venueName, venue_city: box.venueCity, duration_min: box.durationMin,
      officials: box.officials.length ? box.officials : null, neutral_site: box.neutral, conference_game: box.conferenceGame, postseason: box.postseason, tournament: box.tournament });
  }
  await updateGame(db, gameId, headerPatch);

  const valid = teamRows.length === 2 && problems.length === 0 && box.status === 'final';
  return { teamRows: teamRows.length, playerRows: playerRows.length, events: eventRows.length, unmatched, createdPlayers, valid, problems };
}

function stripRaw(box: BoxScore): unknown {
  // Canonical payload minus nothing: it is already normalised and small (< 100 KB).
  return box;
}

export async function setSourceOfTruth(db: Db, gameId: string, source: 'site' | 'ncaa' | null): Promise<void> {
  await updateGame(db, gameId, { source_of_truth: source });
}

export async function refreshAggregates(db: Db, season: number, programId: string | null = null): Promise<unknown> {
  const { data, error } = await db.rpc('college_refresh_season_aggregates', { p_season: season, p_program: programId });
  if (error) throw new Error(`refresh aggregates: ${error.message}`);
  return data;
}

// ---------- schedule → games ----------
export interface ScheduleWriteInput {
  programId: string; season: number; gender: Gender; division: Division | null; host: string;
  entries: ScheduleEntry[];
  resolveOpponent: (name: string) => Promise<string | null>;
  existing: GameRow[];
}

export async function writeSchedule(db: Db, input: ScheduleWriteInput): Promise<{ created: number; updated: number; unresolvedOpponents: string[]; gameIds: Map<string, string> }> {
  let created = 0, updated = 0;
  const unresolved: string[] = [];
  const gameIds = new Map<string, string>(); // entry boxScoreUrl|date → game id
  const { findGame } = await import('../identity/gameMatch.js');
  for (const e of input.entries) {
    if (e.isExhibition) continue;
    const oppId = await input.resolveOpponent(e.opponentName);
    if (!oppId) unresolved.push(e.opponentName);
    const isHome = e.homeAway === 'H';
    const home = isHome ? input.programId : oppId;
    const away = isHome ? oppId : input.programId;
    let game = oppId ? findGame(input.existing, e.date, input.programId, oppId) : null;
    // A row created earlier for this fixture while the opponent was still unresolved (one side null): adopt it.
    if (!game) {
      const orphan = input.existing.find((g) => g.game_date === e.date && (isHome ? g.home_program_id === input.programId && g.away_program_id == null : g.away_program_id === input.programId && g.home_program_id == null));
      if (orphan) { game = orphan; if (oppId) { await updateGame(db, orphan.id, isHome ? { away_program_id: oppId } : { home_program_id: oppId }); if (isHome) orphan.away_program_id = oppId; else orphan.home_program_id = oppId; } }
    }
    const status = e.state === 'final' ? 'final' : e.state;
    const refs = { [input.host]: e.boxScoreUrl ?? '' };
    const homeScore = e.result ? (isHome ? e.result.teamScore : e.result.opponentScore) : null;
    const awayScore = e.result ? (isHome ? e.result.opponentScore : e.result.teamScore) : null;
    if (game) {
      const patch: Record<string, unknown> = { site_game_refs: { ...(game.site_game_refs ?? {}), ...(e.boxScoreUrl ? refs : {}) } };
      if (game.status !== 'final' && status) patch.status = status;
      if (game.home_score == null && homeScore != null) { patch.home_score = homeScore; patch.away_score = awayScore; }
      if (e.homeAway === 'N') patch.neutral_site = true;
      if (e.isConference) patch.conference_game = true;
      if (e.attendance != null) patch.attendance = e.attendance;
      await updateGame(db, game.id, patch);
      updated += 1;
    } else {
      game = await insertGame(db, {
        season: input.season, game_date: e.date, gender: input.gender, division: input.division,
        home_program_id: home, away_program_id: away, home_name: isHome ? null : e.opponentName, away_name: isHome ? e.opponentName : null,
        home_score: homeScore, away_score: awayScore, status: status ?? 'scheduled', neutral_site: e.homeAway === 'N', conference_game: e.isConference,
        tournament: e.tournament, attendance: e.attendance, site_game_refs: e.boxScoreUrl ? refs : {},
      });
      input.existing.push(game);
      created += 1;
    }
    gameIds.set(`${e.boxScoreUrl ?? ''}|${e.date}`, game.id);
  }
  return { created, updated, unresolvedOpponents: [...new Set(unresolved)], gameIds };
}

/**
 * After a roster sync: box-score-only identities created earlier for this program-season (e.g. from an
 * NCAA.com game fetched before the roster existed, or NCAA-style full legal names) are re-matched against
 * the roster; matches have their game lines repointed and the placeholder identity removed.
 */
export async function mergeBoxscoreOnly(db: Db, programId: string, season: number): Promise<{ merged: number; kept: number }> {
  const rows = await selectAll<any>(db, 'college_player_seasons', 'id,player_id,jersey,source,college_players!inner(first_name,last_name,name_key)', (q) => q.eq('program_id', programId).eq('season', season));
  const roster: StatLineCandidate[] = rows.filter((r) => r.source !== 'boxscore_only').map((r) => ({ playerSeasonId: r.id, nameKey: r.college_players.name_key, firstName: r.college_players.first_name, lastName: r.college_players.last_name, jersey: r.jersey }));
  let merged = 0, kept = 0;
  for (const o of rows.filter((r) => r.source === 'boxscore_only')) {
    const line = { ...emptyLine(o.id, o.college_players.first_name, o.college_players.last_name), jersey: o.jersey };
    const m = matchStatLine(line, roster);
    if (!m) { kept += 1; continue; }
    const tables: [string, string][] = [['college_game_player_stats', 'player_season_id'], ['college_game_events', 'player_season_id'], ['college_game_events', 'assist_player_season_id'], ['college_player_honors', 'player_season_id']];
    for (const [t, col] of tables) { const { error } = await db.from(t).update({ [col]: m.playerSeasonId }).eq(col, o.id); if (error) log.warn({ t, err: error.message }, 'merge repoint failed'); }
    // Two lines for the same game/program/source may now collide on the PK only via source_key, which differs; fine.
    await db.from('college_player_season_stats').delete().eq('player_season_id', o.id);
    await db.from('college_site_season_stats').delete().eq('player_season_id', o.id);
    await db.from('college_player_seasons').delete().eq('id', o.id);
    const { count } = await db.from('college_player_seasons').select('id', { count: 'exact', head: true }).eq('player_id', o.player_id);
    if (!count) await db.from('college_players').delete().eq('id', o.player_id);
    merged += 1;
  }
  return { merged, kept };
}
