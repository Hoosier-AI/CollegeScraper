// The International section's jobs (national-team football), on the sources lanes, never on API-Football's quota:
//   intl-refresh       which pro_teams are national teams (pro_refresh_intl_teams, migration 163)
//   intl-results-sync  martj42's international results (CC0): every men's international since 1872, scorers, shoot-outs
//   intl-wcdb-sync     the Fjelstul World Cup Database (CC BY-SA): men's and women's World Cups, goals, every squad
//   intl-wc-sync       openfootball's World Cups (CC0): a second source for the World Cup results
//   intl-caps-sync     caps and international goals from the Wikipedia careers wikidata-sync already reads (no requests)
//   intl-match         nations onto their pro_teams sides, results onto API-Football fixtures, squads onto players
//   intl-elo           Plaibook Elo from every result (the World Football Elo method; see sources/intl/elo.ts)
// A file is only written when it changed (its hash is kept in college_kv), so a daily run costs a few requests.
import { createHash } from 'node:crypto';
import { registerJob, type JobContext } from '../runner.js';
import { makeFetcher } from '../fetcher.js';
import { HttpError } from '../../http/client.js';
import { kvGet, kvSet, selectAll, upsertChunked, type Db } from '../../db/client.js';
import { sourcesOff } from '../../pro/sources.js';
import { samePerson } from '../../pro/queries.js';
import * as intl from '../../pro/intl.js';
import { applyShootouts, NON_FIFA_TOURNAMENT, parseGoals, parseResults, parseShootouts, RESULTS_BASE, RESULTS_SOURCE, type IntlGoalRow, type IntlMatchRow } from '../../sources/intl/results.js';
import { parseWcdbGoals, parseWcdbMatches, parseWcdbSquads, WCDB_BASE, WCDB_SOURCE, wcdbCodes } from '../../sources/intl/worldcupDb.js';
import { parseWorldCupTxt, WC_FOLDERS, WC_TXT_BASE, WC_TXT_SOURCE } from '../../sources/intl/worldcupTxt.js';
import { canonicalNation, isSeniorSide, nationKey } from '../../sources/intl/nations.js';
import { runElo } from '../../sources/intl/elo.js';

const hash = (s: string) => createHash('sha1').update(s).digest('hex');

