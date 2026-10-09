// Reads of other sources' numbers (American Soccer Analysis) for the pro pages, through the id map onto API-Football.
// Nothing is shown unless the console switch is on (settings:pro_sources_visible) and the league season's checks
// agree with API-Football: 97% or more of the compared fields equal (agree / (agree + differ)). A player row whose
// minutes disagree with API-Football's is left out (most likely a wrong match).
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { cachedKv, KV } from '../ops/settings.js';
import { ASA_CREDIT } from '../sources/asa/leagues.js';
import { leaguesById, teamsById } from './queries.js';

const SOURCE = 'asa';
export const TRUST_AT = 0.97;
export const SOURCE_CREDIT = { ...ASA_CREDIT, label: 'Advanced stats: American Soccer Analysis' };

let trust: { at: number; rates: Map<string, number> } | null = null;

/** Agreement per league season (agree / compared), cached for 10 minutes. */
export async function agreementRates(db: Db): Promise<Map<string, number>> {
  if (trust && Date.now() - trust.at < 600_000) return trust.rates;
  const { data, error } = await db.rpc('pro_source_agreement');
  if (error) throw new Error(error.message);
  const sums = new Map<string, { agree: number; differ: number }>();
  for (const r of (data ?? []) as { source: string; league_id: number; season: number; agree: number; differ: number }[]) {
    if (r.source !== SOURCE) continue;
    const k = `${r.league_id}|${r.season}`;
    const s = sums.get(k) ?? { agree: 0, differ: 0 };
    s.agree += Number(r.agree); s.differ += Number(r.differ);
    sums.set(k, s);
  }
  const rates = new Map([...sums].filter(([, s]) => s.agree + s.differ > 0).map(([k, s]) => [k, s.agree / (s.agree + s.differ)]));
  trust = { at: Date.now(), rates };
  return rates;
}
export function forgetAgreement(): void { trust = null; }

/** Which league seasons may show another source's numbers right now (null: none at all). */
async function gate(db: Db): Promise<((league: number, season: number) => boolean) | null> {
  if (!(await cachedKv<boolean>(db, KV.proSourcesVisible, false))) return null;
  const rates = await agreementRates(db);
  return (league, season) => (rates.get(`${league}|${season}`) ?? 0) >= TRUST_AT;
}

const extsOf = async (db: Db, kind: 'team' | 'player' | 'game', proId: number): Promise<string[]> =>
  (await selectAll<{ ext_id: string }>(db, 'pro_source_ids', 'ext_id', (q) => q.eq('source', SOURCE).eq('kind', kind).eq('pro_id', proId).eq('rejected', false))).map((r) => r.ext_id);

async function proIdsOf(db: Db, kind: 'team' | 'player', exts: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(exts)];
  if (!uniq.length) return new Map();
  const out = new Map<string, number>();
  for (let i = 0; i < uniq.length; i += 300) {
    const rows = await selectAll<{ ext_id: string; pro_id: number | null; rejected: boolean }>(db, 'pro_source_ids', 'ext_id,pro_id,rejected', (q) => q.eq('source', SOURCE).eq('kind', kind).in('ext_id', uniq.slice(i, i + 300)));
    for (const r of rows) if (r.pro_id != null && !r.rejected) out.set(r.ext_id, Number(r.pro_id));
  }
  return out;
}

const n = (v: unknown): number | null => (v == null ? null : Number(v));

