// One handler per crawl task kind (pro_crawl_tasks.kind). A handler spends API-Football requests on the backfill
// quota floor, writes through `pace` (small batches, backing off when the database is slow) and says whether the task
// finished its pass. Paged kinds resume from task.page after a stop.
//   countries                  the country list; seeds country_teams
//   country_teams:<country>    every club in a country, with its ground
//   profiles_page:<n>          250 player profiles; page 1 seeds the others
//   profile:<player id>        one profile (players first seen since the last full pass)
//   season_fixtures:<l>|<s>    every match of a league season, and which clubs play in it
//   standings:<l>|<s>          a league season's table
//   league_players:<l>|<s>     paged: the provider's season totals for every player of a league season
//   detail:<l>|<s>             events, lineups, player and team stats for its finals (20 per request)
//   squad:<team>               a club's current squad
//   transfers:<team>           every transfer of every player the club lists
//   coach:<team>               the club's coaches and their careers
//   injuries:<l>|<s>           current injuries and suspensions
//   trophies:<player>          a player's honours
//   team_stats:<l>|<s>|<team>  a club's season in one competition (teams/statistics)
//   venues:<country>           every ground in a country
//   sidelined:<player>         a player's injury, illness and suspension history
//   coach_trophies:<coach>     a coach's honours
// sidelined, trophies and coach_trophies ask for up to 20 people a request (the task plus 19 other due ones of its kind).
import type { JobContext } from '../runner.js';
import type { ApiFootball } from '../../sources/apiFootball/client.js';
import {
  parseCoaches, parseCountries, parseCountryTeams, parseInjuries, parseLeaguePlayers, parseProfile, parseProfilesPage, parseSidelined, parseSquad, parseTeamStatistics,
  parseTransfers, parseTrophies, parseVenues,
  type AfCoach, type AfCountry, type AfFixtureItem, type AfInjury, type AfLeaguePlayer, type AfProfile, type AfSquad, type AfTeamItem, type AfTeamStatistics,
  type AfTransferItem, type AfTrophy, type AfVenue,
} from '../../sources/apiFootball/parse.js';
import {
  insertTasks, markNoDetail, patchSeason, refreshAggregates, replaceInjuries, replaceSidelined, replaceSquad, replaceTrophies, upsertCoaches, upsertCountries,
  upsertLeagueTeams, upsertProfiles, upsertSeasonStats, upsertTeamProfiles, upsertTeamSeasonDetail, upsertTransfers, upsertVenues, type LeagueInfo, type TaskSeed,
} from '../../db/proRepo.js';
import { QuotaExhausted } from '../../sources/apiFootball/client.js';
import { splitByPerson } from '../../sources/apiFootball/parse.js';
import { storeFixtures } from './scoreboard.js';
import { fetchDetails, pendingDetail } from './detail.js';
import { fetchStandings } from './standings.js';

export interface TaskRow { kind: string; key: string; priority: number; every_days: number | null; page: number; pages: number | null; attempts: number; calls: number }
/** also: other tasks of the same kind this one finished too (people asked for in the same request). */
export interface TaskResult { done: boolean; page?: number; pages?: number | null; also?: string[] }

/** Database pace: halves the batch size and asks for a pause when writes get slow or fail. */
export class Pace {
  chunk = 250;
  pauseMs = 0;
  slowMs: number;
  constructor(opts: { slowMs?: number } = {}) { this.slowMs = opts.slowMs ?? 3000; }
  async write<T>(rows: number, fn: (chunk: number) => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      const out = await fn(this.chunk);
      const batches = Math.max(1, Math.ceil(rows / this.chunk));
      if ((Date.now() - started) / batches > this.slowMs) this.slow();
      return out;
    } catch (err) { this.slow(); throw err; }
  }
  slow(): void { this.chunk = Math.max(25, Math.floor(this.chunk / 2)); this.pauseMs = 60_000; }
  /** A calm stretch lets the batch size grow back. */
  calm(): void { if (this.chunk < 250) this.chunk = Math.min(250, this.chunk * 2); }
}

export interface TaskCtx { ctx: JobContext; api: ApiFootball; task: TaskRow; leagues: Map<number, LeagueInfo>; pace: Pace; deadline: number; /** Requests this run may still spend. */ callsLeft: () => number }
type Handler = (t: TaskCtx) => Promise<TaskResult>;

const pair = (key: string): [number, number] => { const [l, s] = key.split('|').map(Number); return [l!, s!]; };
const now = () => new Date().toISOString();
/** Room for at least `calls` more requests before the backfill floor and the run's deadline. */
const roomFor = (t: TaskCtx, calls = 1) => t.api.headroom('backfill') >= calls && t.callsLeft() >= calls && Date.now() < t.deadline;

