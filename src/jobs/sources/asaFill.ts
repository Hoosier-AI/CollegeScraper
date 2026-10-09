// asa-fill: American Soccer Analysis season totals into pro_player_season_stats (source 'asa') for the league seasons
// API-Football has no player totals for (USL League One and Super League always; the Championship and MLS Next Pro
// until its crawl gets there), so club squads, player pages and leaders have them. Only league seasons whose scores
// agree with API-Football (97%+ of 30 or more games), or that are history ASA filled, are used. A provider row is never
// touched (and replaces the ASA one when it arrives). Players API-Football does not know are created from ASA's
// profile (negative ids, source 'asa') and kept in the id map.
import { registerJob, type JobContext } from '../runner.js';
import { selectAll, upsertChunked } from '../../db/client.js';
import { sourceIdMap } from '../../db/sourceRepo.js';
import { ASA_LEAGUES } from '../../sources/asa/leagues.js';
import { negativeId } from './history.js';

const SOURCE = 'asa';
const TRUST = 0.97;

/** ASA's general positions as API-Football names them. */
export const POSITION: Record<string, string> = { GK: 'Goalkeeper', CB: 'Defender', FB: 'Defender', DM: 'Midfielder', CM: 'Midfielder', AM: 'Midfielder', W: 'Attacker', ST: 'Attacker' };

export interface AsaSeasonInput { minutes: number | null; games: number | null; goals: number | null; assists: number | null; shots: number | null; shots_on: number | null; key_passes: number | null; passes: number | null; pass_pct: number | null; position: string | null; gk_saves: number | null; gk_goals_conceded: number | null }

/** One ASA row as a season line: what ASA counts, nothing it does not (starts, cards, rating stay empty). */
export function seasonRowFromAsa(r: AsaSeasonInput, player: number, team: number, league: number, season: number, at = new Date().toISOString()) {
  const gk = r.position === 'GK';
  return {
    player_id: player, league_id: league, season, team_id: team, apps: r.games ?? 0, starts: null, minutes: r.minutes ?? 0, goals: r.goals ?? 0, assists: r.assists ?? 0,
    shots: r.shots, shots_on: r.shots_on, key_passes: r.key_passes, passes: r.passes, pass_accuracy: r.pass_pct != null ? Math.round(Number(r.pass_pct) * 100) : null,
    yellow: null, red: null, saves: gk ? r.gk_saves : null, conceded: gk ? r.gk_goals_conceded : null, position: r.position ? POSITION[r.position] ?? null : null,
    source: SOURCE, computed_at: at,
  };
}