/** A player's advanced seasons (one row per club and competition), newest first. */
export async function playerAdvanced(db: Db, playerId: number) {
  const ok = await gate(db);
  if (!ok) return null;
  const exts = await extsOf(db, 'player', playerId);
  if (!exts.length) return null;
  const rows = await selectAll<any>(db, 'pro_adv_player_seasons', '*', (q) => q.eq('source', SOURCE).in('player_ext', exts));
  const shown = rows.filter((r) => ok(r.league_id, r.season));
  if (!shown.length) return null;
  const bad = new Set((await selectAll<{ key: string; season: number; league_id: number }>(db, 'pro_source_checks', 'key,season,league_id',
    (q) => q.eq('source', SOURCE).eq('kind', 'player_season').eq('field', 'minutes').eq('status', 'differ').in('key', shown.map((r) => `${r.player_ext}|${r.team_ext}`)))).map((c) => `${c.key}|${c.league_id}|${c.season}`));
  const kept = shown.filter((r) => !bad.has(`${r.player_ext}|${r.team_ext}|${r.league_id}|${r.season}`));
  const teamIds = await proIdsOf(db, 'team', kept.map((r) => r.team_ext));
  const [teams, leagues] = await Promise.all([teamsById(db, [...teamIds.values()]), leaguesById(db, kept.map((r) => r.league_id))]);
  return {
    credit: SOURCE_CREDIT,
    seasons: kept.map((r) => ({
      season: r.season, league: leagues.get(r.league_id) ?? null, team: teams.get(teamIds.get(r.team_ext) ?? -1) ?? null, position: r.position,
      minutes: r.minutes, shots: r.shots, shots_on: r.shots_on, goals: r.goals, xg: n(r.xg), key_passes: r.key_passes, assists: r.assists, xa: n(r.xa),
      passes: r.passes, pass_pct: n(r.pass_pct), xpass_pct: n(r.xpass_pct), passes_over_expected: n(r.passes_over_expected),
      g_plus: n(r.g_plus_total), g_plus_by_action: r.g_plus ?? null,
      keeper: r.gk_shots_faced != null ? { shots_faced: r.gk_shots_faced, goals_conceded: r.gk_goals_conceded, saves: r.gk_saves, xg_faced: n(r.gk_xg_faced), goals_minus_xg: n(r.gk_goals_minus_xg) } : null,
    })).sort((a, b) => b.season - a.season || (b.minutes ?? 0) - (a.minutes ?? 0)),
  };
}

/** A club's advanced season, per competition. */
export async function teamAdvanced(db: Db, teamId: number, season: number | null) {
  const ok = await gate(db);
  if (!ok || season == null) return null;
  const exts = await extsOf(db, 'team', teamId);
  if (!exts.length) return null;
  const rows = (await selectAll<any>(db, 'pro_adv_team_seasons', '*', (q) => q.eq('source', SOURCE).eq('season', season).in('team_ext', exts))).filter((r) => ok(r.league_id, r.season));
  if (!rows.length) return null;
  const leagues = await leaguesById(db, rows.map((r) => r.league_id));
  return {
    credit: SOURCE_CREDIT,
    competitions: rows.map((r) => ({
      league: leagues.get(r.league_id) ?? null, games: r.games, points: r.points, xpoints: n(r.xpoints),
      shots_for: r.shots_for, shots_against: r.shots_against, xg_for: n(r.xg_for), xg_against: n(r.xg_against),
      pass_pct_for: n(r.pass_pct_for), xpass_pct_for: n(r.xpass_pct_for), pass_pct_against: n(r.pass_pct_against), xpass_pct_against: n(r.xpass_pct_against),
      g_plus_for: n(r.g_plus_for), g_plus_against: n(r.g_plus_against), g_plus_by_action: r.g_plus ?? null,
    })).sort((a, b) => (a.league?.priority ?? 999) - (b.league?.priority ?? 999)),
  };
}

