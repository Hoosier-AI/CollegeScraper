// source-map: other sources' clubs, games and players -> API-Football ids (pro_source_ids). Clubs and games per
// league (all seasons at once: a club keeps its id across seasons), then players across every league (one person can
// play in MLS and MLS Next Pro). Rows set by hand (verified / rejected) are kept; verified clubs act as aliases.
// source-check: each collected number API-Football also has, side by side (pro_source_checks), per league season.
// Sources: American Soccer Analysis (six US leagues, with players) and openfootball (MLS results by club name).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerJob, type JobContext } from '../runner.js';
import { selectAll, type Db } from '../../db/client.js';
import { replaceChecks, sourceIdMap, writeSourceIds, type SourceIdRow } from '../../db/sourceRepo.js';
import { ASA_LEAGUES } from '../../sources/asa/leagues.js';
import { type AdvPlayerSeasonRow, type SrcGameRow } from '../../sources/asa/parse.js';
import { mapGames, mapPlayer, mapTeams, type ApiPerson, type ApiFixture, type Mapped } from './mapping.js';
import { bestOf, clubScore } from '../../sources/match.js';
import { checkGame, checkPlayerSeason, checkStanding, isRegularRound, recordsFromResults, type CheckRow } from './checks.js';

/** `.in()` over many values, a few hundred at a time (the filter travels in the URL). */
async function selectIn<T>(db: Db, table: string, columns: string, column: string, values: (string | number)[], apply?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  const uniq = [...new Set(values)];
  for (let i = 0; i < uniq.length; i += 300) {
    const part = uniq.slice(i, i + 300);
    out.push(...await selectAll<T>(db, table, columns, (q) => (apply ? apply(q.in(column, part)) : q.in(column, part))));
  }
  return out;
}

function fileAliases(source: string): Record<string, number> {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const f of [resolve(here, '../../../data/pro-source-aliases.json'), resolve(process.cwd(), 'data/pro-source-aliases.json')]) {
    try { return (JSON.parse(readFileSync(f, 'utf8')) as Record<string, Record<string, number>>)[source] ?? {}; } catch { /* next */ }
  }
  return {};
}

/** The sources that are mapped and checked, and the leagues each covers. */
export const MAPPED_SOURCES: { source: string; leagues: number[]; players: boolean }[] = [
  { source: 'asa', leagues: ASA_LEAGUES.map((l) => l.league), players: true },
  { source: 'openfootball', leagues: [253], players: false },
  { source: 'wikipedia', leagues: [253, 254, 255, 256, 1118], players: false },
];
const sourcesFor = (p: Record<string, unknown>) => MAPPED_SOURCES.filter((x) => !p.source || x.source === String(p.source))
  .map((x) => ({ ...x, leagues: x.leagues.filter((l) => !Number(p.league) || l === Number(p.league)) })).filter((x) => x.leagues.length);

const asRows = (source: string, kind: SourceIdRow['kind'], m: Map<string, Mapped>): SourceIdRow[] =>
  [...m.entries()].map(([ext_id, x]) => ({ source, kind, ext_id, pro_id: x.pro_id, method: x.method, confidence: x.confidence, evidence: x.evidence ?? null }));
const count = (m: Map<string, Mapped>) => [...m.values()].filter((x) => x.pro_id != null).length;

const PERSON = 'id,first_name,last_name,display_name,birth_date';

/** params: { source?: string, league?: number } */
export async function sourceMap(ctx: JobContext): Promise<void> {
  for (const src of sourcesFor(ctx.params)) await mapSource(ctx, src.source, src.leagues, src.players);
}

