// wikidata-sync: people from Wikipedia and Wikidata, US clubs first. The Wikipedia tables' club links (pro_src_teams.url)
// give each club's article; its squad lists the players; each player's article gives the career (senior, youth,
// college, international) and the Wikidata item, whose JSON gives birth date, height, nationality and position.
// Only /wiki/ pages and /wiki/Special:EntityData/<Q>.json, which robots.txt allows; one request a second per site
// through the shared client. Clubs are read again after 30 days, players after 90.
// wikidata-fill: matches the people to pro players (birth date and name, helped by the club's squad) and fills what
// API-Football left empty (pro_fill_from_wikidata); careers are shown from pro_src_spells by Wikidata item.
import { registerJob, type JobContext } from '../runner.js';
import { makeFetcher } from '../fetcher.js';
import { selectAll, upsertChunked } from '../../db/client.js';
import { writeSourceIds } from '../../db/sourceRepo.js';
import { parseClubPage, parsePlayerPage, parseWikidataPerson, wikidataLabel } from '../../sources/wikipedia/people.js';
import { isUsScene } from '../../sources/apiFootball/leagues.js';
import { mapPlayer, type ApiPerson } from './mapping.js';
import { selectIn } from './sourceMap.js';
import { sourcesOff } from '../../pro/sources.js';

export const WD_SOURCE = 'wikidata';
const WIKI = 'https://en.wikipedia.org/wiki';
const ENTITY = 'https://www.wikidata.org/wiki/Special:EntityData';
const CLUB_DAYS = 30, PLAYER_DAYS = 90;
const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
const get = (ctx: JobContext, url: string, accept = 'text/html') => makeFetcher(ctx.db).get(url, { accept, noStore: true, skipCache: true, attempts: 2 });

/** Every club article the Wikipedia tables link, with its league and pro club, into the queue (read times kept). */
async function seedClubs(ctx: JobContext): Promise<void> {
  const teams = await selectAll<{ ext_id: string; league_id: number; url: string }>(ctx.db, 'pro_src_teams', 'ext_id,league_id,url', (q) => q.eq('source', 'wikipedia').not('url', 'is', null));
  const ids = new Map((await selectAll<{ ext_id: string; pro_id: number }>(ctx.db, 'pro_source_ids', 'ext_id,pro_id', (q) => q.eq('source', 'wikipedia').eq('kind', 'team').not('pro_id', 'is', null).eq('rejected', false))).map((r) => [r.ext_id, r.pro_id]));
  const rows = [...new Map(teams.map((t) => [t.url, { title: t.url, league_id: t.league_id, team_ext: t.ext_id, pro_team_id: ids.get(t.ext_id) ?? null }])).values()];
  if (rows.length) await upsertChunked(ctx.db, 'pro_wiki_clubs', rows, { onConflict: 'title' });
  ctx.inc('clubs_known', rows.length);
}