export async function asaFill(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const { data, error } = await db.rpc('pro_source_agreement');
  if (error) throw new Error(error.message);
  const games = ((data ?? []) as { source: string; league_id: number; season: number; kind: string; agree: number; differ: number }[]).filter((r) => r.source === SOURCE && r.kind === 'game');
  const trusted = new Set(games.filter((r) => Number(r.agree) + Number(r.differ) >= 30 && Number(r.agree) / (Number(r.agree) + Number(r.differ)) >= TRUST).map((r) => `${r.league_id}|${r.season}`));
  // History seasons ASA itself filled (they passed the 99% gate on the seasons both have).
  for (const s of await selectAll<{ league_id: number; season: number }>(db, 'pro_seasons', 'league_id,season', (q) => q.in('league_id', ASA_LEAGUES.map((l) => l.league)).eq('coverage->>source', SOURCE))) trusted.add(`${s.league_id}|${s.season}`);
  if (!trusted.size) { ctx.note('idle', 'no league season trusted yet'); return; }

  const teams = await sourceIdMap(db, SOURCE, 'team');
  const players = await sourceIdMap(db, SOURCE, 'player');
  const leagueGender = new Map((await selectAll<{ id: number; gender: string }>(db, 'pro_leagues', 'id,gender', (q) => q.in('id', ASA_LEAGUES.map((l) => l.league)))).map((l) => [l.id, l.gender]));
  const at = new Date().toISOString();
  for (const key of trusted) {
    if (await ctx.cancelled()) return;
    const [league, season] = key.split('|').map(Number) as [number, number];
    const rows = await selectAll<any>(db, 'pro_adv_player_seasons', 'player_ext,team_ext,minutes,games,goals,assists,shots,shots_on,key_passes,passes,pass_pct,position,gk_saves,gk_goals_conceded', (q) => q.eq('source', SOURCE).eq('league_id', league).eq('season', season).gt('minutes', 0));
    if (!rows.length) continue;
    // People API-Football does not know: created from ASA's profile.
    const missing = [...new Set(rows.filter((r) => !players.has(r.player_ext) && teams.has(r.team_ext)).map((r) => r.player_ext as string))];
    if (missing.length) {
      const prof: { ext_id: string; name: string; birth_date: string | null; height_cm: number | null; weight_kg: number | null; nationality: string | null; position: string | null }[] = [];
      for (let i = 0; i < missing.length; i += 300) prof.push(...await selectAll<(typeof prof)[number]>(db, 'pro_src_players', 'ext_id,name,birth_date,height_cm,weight_kg,nationality,position', (q) => q.eq('source', SOURCE).in('ext_id', missing.slice(i, i + 300))));
      const created = prof.map((p) => ({ id: negativeId(`player|${SOURCE}|${p.ext_id}`), name: p.name, display_name: p.name, birth_date: p.birth_date, height_cm: p.height_cm, weight_kg: p.weight_kg, nationality: p.nationality,
        position: p.position ? POSITION[p.position] ?? null : null, gender: leagueGender.get(league) ?? 'm', appeared: true, source: SOURCE, updated_at: at }));
      if (created.length) {
        await upsertChunked(db, 'pro_players', created, { onConflict: 'id' });
        await upsertChunked(db, 'pro_source_ids', prof.map((p) => ({ source: SOURCE, kind: 'player', ext_id: p.ext_id, pro_id: negativeId(`player|${SOURCE}|${p.ext_id}`), method: 'created', confidence: 1, updated_at: at })), { onConflict: 'source,kind,ext_id' });
        for (const p of prof) players.set(p.ext_id, negativeId(`player|${SOURCE}|${p.ext_id}`));
        ctx.inc('players_created', created.length);
      }
    }
    const lines = rows.filter((r) => players.has(r.player_ext) && teams.has(r.team_ext)).map((r) => seasonRowFromAsa(r, players.get(r.player_ext)!, teams.get(r.team_ext)!, league, season, at));
    // One line per player and club (two ASA ids can map to one person).
    const uniq = [...new Map(lines.map((l) => [`${l.player_id}|${l.team_id}`, l])).values()];
    // Never over a provider (or match-line) row: only where API-Football has nothing for that player and club.
    const existing = new Set((await selectAll<{ player_id: number; team_id: number; source: string }>(db, 'pro_player_season_stats', 'player_id,team_id,source', (q) => q.eq('league_id', league).eq('season', season)))
      .filter((r) => r.source !== SOURCE).map((r) => `${r.player_id}|${r.team_id}`));
    const fresh = uniq.filter((l) => !existing.has(`${l.player_id}|${l.team_id}`));
    if (fresh.length) await upsertChunked(db, 'pro_player_season_stats', fresh, { onConflict: 'player_id,league_id,season,team_id' });
    // Which clubs played in the league season (squads, transfers and coaches are planned from it).
    const clubs = [...new Set(fresh.map((l) => l.team_id))].filter((t) => t > 0).map((team_id) => ({ league_id: league, season, team_id }));
    if (clubs.length) await upsertChunked(db, 'pro_league_teams', clubs, { onConflict: 'league_id,season,team_id', ignoreDuplicates: true });
    const ids = [...new Set(fresh.map((l) => l.player_id))];
    for (let i = 0; i < ids.length; i += 300) await db.from('pro_players').update({ appeared: true }).in('id', ids.slice(i, i + 300)).eq('appeared', false);
    ctx.inc('seasons'); ctx.inc('rows', fresh.length);
    await ctx.heartbeat();
  }
}

registerJob('asa-fill', asaFill);