async function mapSource(ctx: JobContext, SOURCE: string, leagueIds: number[], withPlayers: boolean): Promise<void> {
  const db = ctx.db;
  const verified = await selectAll<{ ext_id: string; pro_id: number }>(db, 'pro_source_ids', 'ext_id,pro_id', (q) => q.eq('source', SOURCE).eq('kind', 'team').eq('verified', true).not('pro_id', 'is', null));
  const aliases = { ...fileAliases(SOURCE), ...Object.fromEntries(verified.map((v) => [v.ext_id, Number(v.pro_id)])) };
  const teamMap = new Map<string, number>();
  const pre = (k: string) => `${SOURCE}_${k}`;

  // Clubs first, across every league: a club can play in more than one over the years (FC Cincinnati in the USL
  // Championship, then MLS), and the best match any league finds is the one kept. Then games, with every club known.
  const perLeague: { league: number; games: SrcGameRow[]; fixtures: ApiFixture[] }[] = [];
  const best = new Map<string, Mapped>();
  for (const league of leagueIds) {
    const games = await selectAll<SrcGameRow>(db, 'pro_src_games', 'ext_id,kickoff,home_ext,away_ext,season', (q) => q.eq('source', SOURCE).eq('league_id', league));
    // A source with tables only (Wikipedia): its clubs come from the tables, matched by name.
    const tableRows = await selectAll<{ team_ext: string; season: number }>(db, 'pro_src_standings', 'team_ext,season', (q) => q.eq('source', SOURCE).eq('league_id', league));
    if (!games.length && !tableRows.length) continue;
    const used = new Set([...games.flatMap((g) => [g.home_ext, g.away_ext]), ...tableRows.map((r) => r.team_ext)]);
    const srcTeams = (await selectAll<{ ext_id: string; name: string; short_name: string | null }>(db, 'pro_src_teams', 'ext_id,name,short_name', (q) => q.eq('source', SOURCE))).filter((t) => used.has(t.ext_id));
    const seasons = [...new Set([...games.map((g) => g.season), ...tableRows.map((r) => r.season)])];
    const fixtures = await selectAll<ApiFixture>(db, 'pro_fixtures', 'id,kickoff,home_team_id,away_team_id', (q) => q.eq('league_id', league).eq('source', 'api-football').gte('season', Math.min(...seasons) - 1));
    const apiTeamIds = [...new Set([...fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]),
      ...(await selectAll<{ team_id: number }>(db, 'pro_league_teams', 'team_id', (q) => q.eq('league_id', league))).map((r) => r.team_id)])];
    const apiTeams = await selectIn<{ id: number; name: string; display_name: string }>(db, 'pro_teams', 'id,name,display_name', 'id', apiTeamIds);
    // Clubs another league already matched count as known here (their games settle the rest).
    const known = Object.fromEntries([...best].filter(([, m]) => m.pro_id != null).map(([ext, m]) => [ext, m.pro_id!]));
    for (const [ext, m] of mapTeams(srcTeams, apiTeams, games, fixtures, { ...known, ...aliases })) {
      const prev = best.get(ext);
      if (!prev || (prev.pro_id == null && m.pro_id != null) || (m.pro_id != null && m.pro_id !== prev.pro_id && m.confidence > prev.confidence)) best.set(ext, m);
    }
    perLeague.push({ league, games, fixtures });
    await ctx.heartbeat();
  }
  // Clubs no league season matched (defunct sides API-Football lists by country but not in a season it has crawled):
  // the exact same name among US clubs, and only one of them.
  const open = [...best].filter(([, m]) => m.pro_id == null).map(([ext]) => ext);
  if (open.length) {
    const src = new Map((await selectIn<{ ext_id: string; name: string; league_id: number }>(db, 'pro_src_teams', 'ext_id,name,league_id', 'ext_id', open, (q) => q.eq('source', SOURCE))).map((t) => [t.ext_id, t]));
    const genders = new Map((await selectAll<{ id: number; gender: string }>(db, 'pro_leagues', 'id,gender', (q) => q.in('id', leagueIds))).map((l) => [l.id, l.gender]));
    const us = await selectAll<{ id: number; name: string; display_name: string; gender: string | null }>(db, 'pro_teams', 'id,name,display_name,gender', (q) => q.eq('country', 'USA').eq('national', false).gt('id', 0));
    for (const ext of open) {
      const t0 = src.get(ext); if (!t0) continue;
      const name = t0.name, gender = genders.get(t0.league_id) ?? 'm';
      const hit = bestOf(us.filter((t) => (t.gender ?? 'm') === gender), (t) => Math.max(clubScore(name, t.name), clubScore(name, t.display_name)) === 1 ? 1 : 0, 1);
      if (hit) best.set(ext, { pro_id: hit.item.id, method: 'name (country)', confidence: 0.85, evidence: { api_name: hit.item.name } });
    }
  }
  await writeSourceIds(db, SOURCE, 'team', asRows(SOURCE, 'team', best));
  for (const [ext, m] of best) if (m.pro_id != null) teamMap.set(ext, m.pro_id);
  ctx.inc(pre('teams_mapped'), count(best)); ctx.inc(pre('teams_unmatched'), best.size - count(best));
  for (const { games, fixtures } of perLeague) {
    const gameMap = mapGames(games, fixtures, best);
    await writeSourceIds(db, SOURCE, 'game', asRows(SOURCE, 'game', gameMap));
    ctx.inc(pre('games_mapped'), count(gameMap)); ctx.inc(pre('games_unmatched'), gameMap.size - count(gameMap));
  }
  if (!withPlayers) return;

  // Players, across every league.
  const adv = await selectIn<Pick<AdvPlayerSeasonRow, 'player_ext' | 'team_ext' | 'season' | 'league_id'>>(db, 'pro_adv_player_seasons', 'player_ext,team_ext,season,league_id', 'league_id', leagueIds, (q) => q.eq('source', SOURCE));
  if (!adv.length) return;
  const people = await selectIn<{ ext_id: string; name: string; birth_date: string | null }>(db, 'pro_src_players', 'ext_id,name,birth_date', 'ext_id', adv.map((a) => a.player_ext), (q) => q.eq('source', SOURCE));
  const byBirth = new Map<string, ApiPerson[]>();
  for (const p of await selectIn<ApiPerson>(db, 'pro_players', PERSON, 'birth_date', people.map((p) => p.birth_date).filter(Boolean) as string[])) {
    byBirth.set(p.birth_date!, [...(byBirth.get(p.birth_date!) ?? []), p]);
  }
  // Who API-Football has at each club and season, in these leagues.
  const stints = await selectIn<{ player_id: number; team_id: number; season: number }>(db, 'pro_player_season_stats', 'player_id,team_id,season', 'league_id', leagueIds);
  const atClub = new Map<string, number[]>();
  for (const s of stints) { const k = `${s.team_id}|${s.season}`; atClub.set(k, [...(atClub.get(k) ?? []), s.player_id]); }
  const persons = new Map((await selectIn<ApiPerson>(db, 'pro_players', PERSON, 'id', stints.map((s) => s.player_id))).map((p) => [p.id, p]));
  const stintsOf = new Map<string, { team: number; season: number }[]>();
  for (const a of adv) {
    const team = teamMap.get(a.team_ext);
    if (team != null) stintsOf.set(a.player_ext, [...(stintsOf.get(a.player_ext) ?? []), { team, season: a.season }]);
  }
  const players = new Map<string, Mapped>();
  for (const p of people) {
    const club = (stintsOf.get(p.ext_id) ?? []).flatMap((s) => (atClub.get(`${s.team}|${s.season}`) ?? []).map((id) => persons.get(id)).filter(Boolean) as ApiPerson[]);
    players.set(p.ext_id, mapPlayer(p, p.birth_date ? byBirth.get(p.birth_date) ?? [] : [], club));
  }
  await writeSourceIds(db, SOURCE, 'player', asRows(SOURCE, 'player', players));
  ctx.inc(pre('players_mapped'), count(players)); ctx.inc(pre('players_unmatched'), players.size - count(players));
  for (const [method, n] of Object.entries([...players.values()].reduce<Record<string, number>>((m, x) => ({ ...m, [x.method]: (m[x.method] ?? 0) + 1 }), {}))) ctx.inc(pre(`players_by_${method}`), n);
}