/** A match's xG, attendance, referee, ground and shots, oriented to API-Football's home and away. */
export async function matchAdvanced(db: Db, fixtureId: number, homeTeamId: number) {
  const ok = await gate(db);
  if (!ok) return null;
  const [ext] = await extsOf(db, 'game', fixtureId);
  if (!ext) return null;
  const { data: g } = await db.from('pro_src_games').select('*').eq('source', SOURCE).eq('ext_id', ext).maybeSingle();
  const game = g as any;
  if (!game || !ok(game.league_id, game.season)) return null;
  const teamIds = await proIdsOf(db, 'team', [game.home_ext, game.away_ext]);
  const swapped = teamIds.get(game.home_ext) !== homeTeamId;
  const [ref, ground, shots] = await Promise.all([
    game.referee_ext ? db.from('pro_src_officials').select('name').eq('source', SOURCE).eq('role', 'referee').eq('ext_id', game.referee_ext).maybeSingle().then((r) => (r.data as any)?.name ?? null) : null,
    game.stadium_ext ? db.from('pro_src_venues').select('name,city,capacity').eq('source', SOURCE).eq('ext_id', game.stadium_ext).maybeSingle().then((r) => r.data as any) : null,
    selectAll<any>(db, 'pro_adv_shots', 'seq,period,minute,team_ext,shooter_ext,shooter_name,x,y,xg,goal,own_goal,blocked,head,pattern', (q) => q.eq('source', SOURCE).eq('game_ext', ext).order('seq')),
  ]);
  const shooters = await proIdsOf(db, 'player', shots.map((s) => s.shooter_ext).filter(Boolean));
  const slugs = new Map((shooters.size ? await selectAll<{ id: number; slug: string }>(db, 'pro_players', 'id,slug', (q) => q.in('id', [...new Set(shooters.values())])) : []).map((p) => [p.id, p.slug]));
  const homeExt = swapped ? game.away_ext : game.home_ext;
  return {
    credit: SOURCE_CREDIT,
    xg: swapped ? [n(game.away_xg), n(game.home_xg)] : [n(game.home_xg), n(game.away_xg)],
    attendance: game.attendance ?? null, referee: ref, ground: ground ? { name: ground.name, city: ground.city ?? null, capacity: ground.capacity ?? null } : null,
    shots: shots.map((s) => ({ side: s.team_ext === homeExt ? 'home' : 'away', minute: s.minute, player: s.shooter_name, slug: slugs.get(shooters.get(s.shooter_ext) ?? -1) ?? null,
      x: n(s.x), y: n(s.y), xg: n(s.xg), goal: !!s.goal, own_goal: !!s.own_goal, blocked: !!s.blocked, head: !!s.head, pattern: s.pattern })),
  };
}

/** A league season's leaders in xG, xA and goals added. */
export async function leagueAdvancedLeaders(db: Db, leagueId: number, season: number | null, limit = 10) {
  const ok = await gate(db);
  if (!ok || season == null || !ok(leagueId, season)) return null;
  const rows = await selectAll<any>(db, 'pro_adv_player_seasons', 'player_ext,team_ext,minutes,goals,assists,xg,xa,g_plus_total', (q) => q.eq('source', SOURCE).eq('league_id', leagueId).eq('season', season));
  if (!rows.length) return null;
  const top = (k: string) => [...rows].filter((r) => r[k] != null).sort((a, b) => Number(b[k]) - Number(a[k])).slice(0, limit);
  const picks = { xg: top('xg'), xa: top('xa'), g_plus: top('g_plus_total') };
  const all = [...picks.xg, ...picks.xa, ...picks.g_plus];
  const [players, teams] = await Promise.all([proIdsOf(db, 'player', all.map((r) => r.player_ext)), proIdsOf(db, 'team', all.map((r) => r.team_ext))]);
  const people = new Map((players.size ? await selectAll<any>(db, 'pro_players', 'id,display_name,slug,photo', (q) => q.in('id', [...new Set(players.values())])) : []).map((p) => [p.id, p]));
  const clubs = await teamsById(db, [...teams.values()]);
  const line = (r: any, k: string) => {
    const p = people.get(players.get(r.player_ext) ?? -1);
    return p ? { player: { name: p.display_name, slug: p.slug, photo: p.photo ?? null }, team: clubs.get(teams.get(r.team_ext) ?? -1) ?? null, minutes: r.minutes, goals: r.goals, assists: r.assists, value: Number(r[k]) } : null;
  };
  return {
    credit: SOURCE_CREDIT,
    xg: picks.xg.map((r) => line(r, 'xg')).filter(Boolean),
    xa: picks.xa.map((r) => line(r, 'xa')).filter(Boolean),
    g_plus: picks.g_plus.map((r) => line(r, 'g_plus_total')).filter(Boolean),
  };
}
