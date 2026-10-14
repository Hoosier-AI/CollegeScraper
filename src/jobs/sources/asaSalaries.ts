// asa-salaries: MLS salaries, the MLS Players Association releases (base salary and guaranteed compensation, about
// twice a season) as American Soccer Analysis serves them (/mls/players/salaries; ASA has none for the NWSL or USL).
// One request per season: every season once, then the current and last season each run. Players and clubs map to
// ours through pro_source_ids (the asa-sync job's matches). No API-Football requests.
import { registerJob, type JobContext } from '../runner.js';
import { makeFetcher } from '../fetcher.js';
import { kvGet, kvSet, selectIn, upsertChunked } from '../../db/client.js';
import { leagueIndex } from '../../db/proRepo.js';
import { AsaClient } from '../../sources/asa/client.js';
import { parseSalaries, SOURCE, type AsaSalary } from '../../sources/asa/parse.js';
import { sourcesOff } from '../../pro/sources.js';
import { samePerson } from '../../pro/queries.js';
import { log } from '../../log.js';

const MLS = 253;
const FIRST = 2013;
const DONE_KEY = 'asa:salaries:seasons';

async function proIds(ctx: JobContext, kind: 'player' | 'team', exts: string[]): Promise<Map<string, number>> {
  const rows = exts.length ? await selectIn<{ ext_id: string; pro_id: number | null; rejected: boolean }>(ctx.db, 'pro_source_ids', 'ext_id,pro_id,rejected', 'ext_id', [...new Set(exts)], (q) => q.eq('source', SOURCE).eq('kind', kind)) : [];
  return new Map(rows.filter((r) => r.pro_id != null && !r.rejected).map((r) => [r.ext_id, Number(r.pro_id)]));
}

/** ASA players API-Football did not know when asa-fill met them got a negative-id copy of their own; API-Football
 *  has most of them now under a positive id, which is the page people open. A salary goes to that player: the same
 *  person (name and birth date) among positive ids, the one who played most recently when there are several
 *  (2026-10-14: half the MLS salaries sat on copies, so Walker Zimmerman's page showed none). */
const words = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
/** Same birth date is required by the caller. Beyond samePerson: nicknames and long surnames, as rosters and ASA write
 *  them differently ("Matt Turner" / "Matthew Turner", "Shaq Moore" / "Shaquell Moore", "Nico Fernández" /
 *  "Nicolás Fernández Mercau"): a surname word in common and first names where one begins like the other. */
function sameMlsPlayer(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (x.length < 2 || y.length < 2) return false;
  const lastX = x.slice(1).filter((w) => w.length >= 3), lastY = new Set(y.slice(1).filter((w) => w.length >= 3));
  if (!lastX.some((w) => lastY.has(w))) return false;
  const f = x[0]!, g = y[0]!, k = Math.min(3, f.length, g.length);
  return f === g || f.startsWith(g) || g.startsWith(f) || (k >= 3 && f.slice(0, k) === g.slice(0, k));
}

/** "A. Resch" and "Alexander Resch": the same surname, one first name the other's initial. */
function sameInitial(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (x.length < 2 || y.length < 2 || x[x.length - 1] !== y[y.length - 1]) return false;
  return x[0]![0] === y[0]![0] && (x[0]!.length === 1 || y[0]!.length === 1);
}

async function realPlayers(ctx: JobContext, ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const copies = (await selectIn<{ id: number; display_name: string; birth_date: string | null }>(ctx.db, 'pro_players', 'id,display_name,birth_date', 'id', ids)).filter((p) => p.birth_date);
  const dates = [...new Set(copies.map((p) => String(p.birth_date).slice(0, 10)))];
  const cands = dates.length ? await selectIn<{ id: number; display_name: string; birth_date: string; minutes_recent: number | null }>(ctx.db, 'pro_players', 'id,display_name,birth_date,minutes_recent', 'birth_date', dates, (q) => q.gt('id', 0)) : [];
  for (const c of copies) {
    const hit = cands.filter((p) => String(p.birth_date).slice(0, 10) === String(c.birth_date).slice(0, 10) && (samePerson({ name: c.display_name, birth_date: c.birth_date }, { name: p.display_name, birth_date: p.birth_date }) || sameMlsPlayer(c.display_name, p.display_name)))
      .sort((a, b) => (b.minutes_recent ?? 0) - (a.minutes_recent ?? 0))[0];
    if (hit) out.set(c.id, hit.id);
  }
  return out;
}