/** params: { source?: string, league?: number, season?: number } */
export async function sourceCheck(ctx: JobContext): Promise<void> {
  for (const src of sourcesFor(ctx.params)) await checkSource(ctx, src.source, src.leagues, src.players);
}

async function checkSource(ctx: JobContext, SOURCE: string, leagueIds: number[], withPlayers: boolean): Promise<void> {
  const db = ctx.db;
  const [teams, games, players] = await Promise.all([sourceIdMap(db, SOURCE, 'team'), sourceIdMap(db, SOURCE, 'game'), withPlayers ? sourceIdMap(db, SOURCE, 'player') : new Map<string, number>()]);
  const seasons = await selectAll<{ league_id: number; season: number }>(db, 'pro_source_seasons', 'league_id,season', (x) => {
    let q = x.eq('source', SOURCE).not('synced_at', 'is', null).in('league_id', leagueIds);
    if (Number(ctx.params.season)) q = q.eq('season', Number(ctx.params.season));
    return q;
  });
  const at = new Date().toISOString();
  const currentOf = new Map((await selectAll<{ id: number; current_season: number | null }>(db, 'pro_leagues', 'id,current_season', (q) => q.in('id', leagueIds))).map((l) => [l.id, l.current_season ?? 9999]));
  for (const { league_id: league, season } of seasons) {
    const rows: CheckRow[] = [];
    const src = await selectAll<SrcGameRow>(db, 'pro_src_games', '*', (x) => x.eq('source', SOURCE).eq('league_id', league).eq('season', season));
    const fx = new Map((await selectIn<{ id: number; home_team_id: number; away_team_id: number; home_goals: number | null; away_goals: number | null; status: string }>(db, 'pro_fixtures', 'id,home_team_id,away_team_id,home_goals,away_goals,status', 'id',
      src.map((g) => games.get(g.ext_id)).filter((x): x is number => x != null))).map((f) => [f.id, f]));
    // A season API-Football does not have at all: nothing to compare (history), not a pile of unmatched games.
    const apiHas = fx.size > 0 || (await db.from('pro_fixtures').select('id', { count: 'exact', head: true }).eq('league_id', league).eq('season', season).eq('source', 'api-football')).count;
    if (apiHas) for (const g of src) {
      const id = games.get(g.ext_id); const f = id != null ? fx.get(id) : undefined;
      // Home and away swapped only when the clubs say so (an unmatched club proves nothing).
      rows.push(...checkGame(g, f ? { ...f, swapped: teams.get(g.home_ext) === f.away_team_id } : null, at));
    }
    if (withPlayers) {
      const adv = await selectAll<AdvPlayerSeasonRow>(db, 'pro_adv_player_seasons', '*', (x) => x.eq('source', SOURCE).eq('league_id', league).eq('season', season));
      const api = await selectAll<{ player_id: number; team_id: number; minutes: number | null; goals: number | null; assists: number | null; source: string }>(db, 'pro_player_season_stats', 'player_id,team_id,minutes,goals,assists,source',
        (x) => x.eq('league_id', league).eq('season', season));
      if (api.length) {
        // The provider's own totals when it has them, else ours from its match lines.
        const totals = new Map<string, (typeof api)[number]>();
        for (const r of api) { const k = `${r.player_id}|${r.team_id}`; if (!totals.has(k) || r.source === 'provider') totals.set(k, r); }
        for (const r of adv) {
          const p = players.get(r.player_ext), t = teams.get(r.team_ext);
          const hit = p != null && t != null ? totals.get(`${p}|${t}`) : undefined;
          rows.push(...checkPlayerSeason(r, hit ? { key: `${p}|${t}`, minutes: hit.minutes, goals: hit.goals, assists: hit.assists } : null, at, season >= (currentOf.get(league) ?? 9999)));
        }
      } else ctx.inc(`${SOURCE}_player_checks_waiting_on_api`);
    }
    // Tables (Wikipedia): each club's points and matches played against API-Football's table, when it has one.
    const tables = await selectAll<{ source: string; league_id: number; season: number; group_name: string; team_ext: string; points: number | null; played: number | null }>(db, 'pro_src_standings',
      'source,league_id,season,group_name,team_ext,points,played', (x) => x.eq('source', SOURCE).eq('league_id', league).eq('season', season));
    if (tables.length) {
      const { data: seasonRow } = await db.from('pro_seasons').select('coverage').eq('league_id', league).eq('season', season).maybeSingle();
      const isApiSeason = !!seasonRow && !(seasonRow as { coverage?: { source?: string } }).coverage?.source;
      let apiTable = isApiSeason ? await selectAll<{ team_id: number; points: number | null; played: number | null }>(db, 'pro_standings', 'team_id,points,played', (x) => x.eq('league_id', league).eq('season', season).eq('source', 'api-football')) : [];
      // No table from API-Football (pre-pro leagues): its regular-season results, added up, are the comparison.
      if (isApiSeason && !apiTable.length) {
        const games = (await selectAll<{ home_team_id: number; away_team_id: number; home_goals: number | null; away_goals: number | null; round: string | null }>(db, 'pro_fixtures', 'home_team_id,away_team_id,home_goals,away_goals,round',
          (x) => x.eq('league_id', league).eq('season', season).eq('status', 'final').eq('source', 'api-football'))).filter((g) => isRegularRound(g.round));
        apiTable = [...recordsFromResults(games)].map(([team_id, r]) => ({ team_id, points: r.points, played: r.played }));
      }
      if (apiTable.length) {
        const byTeam = new Map(apiTable.map((r) => [r.team_id, r]));
        // Conference tables when there are any (an overall table repeats the same clubs).
        const groups = new Set(tables.map((r) => r.group_name));
        const main = [...groups].some((g) => /conference|division|group/i.test(g)) ? tables.filter((r) => /conference|division|group/i.test(r.group_name)) : tables.filter((r) => r.group_name === [...groups][0]);
        for (const r of main) {
          const id = teams.get(r.team_ext); const a = id != null ? byTeam.get(id) : undefined;
          rows.push(...checkStanding(r, a ? { key: String(id), points: a.points, played: a.played } : null, at));
        }
      }
    }
    await replaceChecks(db, SOURCE, league, season, rows);
    for (const st of ['agree', 'differ', 'unmatched'] as const) ctx.inc(`${SOURCE}_${st}`, rows.filter((r) => r.status === st).length);
    await ctx.heartbeat();
  }
}

registerJob('source-map', sourceMap);
registerJob('source-check', sourceCheck);