/**
 * Whether the provider splits a several-id answer by person, per kind: null until a batch has told us, false after a
 * shape we cannot split (then one request per person, as before).
 */
export const batchWorks: Record<string, boolean | null> = { sidelined: null, trophies: null, coach_trophies: null };

interface PeopleKind { path: string; one: string; many: string; listKey: string; write: (t: TaskCtx, id: number, items: unknown[]) => Promise<number> }
const PEOPLE: Record<string, PeopleKind> = {
  sidelined: { path: 'sidelined', one: 'player', many: 'players', listKey: 'sidelined',
    write: (t, id, items) => replaceSidelined(t.ctx.db, id, parseSidelined(items as never[], id, now())) },
  trophies: { path: 'trophies', one: 'player', many: 'players', listKey: 'trophies',
    write: (t, id, items) => replaceTrophies(t.ctx.db, 'player', id, parseTrophies(items as AfTrophy[], 'player', id)) },
  coach_trophies: { path: 'trophies', one: 'coach', many: 'coachs', listKey: 'trophies',
    write: (t, id, items) => replaceTrophies(t.ctx.db, 'coach', id, parseTrophies(items as AfTrophy[], 'coach', id)) },
};
const BATCH = 20;

/** One person's records, asking for up to 20 due people of the kind at once when the provider allows it. */
async function people(t: TaskCtx, kind: string): Promise<TaskResult> {
  const k = PEOPLE[kind]!;
  const id = Number(t.task.key);
  let emptyBatch = false;
  if (batchWorks[kind] !== false) {
    const { data, error } = await t.ctx.db.from('pro_crawl_tasks').select('key,every_days').eq('kind', kind).lte('due_at', now()).neq('key', t.task.key)
      .order('priority').order('due_at').limit(BATCH - 1);
    if (error) throw new Error(`batch ${kind}: ${error.message}`);
    const others = ((data ?? []) as { key: string; every_days: number | null }[]).filter((r) => Number(r.key) > 0);
    if (others.length) {
      const ids = [id, ...others.map((r) => Number(r.key))];
      let items: unknown[] | null = null;
      try { items = (await t.api.get<unknown>(k.path, { [k.many]: ids.join('-') }, 'backfill')).response; }
      catch (err) {
        if (err instanceof QuotaExhausted) throw err;
        batchWorks[kind] = false;
        t.ctx.note(`${kind}_batch`, `off: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
      }
      const split = items ? splitByPerson(items, ids, k.listKey) : null;
      // An empty answer proves nothing until a batch has come back split by person.
      if (split && (items!.length > 0 || batchWorks[kind])) {
        batchWorks[kind] = true;
        let rows = 0;
        for (const [pid, list] of split) rows += await k.write(t, pid, list);
        await markDone(t, kind, others);
        t.ctx.inc(`${kind}_batched`, ids.length);
        t.ctx.inc(kind === 'sidelined' ? 'spells_out' : 'trophies', rows);
        return { done: true, also: others.map((r) => r.key) };
      }
      if (items && items.length) {
        batchWorks[kind] = false;
        t.ctx.note(`${kind}_batch`, `off: unsplittable answer (${Object.keys((items[0] ?? {}) as object).slice(0, 6).join(',')})`);
      } else if (items) emptyBatch = true;
    }
  }
  const res = await t.api.get<unknown>(k.path, { [k.one]: id }, 'backfill');
  // A batch that came back empty while one person alone has records: the provider does not batch this kind.
  if (emptyBatch && res.response.length) { batchWorks[kind] = false; t.ctx.note(`${kind}_batch`, 'off: empty batch answer'); }
  t.ctx.inc(kind === 'sidelined' ? 'spells_out' : 'trophies', await k.write(t, id, res.response));
  return { done: true };
}

/** Finish tasks answered by another task's request: same bookkeeping as the crawl loop, no requests counted. */
async function markDone(t: TaskCtx, kind: string, rows: { key: string; every_days: number | null }[]): Promise<void> {
  const at = Date.now();
  const byEvery = new Map<string, string[]>();
  for (const r of rows) { const e = r.every_days == null ? '' : String(r.every_days); byEvery.set(e, [...(byEvery.get(e) ?? []), r.key]); }
  for (const [every, keys] of byEvery) {
    const due = every ? new Date(at + Number(every) * 86400_000).toISOString() : 'infinity';
    const { error } = await t.ctx.db.from('pro_crawl_tasks').update({ page: 0, attempts: 0, last_error: null, last_done_at: new Date(at).toISOString(), due_at: due })
      .eq('kind', kind).in('key', keys);
    if (error) throw new Error(`mark ${kind} done: ${error.message}`);
  }
}

const handlers: Record<string, Handler> = {
  async countries(t) {
    const res = await t.api.get<AfCountry>('countries', {}, 'backfill');
    const rows = parseCountries(res.response);
    await t.pace.write(rows.length, () => upsertCountries(t.ctx.db, rows));
    await insertTasks(t.ctx.db, rows.map((c) => ({ kind: 'country_teams', key: c.name, priority: 5, every_days: 30 })));
    t.ctx.inc('countries', rows.length);
    return { done: true };
  },

  async country_teams(t) {
    const res = await t.api.get<AfTeamItem>('teams', { country: t.task.key }, 'backfill');
    const rows = parseCountryTeams(res.response, now());
    const grounds = parseVenues(res.response.map((r) => r.venue ?? {}), now());
    await t.pace.write(grounds.length, (chunk) => upsertVenues(t.ctx.db, grounds, chunk));
    await t.pace.write(rows.length, (chunk) => upsertTeamProfilesChunked(t, rows, chunk));
    t.ctx.inc('clubs', rows.length);
    return { done: true };
  },

  async profiles_page(t) {
    const n = Number(t.task.key);
    const res = await t.api.get<AfProfile>('players/profiles', { page: n }, 'backfill');
    const rows = parseProfilesPage(res.response, now());
    await t.pace.write(rows.length, (chunk) => upsertProfiles(t.ctx.db, rows, chunk));
    t.ctx.inc('profiles', rows.length);
    // Page 1 knows how many pages there are: queue the rest (they keep their own 30-day refresh).
    const total = Number(res.paging?.total) || 0;
    if (n === 1 && total > 1) {
      const seeds: TaskSeed[] = [];
      for (let p = 2; p <= total; p += 1) seeds.push({ kind: 'profiles_page', key: String(p), priority: 10, every_days: 30 });
      await insertTasks(t.ctx.db, seeds);
    }
    return { done: true, pages: total || null };
  },

  async profile(t) {
    const id = Number(t.task.key);
    const res = await t.api.get<AfProfile>('players/profiles', { player: id }, 'backfill');
    const p = res.response[0];
    if (p?.player?.id === id) await upsertProfiles(t.ctx.db, [parseProfile(p, now())]);
    else await t.ctx.db.from('pro_players').update({ profile_synced_at: now() }).eq('id', id);
    return { done: true };
  },

  async season_fixtures(t) {
    const [league, season] = pair(t.task.key);
    const res = await t.api.get<AfFixtureItem>('fixtures', { league, season }, 'backfill');
    const r = await t.pace.write(res.response.length, () => storeFixtures(t.ctx.db, res.response, t.leagues));
    const teams = res.response.flatMap((f) => [f.teams.home.id, f.teams.away.id]);
    await t.pace.write(teams.length, (chunk) => upsertLeagueTeams(t.ctx.db, league, season, teams, chunk));
    await patchSeason(t.ctx.db, league, season, { fixtures_synced_at: now() });
    // Club records for the season (played, won, drawn, lost, goals, home and away) from the results alone; match
    // detail adds shots, cards and the rest when it arrives.
    await refreshAggregates(t.ctx.db, league, season);
    t.ctx.inc('fixtures', r.stored);
    return { done: true };
  },

  async standings(t) {
    const [league, season] = pair(t.task.key);
    t.ctx.inc('standings_rows', await fetchStandings(t.ctx, t.api, league, season, t.leagues, 'backfill'));
    return { done: true };
  },

  async league_players(t) {
    const [league, season] = pair(t.task.key);
    let page = t.task.page + 1;
    let pages = t.task.pages ?? null;
    let wrote = 0;
    while ((pages == null || page <= pages) && roomFor(t)) {
      const res = await t.api.get<AfLeaguePlayer>('players', { league, season, page }, 'backfill');
      pages = Number(res.paging?.total) || 1;
      const { profiles, stats } = parseLeaguePlayers(res.response, league, season, now());
      await t.pace.write(profiles.length, (chunk) => upsertProfiles(t.ctx.db, profiles, chunk));
      await t.pace.write(stats.length, (chunk) => upsertSeasonStats(t.ctx.db, stats, chunk));
      await upsertLeagueTeams(t.ctx.db, league, season, stats.map((s) => s.team_id));
      wrote += stats.length;
      // Progress is saved after every page, so a stop (quota, time, a deploy) resumes here.
      await t.ctx.db.from('pro_crawl_tasks').update({ page, pages }).eq('kind', t.task.kind).eq('key', t.task.key);
      page += 1;
      await t.ctx.heartbeat();
      if (t.pace.pauseMs) break;
    }
    t.ctx.inc('season_rows', wrote);
    const done = pages != null && page > pages;
    return { done, page: done ? 0 : page - 1, pages };
  },

  async detail(t) {
    const [league, season] = pair(t.task.key);
    const { data } = await t.ctx.db.from('pro_seasons').select('coverage').eq('league_id', league).eq('season', season).maybeSingle();
    const f = (data as { coverage?: { fixtures?: { events?: boolean; lineups?: boolean; statistics_players?: boolean } } } | null)?.coverage?.fixtures;
    if (f && !(f.events || f.lineups || f.statistics_players)) { t.ctx.inc('finals_without_detail', await markNoDetail(t.ctx.db, league, season)); return { done: true }; }
    const pending = await pendingDetail(t.ctx, t.leagues, { limit: 5000, league, season });
    const affordable = Math.max(0, Math.min(t.api.headroom('backfill'), t.callsLeft(), 1e6)) * 20;
    // Detail writes are the heaviest: at most 400 matches (20 requests) per turn keeps a run inside its slot.
    const slice = pending.slice(0, Math.min(affordable, 400));
    const touched = await fetchDetails(t.ctx, t.api, slice, t.leagues, 'backfill');
    if (touched.size || slice.length) await refreshAggregates(t.ctx.db, league, season);
    return { done: pending.length <= slice.length };
  },

  async squad(t) {
    const team = Number(t.task.key);
    const res = await t.api.get<AfSquad>('players/squads', { team }, 'backfill');
    const { squad, stubs } = parseSquad(res.response, now());
    await t.pace.write(squad.length, (chunk) => replaceSquad(t.ctx.db, team, squad, stubs, chunk));
    t.ctx.inc('squad_players', squad.length);
    return { done: true };
  },

  async transfers(t) {
    const res = await t.api.get<AfTransferItem>('transfers', { team: Number(t.task.key) }, 'backfill');
    const rows = parseTransfers(res.response, now());
    await t.pace.write(rows.length, (chunk) => upsertTransfers(t.ctx.db, rows, chunk));
    t.ctx.inc('transfers', rows.length);
    return { done: true };
  },

  async coach(t) {
    const res = await t.api.get<AfCoach>('coachs', { team: Number(t.task.key) }, 'backfill');
    const { coaches, career } = parseCoaches(res.response, now());
    await t.pace.write(coaches.length + career.length, () => upsertCoaches(t.ctx.db, coaches, career));
    t.ctx.inc('coaches', coaches.length);
    return { done: true };
  },

  async injuries(t) {
    const [league, season] = pair(t.task.key);
    const res = await t.api.get<AfInjury>('injuries', { league, season }, 'backfill');
    const rows = parseInjuries(res.response);
    await t.pace.write(rows.length, () => replaceInjuries(t.ctx.db, league, season, rows));
    t.ctx.inc('injuries', rows.length);
    return { done: true };
  },

  trophies: (t) => people(t, 'trophies'),

  coach_trophies: (t) => people(t, 'coach_trophies'),

  async team_stats(t) {
    const [league, season, team] = t.task.key.split('|').map(Number) as [number, number, number];
    const res = await t.api.get<AfTeamStatistics>('teams/statistics', { league, season, team }, 'backfill');
    // One object (the client hands it back as a list of one), or an empty list when the provider has nothing.
    const row = parseTeamStatistics(res.response[0], team, league, season, now());
    if (row) await upsertTeamSeasonDetail(t.ctx.db, [row]);
    t.ctx.inc(row ? 'club_seasons' : 'club_seasons_empty');
    return { done: true };
  },

  async venues(t) {
    const res = await t.api.get<AfVenue>('venues', { country: t.task.key }, 'backfill');
    const rows = parseVenues(res.response, now());
    await t.pace.write(rows.length, (chunk) => upsertVenues(t.ctx.db, rows, chunk));
    t.ctx.inc('grounds', rows.length);
    return { done: true };
  },

  sidelined: (t) => people(t, 'sidelined'),
};

async function upsertTeamProfilesChunked(t: TaskCtx, rows: Parameters<typeof upsertTeamProfiles>[1], chunk: number): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) n += await upsertTeamProfiles(t.ctx.db, rows.slice(i, i + chunk));
  return n;
}

export const TASK_KINDS = Object.keys(handlers);
export const handlerFor = (kind: string): Handler | undefined => handlers[kind];