/** params: { season?: number, all?: boolean } */
export async function asaSalaries(ctx: JobContext): Promise<void> {
  if ((await sourcesOff(ctx.db)).has(SOURCE)) { ctx.note('skipped', 'American Soccer Analysis is switched off'); return; }
  const asa = new AsaClient(makeFetcher(ctx.db));
  const current = (await leagueIndex(ctx.db)).get(MLS)?.current_season ?? new Date().getUTCFullYear();
  const done = new Set((await kvGet<number[]>(ctx.db, DONE_KEY)) ?? []);
  const only = Number(ctx.params.season) || null;
  const seasons = only ? [only] : [current, current - 1, ...Array.from({ length: current - 1 - FIRST }, (_, i) => current - 2 - i).filter((s) => ctx.params.all || !done.has(s))];
  for (const season of seasons) {
    if (await ctx.cancelled()) break;
    try {
      const rows = parseSalaries(await asa.get<AsaSalary>('mls/players/salaries', { season_name: season }), MLS);
      const [players, teams] = await Promise.all([proIds(ctx, 'player', rows.map((r) => r.player_ext)), proIds(ctx, 'team', rows.map((r) => r.team_ext).filter(Boolean))]);
      const real = await realPlayers(ctx, [...new Set([...players.values()].filter((id) => id < 0))]);
      const pid = (ext: string) => { const id = players.get(ext); return id == null ? null : real.get(id) ?? id; };
      const withIds = rows.map((r) => ({ ...r, player_id: pid(r.player_ext), team_id: teams.get(r.team_ext) ?? null }));
      // Still not on a player with MLS minutes that season (a copy, or a second record under another first name:
      // "JT"/"James" Marcinkowski, "Kévin"/"Ahoueke" Denkey): the MLS player that season with the same surname and birth
      // date (or the very same full name), else (no birth date) the same name at the same club. Only a single match
      // counts.
      const squad = await selectIn<{ player_id: number; team_id: number }>(ctx.db, 'pro_player_season_stats', 'player_id,team_id', 'league_id', [MLS], (q) => q.eq('season', season).gt('player_id', 0).gt('apps', 0));
      const inSquad = new Set(squad.map((x) => x.player_id));
      const loose = withIds.filter((r) => r.player_id == null || !inSquad.has(r.player_id));
      if (loose.length) {
        const people = new Map((await selectIn<{ id: number; display_name: string; birth_date: string | null }>(ctx.db, 'pro_players', 'id,display_name,birth_date', 'id', [...new Set([...inSquad, ...loose.map((r) => r.player_id).filter((x): x is number => x != null)])])).map((p) => [p.id, p]));
        const surnames = (n: string) => words(n).slice(1).filter((w) => w.length >= 3);
        for (const r of loose) {
          const me = r.player_id != null ? people.get(r.player_id) : null;
          if (!me) continue;
          const bd = me.birth_date ? String(me.birth_date).slice(0, 10) : null, mine = surnames(me.display_name);
          const hits = [...inSquad].filter((id) => {
            const o = people.get(id); if (!o) return false;
            const theirs = new Set(surnames(o.display_name)); const shared = mine.some((w) => theirs.has(w));
            // The very same full name in the same MLS season is the same man even when one record's birth date is off.
            if (words(o.display_name).join(' ') === words(me.display_name).join(' ')) return true;
            if (bd && o.birth_date) return String(o.birth_date).slice(0, 10) === bd && shared;
            return squad.some((x) => x.player_id === id && x.team_id === r.team_id) && (sameMlsPlayer(me.display_name, o.display_name) || sameInitial(me.display_name, o.display_name));
          });
          if (hits.length === 1) { r.player_id = hits[0]!; ctx.inc('matched_by_name'); }
        }
      }
      ctx.inc('moved_from_copies', withIds.filter((r) => r.player_id != null && r.player_id > 0 && (players.get(r.player_ext) ?? 0) < 0).length);
      ctx.inc('rows', await upsertChunked(ctx.db, 'pro_salaries', withIds, { onConflict: 'source,player_ext,season,release_date,team_ext' }));
      ctx.inc('matched', withIds.filter((r) => r.player_id != null).length);
      done.add(season);
      ctx.inc('seasons');
    } catch (err) {
      ctx.inc('errors');
      log.warn({ season, err: String(err) }, 'asa salaries failed');
    }
    await ctx.heartbeat();
  }
  await kvSet(ctx.db, DONE_KEY, [...done].sort());
  ctx.inc('asa_calls', asa.calls);
}

registerJob('asa-salaries', asaSalaries);