/** params: { max_minutes?: number (default 9) } */
export async function wikidataSync(ctx: JobContext): Promise<void> {
  const deadline = Date.now() + (Number(ctx.params.max_minutes) || 9) * 60_000;
  await seedClubs(ctx);
  const leagues = new Map((await selectAll<{ id: number; country: string | null; priority: number }>(ctx.db, 'pro_leagues', 'id,country,priority')).map((l) => [l.id, l]));
  // US pro clubs first (MLS, NWSL, the USL pro leagues: their articles list squads; amateur clubs' rarely do), then the
  // top competitions, then everyone else, by league importance; never-read before stale; matched clubs first.
  const rank = (league: number | null) => { const l = league != null ? leagues.get(league) : undefined; return !l ? 9 : isUsScene(l.id, l.country) && l.priority < 100 ? 0 : l.priority < 100 ? 1 : isUsScene(l.id, l.country) ? 2 : 3; };
  const prio = (league: number | null) => (league != null ? leagues.get(league)?.priority ?? 9999 : 9999);
  const clubs = (await selectAll<{ title: string; league_id: number | null; pro_team_id: number | null; read_at: string | null }>(ctx.db, 'pro_wiki_clubs', 'title,league_id,pro_team_id,read_at', (q) => q.or(`read_at.is.null,read_at.lt.${ago(CLUB_DAYS)}`)))
    .sort((a, b) => rank(a.league_id) - rank(b.league_id) || Number(!!a.read_at) - Number(!!b.read_at) || Number(a.pro_team_id == null) - Number(b.pro_team_id == null) || prio(a.league_id) - prio(b.league_id));

  // Clubs first (one request each opens a whole squad), until a few hundred players are waiting or a third of the
  // time is gone; then players until the time is up.
  const { count: waiting } = await ctx.db.from('pro_wiki_players').select('title', { count: 'exact', head: true }).is('read_at', null);
  let queued = waiting ?? 0;
  const clubDeadline = Date.now() + (deadline - Date.now()) / 3;
  for (const c of clubs) {
    if (queued >= 400 || Date.now() > clubDeadline || (await ctx.cancelled())) break;
    try {
      const page = parseClubPage((await get(ctx, `${WIKI}/${c.title}`)).text);
      const at = new Date().toISOString();
      await upsertChunked(ctx.db, 'pro_wiki_clubs', [{ title: c.title, qid: page.qid, players: page.players.length, read_at: at, last_error: null, updated_at: at }], { onConflict: 'title' });
      if (page.players.length) await upsertChunked(ctx.db, 'pro_wiki_players', page.players.map((p) => ({ title: p.title, club_title: c.title, updated_at: at })), { onConflict: 'title' });
      ctx.inc('clubs_read'); ctx.inc('squad_players', page.players.length);
      queued += page.players.length;
    } catch (err) {
      ctx.inc('errors');
      await upsertChunked(ctx.db, 'pro_wiki_clubs', [{ title: c.title, read_at: new Date().toISOString(), last_error: String(err instanceof Error ? err.message : err).slice(0, 300) }], { onConflict: 'title' });
    }
    await ctx.heartbeat();
  }

  const labels = new Map((await selectAll<{ qid: string; label: string | null }>(ctx.db, 'pro_wikidata_labels', 'qid,label')).map((l) => [l.qid, l.label]));
  const label = async (qid: string | undefined): Promise<string | null> => {
    if (!qid) return null;
    if (labels.has(qid)) return labels.get(qid) ?? null;
    const l = wikidataLabel(JSON.parse((await get(ctx, `${ENTITY}/${qid}.json`, 'application/json')).text), qid);
    labels.set(qid, l);
    await upsertChunked(ctx.db, 'pro_wikidata_labels', [{ qid, label: l, fetched_at: new Date().toISOString() }], { onConflict: 'qid' });
    return l;
  };

  const readPlayer = async (p: { title: string; club_title: string | null }) => {
    const at = new Date().toISOString();
    try {
      const page = parsePlayerPage((await get(ctx, `${WIKI}/${p.title}`)).text);
      if (!page.qid) throw new Error('no Wikidata item on the page');
      const wd = parseWikidataPerson(JSON.parse((await get(ctx, `${ENTITY}/${page.qid}.json`, 'application/json')).text), page.qid);
      const nationality = await label(wd.citizenship[0]);
      const position = page.position ?? (await label(wd.positions[0]));
      await upsertChunked(ctx.db, 'pro_src_players', [{
        source: WD_SOURCE, ext_id: page.qid, name: page.name ?? wd.label ?? decodeURIComponent(p.title).replace(/_/g, ' ').replace(/\s*\(.*\)$/, ''),
        birth_date: wd.birth_date ?? page.birth_date, height_cm: wd.height_cm ?? page.height_cm, weight_kg: null, nationality, position,
        birth_place: page.birth_place, wiki_title: p.title, club_title: p.club_title, number: page.number, seasons: [], updated_at: at,
      }], { onConflict: 'source,ext_id' });
      await ctx.db.from('pro_src_spells').delete().eq('qid', page.qid);
      if (page.careers.length) await upsertChunked(ctx.db, 'pro_src_spells', page.careers.map((c) => ({ qid: page.qid, ...c, updated_at: at })), { onConflict: 'qid,kind,seq' });
      await upsertChunked(ctx.db, 'pro_wiki_players', [{ title: p.title, qid: page.qid, read_at: at, last_error: null, updated_at: at }], { onConflict: 'title' });
      ctx.inc('players_read'); ctx.inc('career_rows', page.careers.length);
    } catch (err) {
      ctx.inc('player_errors');
      await upsertChunked(ctx.db, 'pro_wiki_players', [{ title: p.title, read_at: at, last_error: String(err instanceof Error ? err.message : err).slice(0, 300), updated_at: at }], { onConflict: 'title' });
    }
  };

  // Players four at a time: the article (Wikipedia) and the item (Wikidata) are on different sites, each paced on its own.
  while (Date.now() < deadline - 20_000) {
    if (await ctx.cancelled()) return;
    const { data } = await ctx.db.from('pro_wiki_players').select('title,club_title').or(`read_at.is.null,read_at.lt.${ago(PLAYER_DAYS)}`).order('read_at', { ascending: true, nullsFirst: true }).limit(40);
    const batch = (data ?? []) as { title: string; club_title: string | null }[];
    if (!batch.length) { ctx.note('idle', 'every player read'); break; }
    for (let i = 0; i < batch.length && Date.now() < deadline - 20_000; i += 4) {
      await Promise.all(batch.slice(i, i + 4).map(readPlayer));
      await ctx.heartbeat();
    }
  }
}