/** A file's text, or null when the source does not have it (404). */
async function download(ctx: JobContext, url: string): Promise<string | null> {
  try {
    return (await makeFetcher(ctx.db).get(url, { accept: 'text/csv,text/plain', noStore: true, skipCache: true, attempts: 3 })).text;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

/** Whether these files are the ones already stored (force reads them anyway), and how to remember them. */
async function changed(ctx: JobContext, name: string, texts: (string | null | undefined)[]) {
  const h = hash(texts.map((t) => t ?? '').join('\u0000'));
  const key = `intl:hash:${name}`;
  const prev = await kvGet<string>(ctx.db, key);
  return { changed: prev !== h || !!ctx.params.force, save: () => kvSet(ctx.db, key, h) };
}

/** A source's results, replacing what it had (a corrected date or side leaves no stale row). A download that lost
 *  more than 5% of the stored rows is refused: a broken file must not delete history. */
async function replaceMatches(db: Db, source: string, rows: IntlMatchRow[]): Promise<number> {
  const { count } = await db.from('intl_src_matches').select('*', { count: 'exact', head: true }).eq('source', source);
  if (count && rows.length < count * 0.95) throw new Error(`${source}: ${rows.length} results, ${count} stored; not replacing`);
  const at = new Date().toISOString();
  const n = await upsertChunked(db, 'intl_src_matches', rows.map((r) => ({ ...r, updated_at: at })), { onConflict: 'source,gender,date,home,away', chunk: 1000 });
  const { error } = await db.from('intl_src_matches').delete().eq('source', source).lt('updated_at', at);
  if (error) throw new Error(`intl_src_matches stale rows: ${error.message}`);
  return n;
}

async function replaceGoals(db: Db, source: string, rows: IntlGoalRow[]): Promise<number> {
  const { error } = await db.from('intl_src_goals').delete().eq('source', source);
  if (error) throw new Error(`intl_src_goals: ${error.message}`);
  return upsertChunked(db, 'intl_src_goals', rows as unknown as Record<string, unknown>[], { onConflict: 'source,gender,date,home,away,seq', chunk: 1000 });
}

/** Every nation a source names (first match, matches, whether it plays FIFA football), added or updated. */
async function upsertNations(db: Db, rows: IntlMatchRow[], counts: boolean): Promise<number> {
  const by = new Map<string, { key: string; name: string; first_match: string; matches: number; fifa: boolean }>();
  for (const m of rows) for (const [key, name] of [[m.home, m.home_name], [m.away, m.away_name]] as const) {
    const x = by.get(key) ?? { key, name: canonicalNation(name), first_match: m.date, matches: 0, fifa: false };
    x.matches += 1;
    if (m.date < x.first_match) x.first_match = m.date;
    // The name a nation goes by now: its latest match's.
    else x.name = canonicalNation(name);
    if (!NON_FIFA_TOURNAMENT.test(m.tournament)) x.fifa = true;
    by.set(key, x);
  }
  const at = new Date().toISOString();
  if (counts) return upsertChunked(db, 'intl_nations', [...by.values()].map((x) => ({ ...x, updated_at: at })), { onConflict: 'key' });
  // A secondary source only adds the nations the reference does not have.
  return upsertChunked(db, 'intl_nations', [...by.values()].map((x) => ({ ...x, updated_at: at })), { onConflict: 'key', ignoreDuplicates: true });
}

// ---------- intl-refresh ----------
async function intlRefresh(ctx: JobContext): Promise<void> {
  const { data, error } = await ctx.db.rpc('pro_refresh_intl_teams');
  if (error) throw new Error(`pro_refresh_intl_teams: ${error.message}`);
  ctx.inc('teams_changed', Number(data ?? 0));
}

// ---------- intl-results-sync ----------
async function intlResultsSync(ctx: JobContext): Promise<void> {
  const [results, goals, shootouts] = await Promise.all(['results', 'goalscorers', 'shootouts'].map((f) => download(ctx, `${RESULTS_BASE}/${f}.csv`)));
  if (!results) throw new Error('results.csv is missing');
  const c = await changed(ctx, 'results', [results, goals, shootouts]);
  if (!c.changed) { ctx.note('unchanged', 'files are the ones already stored'); return; }
  const matches = parseResults(results);
  if (shootouts) applyShootouts(matches, parseShootouts(shootouts));
  ctx.inc('matches', await replaceMatches(ctx.db, RESULTS_SOURCE, matches));
  if (goals) ctx.inc('goals', await replaceGoals(ctx.db, RESULTS_SOURCE, parseGoals(goals)));
  ctx.inc('nations', await upsertNations(ctx.db, matches, true));
  await c.save();
}

// ---------- intl-wcdb-sync ----------
async function intlWcdbSync(ctx: JobContext): Promise<void> {
  const [matchesText, goalsText, squadsText, playersText] = await Promise.all(['matches', 'goals', 'squads', 'players'].map((f) => download(ctx, `${WCDB_BASE}/${f}.csv`)));
  if (!matchesText) throw new Error('matches.csv is missing');
  const c = await changed(ctx, 'worldcup-db', [matchesText, goalsText, squadsText, playersText]);
  if (!c.changed) { ctx.note('unchanged', 'files are the ones already stored'); return; }
  const matches = parseWcdbMatches(matchesText);
  await upsertNations(ctx.db, matches, false);
  ctx.inc('matches', await replaceMatches(ctx.db, WCDB_SOURCE, matches));
  if (goalsText) ctx.inc('goals', await replaceGoals(ctx.db, WCDB_SOURCE, parseWcdbGoals(goalsText, matches)));
  if (squadsText && playersText) {
    const squads = parseWcdbSquads(squadsText, playersText);
    const { error } = await ctx.db.from('intl_squads').delete().eq('source', WCDB_SOURCE);
    if (error) throw new Error(`intl_squads: ${error.message}`);
    ctx.inc('squads', await upsertChunked(ctx.db, 'intl_squads', squads as unknown as Record<string, unknown>[], { onConflict: 'source,tournament,nation,ext_player', chunk: 1000 }));
  }
  // FIFA codes for the nations that have played a World Cup.
  let codes = 0;
  for (const [key, code] of wcdbCodes(matchesText)) {
    const { data } = await ctx.db.from('intl_nations').update({ fifa_code: code }).eq('key', key).is('fifa_code', null).select('key');
    codes += data?.length ?? 0;
  }
  ctx.inc('codes', codes);
  await c.save();
}

// ---------- intl-wc-sync ----------
async function intlWcSync(ctx: JobContext): Promise<void> {
  const files: (string | null)[] = [];
  for (const folder of WC_FOLDERS) for (const file of ['cup.txt', 'cup_finals.txt']) {
    if (await ctx.cancelled()) return;
    files.push(await download(ctx, `${WC_TXT_BASE}/${folder}/${file}`));
    await ctx.heartbeat();
  }
  const c = await changed(ctx, 'openfootball-wc', files);
  if (!c.changed) { ctx.note('unchanged', 'files are the ones already stored'); return; }
  const rows = files.flatMap((t) => (t ? parseWorldCupTxt(t) : []));
  // The same match listed twice (a group file and a finals file both carrying it): keep one.
  const seen = new Set<string>();
  const uniq = rows.filter((r) => { const k = `${r.date}|${r.home}|${r.away}`; return !seen.has(k) && !!seen.add(k); });
  ctx.inc('files', files.filter(Boolean).length);
  ctx.inc('matches', await replaceMatches(ctx.db, WC_TXT_SOURCE, uniq));
  await c.save();
}

// ---------- intl-caps-sync ----------
/** Caps from the Wikipedia careers wikidata-sync reads (the infobox's national-team rows): senior sides only, a
 *  nation's spells summed. Linked to the pro player through his Wikidata item. */
async function intlCapsSync(ctx: JobContext): Promise<void> {
  const off = await sourcesOff(ctx.db);
  if (off.has('wikipedia')) { ctx.note('skipped', 'wikipedia switched off'); return; }
  const [spells, nations] = await Promise.all([
    selectAll<{ qid: string; team: string; apps: number | null; goals: number | null; start_year: number | null; end_year: number | null }>(ctx.db, 'pro_src_spells', 'qid,team,apps,goals,start_year,end_year', (q) => q.eq('kind', 'international')),
    selectAll<{ key: string }>(ctx.db, 'intl_nations', 'key'),
  ]);
  const known = new Set(nations.map((n) => n.key));
  const qids = [...new Set(spells.map((s) => s.qid))];
  const people = new Map<string, { id: number; display_name: string; gender: string | null }>();
  for (let i = 0; i < qids.length; i += 200) {
    for (const p of await selectAll<{ id: number; wikidata_qid: string; display_name: string; gender: string | null }>(ctx.db, 'pro_players', 'id,wikidata_qid,display_name,gender', (q) => q.in('wikidata_qid', qids.slice(i, i + 200)))) people.set(p.wikidata_qid, p);
  }
  const names = new Map<string, string>();
  for (let i = 0; i < qids.length; i += 200) {
    for (const p of await selectAll<{ ext_id: string; name: string }>(ctx.db, 'pro_src_players', 'ext_id,name', (q) => q.eq('source', 'wikidata').in('ext_id', qids.slice(i, i + 200)))) names.set(p.ext_id, p.name);
  }
  const rows = new Map<string, Record<string, unknown> & { caps: number | null; goals: number | null; first_year: number | null; last_year: number | null }>();
  let skipped = 0;
  for (const s of spells) {
    if (!isSeniorSide(s.team)) continue;
    const nation = nationKey(s.team);
    if (!known.has(nation)) { skipped += 1; continue; }
    const p = people.get(s.qid);
    const gender = /\bwomen\b/i.test(s.team) || p?.gender === 'w' ? 'w' : 'm';
    const k = `${s.qid}|${nation}`;
    const r = rows.get(k) ?? { source: 'wikipedia', person: s.qid, nation, gender, player_name: p?.display_name ?? names.get(s.qid) ?? s.qid, caps: null, goals: null, first_year: null, last_year: null, pro_player_id: p?.id ?? null };
    if (s.apps != null) r.caps = (r.caps ?? 0) + s.apps;
    if (s.goals != null) r.goals = (r.goals ?? 0) + s.goals;
    if (s.start_year != null && (r.first_year == null || s.start_year < r.first_year)) r.first_year = s.start_year;
    // An open spell ("2022-") is still running: no last year.
    if (s.end_year != null && (r.last_year == null || s.end_year > r.last_year)) r.last_year = s.end_year;
    rows.set(k, r);
  }
  const at = new Date().toISOString();
  ctx.inc('caps', await upsertChunked(ctx.db, 'intl_caps', [...rows.values()].map((r) => ({ ...r, updated_at: at })), { onConflict: 'source,person,nation', chunk: 1000 }));
  ctx.inc('unknown_sides', skipped);
  await ctx.db.from('intl_caps').delete().eq('source', 'wikipedia').lt('updated_at', at);
}

// ---------- intl-match ----------
async function intlMatch(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  // 1. Nations onto their senior sides in pro_teams (men's and women's) and their confederation.
  const [nations, teams, confed] = await Promise.all([
    selectAll<{ key: string; team_m: number | null; team_w: number | null; confederation: string | null }>(db, 'intl_nations', 'key,team_m,team_w,confederation'),
    selectAll<{ id: number; display_name: string; name: string | null; slug: string; gender: string | null; profile_synced_at: string | null }>(db, 'pro_teams', 'id,display_name,name,slug,gender,profile_synced_at', (q) => q.eq('intl', true)),
    intl.nations(db),
  ]);
  const byKey = new Map(nations.map((n) => [n.key, n]));
  const confOf = new Map(confed.map((n) => [n.id, n.confederation]));
  const pick = new Map<string, { id: number; synced: boolean }>();
  for (const t of teams) {
    if (!isSeniorSide(t.display_name) || /-u\d{2}(-|$)/.test(t.slug)) continue;
    const g = t.gender === 'w' || /-women$/.test(t.slug) ? 'w' : 'm';
    const key = [nationKey(t.display_name), t.name ? nationKey(t.name) : null].find((k) => k && byKey.has(k));
    if (!key) continue;
    const k = `${key}|${g}`, cur = pick.get(k), synced = !!t.profile_synced_at;
    // Two provider records for one nation: the one with a profile, then the older id.
    if (!cur || (synced && !cur.synced) || (synced === cur.synced && t.id < cur.id)) pick.set(k, { id: t.id, synced });
  }
  let nationsLinked = 0;
  for (const n of nations) {
    const m = pick.get(`${n.key}|m`)?.id ?? null, w = pick.get(`${n.key}|w`)?.id ?? null;
    const c = (m != null ? confOf.get(m) : null) ?? (w != null ? confOf.get(w) : null) ?? n.confederation;
    const conf = c && c !== 'Other' ? c : n.confederation;
    if (m === n.team_m && w === n.team_w && conf === n.confederation) continue;
    const { error } = await db.from('intl_nations').update({ team_m: m, team_w: w, confederation: conf }).eq('key', n.key);
    if (error) throw new Error(`intl_nations: ${error.message}`);
    nationsLinked += 1;
  }
  ctx.inc('nations_updated', nationsLinked);

  // 2. Results onto API-Football's finals (same sides, the same day or a day either side: kickoff is UTC, the
  //    sources' dates are local).
  const sideOf = new Map<number, { key: string; gender: 'm' | 'w' }>();
  for (const [k, v] of pick) { const [key, g] = k.split('|'); sideOf.set(v.id, { key: key!, gender: g as 'm' | 'w' }); }
  const leagueIds = (await selectAll<{ id: number }>(db, 'pro_leagues', 'id', (q) => q.eq('scope', 'intl'))).map((l) => l.id);
  const fixtures: { id: number; kickoff: string; home_team_id: number; away_team_id: number }[] = [];
  for (let i = 0; i < leagueIds.length; i += 40) fixtures.push(...await selectAll<any>(db, 'pro_fixtures', 'id,kickoff,home_team_id,away_team_id', (q) => q.in('league_id', leagueIds.slice(i, i + 40)).eq('status', 'final')));
  const fx = new Map<string, number>();
  let earliest = '9999';
  for (const f of fixtures) {
    const h = sideOf.get(f.home_team_id), a = sideOf.get(f.away_team_id);
    if (!h || !a || h.gender !== a.gender) continue;
    const d = f.kickoff.slice(0, 10);
    if (d < earliest) earliest = d;
    const [x, y] = [h.key, a.key].sort();
    fx.set(`${h.gender}|${d}|${x}|${y}`, f.id);
  }
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
  const src = earliest === '9999' ? [] : await selectAll<{ source: string; gender: 'm' | 'w'; date: string; home: string; away: string; pro_fixture_id: number | null }>(db, 'intl_src_matches', 'source,gender,date,home,away,pro_fixture_id', (q) => q.gte('date', shift(earliest, -1)));
  const links: { source: string; gender: string; date: string; home: string; away: string; fixture: number | null }[] = [];
  for (const m of src) {
    const [x, y] = [m.home, m.away].sort();
    const id = fx.get(`${m.gender}|${m.date}|${x}|${y}`) ?? fx.get(`${m.gender}|${shift(m.date, 1)}|${x}|${y}`) ?? fx.get(`${m.gender}|${shift(m.date, -1)}|${x}|${y}`) ?? null;
    if (id !== (m.pro_fixture_id == null ? null : Number(m.pro_fixture_id))) links.push({ source: m.source, gender: m.gender, date: m.date, home: m.home, away: m.away, fixture: id });
  }
  let linked = 0;
  for (let i = 0; i < links.length; i += 1000) {
    const { data, error } = await db.rpc('intl_set_fixture_links', { p_rows: links.slice(i, i + 1000) });
    if (error) throw new Error(`intl_set_fixture_links: ${error.message}`);
    linked += Number(data ?? 0);
  }
  ctx.inc('fixtures', fixtures.length);
  ctx.inc('results_linked', linked);

  // 3. World Cup squads onto pro players: the same birth date and the same person by name (one candidate only).
  const squads = await selectAll<{ source: string; tournament: string; nation: string; ext_player: string; player_name: string; birth_date: string }>(db, 'intl_squads', 'source,tournament,nation,ext_player,player_name,birth_date', (q) => q.not('birth_date', 'is', null).is('pro_player_id', null));
  const dates = [...new Set(squads.map((s) => s.birth_date))];
  const born = new Map<string, { id: number; display_name: string; birth_date: string }[]>();
  for (let i = 0; i < dates.length; i += 150) {
    for (const p of await selectAll<{ id: number; display_name: string; birth_date: string }>(db, 'pro_players', 'id,display_name,birth_date', (q) => q.in('birth_date', dates.slice(i, i + 150)))) {
      const d = String(p.birth_date).slice(0, 10);
      born.set(d, [...(born.get(d) ?? []), p]);
    }
    await ctx.heartbeat();
  }
  const sq: { source: string; tournament: string; nation: string; ext_player: string; player: number }[] = [];
  for (const s of squads) {
    const hits = (born.get(s.birth_date) ?? []).filter((p) => samePerson({ name: s.player_name, birth_date: s.birth_date }, { name: p.display_name, birth_date: p.birth_date }));
    if (hits.length === 1) sq.push({ source: s.source, tournament: s.tournament, nation: s.nation, ext_player: s.ext_player, player: hits[0]!.id });
  }
  let players = 0;
  for (let i = 0; i < sq.length; i += 1000) {
    const { data, error } = await db.rpc('intl_set_squad_players', { p_rows: sq.slice(i, i + 1000) });
    if (error) throw new Error(`intl_set_squad_players: ${error.message}`);
    players += Number(data ?? 0);
  }
  ctx.inc('squad_players', players);
}

// ---------- intl-elo ----------
/** Every senior result once (the best source of each match), without switched-off sources. */
export async function intlResults(db: Db, gender: 'm' | 'w', o: { nation?: string } = {}) {
  const off = await sourcesOff(db);
  const cols = 'source,gender,date,home,away,home_name,away_name,home_score,away_score,pen_home,pen_away,aet,shootout_winner,tournament,league_id,stage,city,country,neutral,pro_fixture_id';
  const rows = await selectAll<IntlMatchRow & { pro_fixture_id: number | null }>(db, 'intl_src_matches', cols, (q) => {
    let b = q.eq('gender', gender).eq('level', 'senior');
    if (o.nation) b = b.or(`home.eq.${o.nation},away.eq.${o.nation}`);
    return b.order('date');
  });
  return dedupeResults(rows.filter((r) => !off.has(r.source)));
}

export function dedupeResults<T extends { source: string; date: string; home: string; away: string }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const [x, y] = [r.home, r.away].sort();
    const k = `${r.date}|${x}|${y}`;
    const cur = best.get(k);
    if (!cur || (intl.SOURCE_RANK[r.source] ?? 9) < (intl.SOURCE_RANK[cur.source] ?? 9)) best.set(k, r);
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function intlElo(ctx: JobContext): Promise<void> {
  for (const gender of ['m', 'w'] as const) {
    const results = (await intlResults(ctx.db, gender)).filter((r) => !NON_FIFA_TOURNAMENT.test(r.tournament));
    const c = await changed(ctx, `elo-${gender}`, [JSON.stringify(results.map((r) => [r.date, r.home, r.away, r.home_score, r.away_score, r.tournament, r.neutral]))]);
    if (!c.changed) { ctx.note(`${gender}_unchanged`, 'no new results'); continue; }
    const { steps, ratings, played } = runElo(results);
    const at = new Date().toISOString();
    ctx.inc(`${gender}_steps`, await upsertChunked(ctx.db, 'intl_elo', steps.map((s) => ({ gender, nation: s.nation, date: s.date, opponent: s.opponent, rating: Math.round(s.rating * 10) / 10, delta: Math.round(s.delta * 10) / 10, tournament: s.tournament, updated_at: at })),
      { onConflict: 'gender,nation,date,opponent', chunk: 1000 }));
    await ctx.db.from('intl_elo').delete().eq('gender', gender).lt('updated_at', at);
    // Current rating, rank among FIFA sides that played in the last four years, a year's change, the best ever.
    const fifa = new Set((await selectAll<{ key: string }>(ctx.db, 'intl_nations', 'key', (q) => q.eq('fifa', true))).map((n) => n.key));
    const today = at.slice(0, 10), yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10), fourYears = new Date(Date.now() - 4 * 365 * 86400_000).toISOString().slice(0, 10);
    const then = new Map<string, number>(), best = new Map<string, { r: number; d: string }>();
    for (const s of steps) {
      if (s.date <= yearAgo) then.set(s.nation, s.rating);
      const b = best.get(s.nation);
      if (!b || s.rating > b.r) best.set(s.nation, { r: s.rating, d: s.date });
    }
    const rows = [...ratings].map(([nation, rating]) => ({ gender, nation, rating: Math.round(rating * 10) / 10, matches: played.get(nation)!.n, last_match: played.get(nation)!.last, change_1y: then.has(nation) ? Math.round((rating - then.get(nation)!) * 10) / 10 : null,
      best: Math.round(best.get(nation)!.r * 10) / 10, best_date: best.get(nation)!.d, rank: null as number | null, updated_at: at }));
    const ranked = rows.filter((r) => fifa.has(r.nation) && r.last_match >= fourYears && r.matches >= (gender === 'w' ? 10 : 20)).sort((a, b) => b.rating - a.rating);
    ranked.forEach((r, i) => { r.rank = i + 1; });
    ctx.inc(`${gender}_ranked`, ranked.length);
    await upsertChunked(ctx.db, 'intl_elo_current', rows, { onConflict: 'gender,nation' });
    await ctx.db.from('intl_elo_current').delete().eq('gender', gender).lt('updated_at', at);
    ctx.note(`${gender}_as_of`, today);
    await c.save();
  }
}

registerJob('intl-refresh', intlRefresh);
registerJob('intl-results-sync', intlResultsSync);
registerJob('intl-wcdb-sync', intlWcdbSync);
registerJob('intl-wc-sync', intlWcSync);
registerJob('intl-caps-sync', intlCapsSync);
registerJob('intl-match', intlMatch);
registerJob('intl-elo', intlElo);