/** Matches Wikidata people to pro players and fills what API-Football left empty. */
export async function wikidataFill(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  if ((await sourcesOff(db)).has(WD_SOURCE)) { ctx.note('idle', 'Wikidata is switched off in the hub'); return; }
  const people = await selectAll<{ ext_id: string; name: string; birth_date: string | null; club_title: string | null }>(db, 'pro_src_players', 'ext_id,name,birth_date,club_title', (q) => q.eq('source', WD_SOURCE));
  if (!people.length) { ctx.note('idle', 'no people read yet'); return; }
  const PERSON = 'id,first_name,last_name,display_name,birth_date';
  const byBirth = new Map<string, ApiPerson[]>();
  for (const p of await selectIn<ApiPerson>(db, 'pro_players', PERSON, 'birth_date', [...new Set(people.map((p) => p.birth_date).filter(Boolean) as string[])])) {
    byBirth.set(p.birth_date!, [...(byBirth.get(p.birth_date!) ?? []), p]);
  }
  // The club's current squad on API-Football's side helps when a birth date is missing or shared.
  const clubTeam = new Map((await selectAll<{ title: string; pro_team_id: number | null }>(db, 'pro_wiki_clubs', 'title,pro_team_id', (q) => q.not('pro_team_id', 'is', null))).map((c) => [c.title, c.pro_team_id!]));
  const squads = await selectIn<{ team_id: number; player_id: number }>(db, 'pro_squads', 'team_id,player_id', 'team_id', [...new Set(clubTeam.values())]);
  const persons = new Map((await selectIn<ApiPerson>(db, 'pro_players', PERSON, 'id', [...new Set(squads.map((s) => s.player_id))])).map((p) => [p.id, p]));
  const squadOf = new Map<number, ApiPerson[]>();
  for (const s of squads) { const p = persons.get(s.player_id); if (p) squadOf.set(s.team_id, [...(squadOf.get(s.team_id) ?? []), p]); }
  const rows = people.map((p) => {
    const team = p.club_title ? clubTeam.get(p.club_title) : undefined;
    const m = mapPlayer(p, p.birth_date ? byBirth.get(p.birth_date) ?? [] : [], team != null ? squadOf.get(team) ?? [] : []);
    return { source: WD_SOURCE, kind: 'player' as const, ext_id: p.ext_id, pro_id: m.pro_id, method: m.method, confidence: m.confidence, evidence: m.evidence ?? null };
  });
  await writeSourceIds(db, WD_SOURCE, 'player', rows);
  const matched = rows.filter((r) => r.pro_id != null).length;
  ctx.inc('players_matched', matched); ctx.inc('players_unmatched', rows.length - matched);
  const { data, error } = await db.rpc('pro_fill_from_wikidata');
  if (error) throw new Error(`wikidata fill: ${error.message}`);
  ctx.inc('players_filled', Number(data) || 0);
}

registerJob('wikidata-sync', wikidataSync);
registerJob('wikidata-fill', wikidataFill);
