// News jobs (src/news): read the school, publisher, GDELT, Guardian, club and federation feeds, and turn new items into
// tagged, linked stories in the same run. The site shows the headline, the link and the feed's own picture (each
// publisher feed's pictures can be switched off in the hub).
//   news-schools   school athletics feeds (Sidearm), the due third each hour in season, daily out of it
//   news-feeds     publisher RSS, the Guardian, club and federation feeds
//   news-gdelt     one GDELT query per run (GDELT asks for one request every 5 s); the queries take turns
//   news-discover  weekly: official club and federation feeds (Wikidata P856, then the feed the home page announces)
//   news-retag     re-runs the tagging and linking rules over stored stories (after a rule change)
import PQueue from 'p-queue';
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { kvGet, kvSet, selectAll, type Db } from '../db/client.js';
import { loadConfig } from '../config.js';
import { EntityIndex, teamIndexRows } from '../news/entities.js';
import { classicSidearmFeed, ENGLISH_COUNTRIES, isSoccerItem, YOUTH_STORY, FEDERATION_SITES, GDELT_QUERIES, gdeltUrl, GUARDIAN_URL, LEAGUE_RUN, LEAGUE_RUN_IDS, LEAGUE_RUN_PAGE, PUBLISHER_FEEDS, schoolFeedUrl } from '../news/feeds.js';
import { loadRecent, prepare, store, urlHash, type NewsSource } from '../news/ingest.js';
import { feedLinks, parseFeed, parseGdelt, parseGuardian, type FeedItem } from '../news/rss.js';
import { setNewsHosts } from '../ops/sourceRequests.js';
import { sourcesOff } from '../pro/sources.js';

// The entity index takes a few seconds to build; one per process, rebuilt hourly.
let index: { at: number; ix: EntityIndex } | null = null;
async function entityIndex(db: Db): Promise<EntityIndex> {
  if (!index || Date.now() - index.at > 3600_000) index = { at: Date.now(), ix: await EntityIndex.build(db) };
  return index.ix;
}

const PUBLISHER_NAME = new Map(PUBLISHER_FEEDS.map((f) => [f.id, f.name]));
/** The outlet a story's link belongs to: the feed's own name for publisher feeds, else the site's host. */
function publisherFor(src: NewsSource) {
  return (url: string) => {
    if (src.kind === 'publisher') return PUBLISHER_NAME.get(src.id) ?? src.name;
    if (src.kind === 'guardian') return 'The Guardian';
    if (src.kind === 'school' || src.kind === 'club' || src.kind === 'federation') return src.name;
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return src.name; }
  };
}

const SRC_COLS = 'id,kind,name,url,scope,gender,program_id,pro_team_id,link_label,link_href,fails,items';

/** Publisher, GDELT and Guardian sources exist (a new one starts in its default state; the hub's switch decides after). */
async function seedSources(db: Db): Promise<void> {
  const rows = [
    ...PUBLISHER_FEEDS.map((f) => ({ id: f.id, kind: 'publisher', name: f.name, url: f.url, scope: f.scope, gender: f.gender ?? null, enabled: f.on, terms_url: f.termsUrl })),
    ...GDELT_QUERIES.map((q) => ({ id: q.id, kind: 'gdelt', name: `GDELT: ${q.name}`, url: gdeltUrl(q.query), scope: q.scope, gender: q.gender ?? null, enabled: true, show_images: false, terms_url: 'https://www.gdeltproject.org/about.html#termsofuse' })),
    { id: 'guardian:football', kind: 'guardian', name: 'The Guardian', url: 'https://content.guardianapis.com/search?section=football', scope: 'pro', gender: null, enabled: false, terms_url: 'https://www.theguardian.com/open-platform/terms-and-conditions' },
  ];
  const { error } = await db.from('news_sources').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(`news sources: ${error.message}`);
  // Names and URLs follow the code (a feed that moved), never the switch.
  for (const r of rows) await db.from('news_sources').update({ name: r.name, url: r.url, scope: r.scope, gender: r.gender, terms_url: r.terms_url }).eq('id', r.id);
}

/** Every NCAA program on a Sidearm site gets its sport feed as a source, linked to the program. */
async function seedSchools(db: Db): Promise<number> {
  const programs = await selectAll<any>(db, 'college_programs', 'id,school_seo,gender,name,site_sport_slug', (q) => q.not('site_sport_slug', 'is', null));
  const schools = new Map((await selectAll<any>(db, 'college_schools', 'seo,name,athletics_url,site_platform')).map((s) => [s.seo, s]));
  const rows = programs.flatMap((p) => {
    const s = schools.get(p.school_seo);
    const url = schoolFeedUrl(s?.site_platform ?? null, s?.athletics_url ?? null, p.gender);
    if (!url) return [];
    const g = p.gender === 'w' ? 'w' : 'm';
    return [{ id: `school:${p.id}`, kind: 'school', name: s.name, url, scope: 'college', gender: g, program_id: p.id, enabled: true,
      link_label: `${s.name} (${g === 'w' ? 'women' : 'men'})`, link_href: `/teams/${p.school_seo}/${g === 'w' ? 'women' : 'men'}` }];
  });
  // New programs are added; existing ones keep their url (a source may have moved to the classic feed).
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('news_sources').upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`school sources: ${error.message}`);
  }
  return rows.length;
}

/** Reads one source and stores its new stories. A failure is recorded on the source, never thrown. */
async function readSource(ctx: JobContext, src: NewsSource & { url: string; fails: number; items: number }, ix: EntityIndex, recent: Awaited<ReturnType<typeof loadRecent>>, read: () => Promise<FeedItem[]>): Promise<void> {
  const at = new Date().toISOString();
  try {
    const items = await read();
    const prepared = await prepare(ctx.db, ix, src, items);
    const r = await store(ctx.db, src, prepared, recent, publisherFor(src));
    ctx.inc('sources_ok'); ctx.inc('items_read', items.length); ctx.inc('stories_new', r.added); ctx.inc('stories_linked', r.linked);
    await ctx.db.from('news_sources').update({ last_fetched_at: at, last_ok_at: at, last_error: null, fails: 0, items: src.items + r.added }).eq('id', src.id);
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    ctx.inc('sources_failed');
    await ctx.db.from('news_sources').update({ last_fetched_at: at, last_error: msg, fails: src.fails + 1 }).eq('id', src.id);
  }
}

const inSeason = (d = new Date()) => d.getUTCMonth() >= 7 && d.getUTCMonth() <= 11; // Aug-Dec: the college season
// Publisher feeds are read as what we are, a feed reader (some publishers' bot shields answer an empty 202 to the
// crawler's browser-like name). School sites keep the crawler's name: PrestoSports refuses anything that says "bot".
const FEED_READER = 'PlaibookStats/1.0 (feed reader; +https://www.plaibook.live)';
async function fetchFeed(ctx: JobContext, url: string, documentedApi = false, reader = false): Promise<string> {
  const res = await makeFetcher(ctx.db).get(url, { accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5', noStore: true, attempts: 2, documentedApi, userAgent: reader ? FEED_READER : undefined });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.text;
}

registerJob('news-schools', async (ctx: JobContext) => {
  const db = ctx.db;
  if ((await sourcesOff(db)).has('news-schools')) { ctx.note('skipped', 'switched off in the hub'); return; }
  // Programs move platforms rarely: the school sources are refreshed once a day.
  const seededAt = await kvGet<string>(db, 'news:schools_seeded_at');
  if (!seededAt || Date.now() - Date.parse(seededAt) > 86400_000 || ctx.params.reseed) { ctx.inc('school_sources', await seedSchools(db)); await kvSet(db, 'news:schools_seeded_at', new Date().toISOString()); }
  const everyH = inSeason() ? 3 : 24;
  const due = new Date(Date.now() - everyH * 3600_000).toISOString();
  const limit = Math.min(2000, Number(ctx.params.limit) || 700);
  const { data, error } = await db.from('news_sources').select(SRC_COLS).eq('kind', 'school').eq('enabled', true).or(`last_fetched_at.is.null,last_fetched_at.lt.${due}`).order('last_fetched_at', { ascending: true, nullsFirst: true }).limit(limit);
  if (error) throw new Error(error.message);
  const sources = (data ?? []) as any[];
  ctx.note('due', String(sources.length));
  const [ix, recent] = await Promise.all([entityIndex(db), loadRecent(db)]);
  const deadline = Date.now() + (Number(ctx.params.max_minutes) || 25) * 60_000;
  // Each school is its own host, so eight at once stays within every site's one-request-a-second limit.
  const queue = new PQueue({ concurrency: 8 });
  for (const s of sources) queue.add(async () => {
    if (Date.now() > deadline) return;
    await readSource(ctx, s, ix, recent, async () => {
      let url = s.url, xml: string;
      try { xml = await fetchFeed(ctx, url); } catch (err) {
        // Older Sidearm sites have only the classic feed: switch the source to it for good.
        const classic = /HTTP 404/.test(String(err)) ? classicSidearmFeed(url) : null;
        if (!classic) throw err;
        xml = await fetchFeed(ctx, classic);
        url = classic;
        await db.from('news_sources').update({ url }).eq('id', s.id);
        ctx.inc('classic_feeds');
      }
      return parseFeed(xml, url).filter((i) => isSoccerItem(i.categories, i.title, s.gender));
    });
  });
  await queue.onIdle();
  await ctx.heartbeat();
});

registerJob('news-feeds', async (ctx: JobContext) => {
  const db = ctx.db;
  await seedSources(db);
  const cfg = loadConfig();
  const every: Record<string, number> = { publisher: 14, guardian: 29, club: 59, federation: 59 };
  const { data, error } = await db.from('news_sources').select(SRC_COLS + ',last_fetched_at').in('kind', Object.keys(every)).eq('enabled', true);
  if (error) throw new Error(error.message);
  const off = await sourcesOff(db);
  const siteOf: Record<string, string> = { publisher: 'news-publishers', guardian: 'guardian', club: 'news-clubs', federation: 'news-clubs' };
  const due = ((data ?? []) as any[]).filter((s) => !off.has(siteOf[s.kind]!) && (!s.last_fetched_at || Date.now() - Date.parse(s.last_fetched_at) > every[s.kind]! * 60_000 || ctx.params.all));
  setNewsHosts(due.filter((s) => s.kind === 'club' || s.kind === 'federation').map((s) => s.url));
  ctx.note('due', String(due.length));
  const [ix, recent] = await Promise.all([entityIndex(db), loadRecent(db)]);
  const queue = new PQueue({ concurrency: 6 });
  for (const s of due) queue.add(() => readSource(ctx, s, ix, recent, async () => {
    if (s.kind === 'guardian') {
      if (!cfg.GUARDIAN_API_KEY) throw new Error('GUARDIAN_API_KEY is not set');
      return parseGuardian(await fetchFeed(ctx, GUARDIAN_URL(cfg.GUARDIAN_API_KEY), true));
    }
    const items = parseFeed(await fetchFeed(ctx, s.url, false, s.kind === 'publisher'), s.url);
    // A club's own feed carries its youth teams too: first-team news only.
    return s.kind === 'club' ? items.filter((i) => !YOUTH_STORY.test(i.title)) : items;
  }));
  await queue.onIdle();
});

registerJob('news-gdelt', async (ctx: JobContext) => {
  const db = ctx.db;
  if ((await sourcesOff(db)).has('gdelt')) { ctx.note('skipped', 'switched off in the hub'); return; }
  await seedSources(db);
  // The query read longest ago; a 429 means GDELT wants a pause, so the next run waits its turn.
  const { data } = await db.from('news_sources').select(SRC_COLS).eq('kind', 'gdelt').eq('enabled', true).order('last_fetched_at', { ascending: true, nullsFirst: true }).limit(Math.min(3, Number(ctx.params.queries) || 1));
  const [ix, recent] = await Promise.all([entityIndex(db), loadRecent(db)]);
  for (const s of (data ?? []) as any[]) {
    await readSource(ctx, s, ix, recent, async () => parseGdelt(await fetchFeed(ctx, s.url, true, true)));
    await new Promise((r) => setTimeout(r, 6000));
  }
});

/**
 * Official club and federation feeds. Clubs: the US scene and the top competitions (their Wikidata official website,
 * then the feed its home page announces). Clubs of leagues that run their clubs' sites (MLS, NWSL) are skipped, and
 * so is any page or feed on a league's domain. robots.txt is honoured by the fetch client.
 */
registerJob('news-discover', async (ctx: JobContext) => {
  const db = ctx.db;
  const f = makeFetcher(db);
  const maxPriority = Number(ctx.params.max_priority) || 60;
  const teams = (await teamIndexRows(db)) as { id: number; display_name: string; gender: string; is_national: boolean; slug: string; priority: number; country: string | null }[];
  const leagueRun = new Set((await selectAll<{ team_id: number }>(db, 'pro_league_teams', 'team_id', (q) => q.in('league_id', [...LEAGUE_RUN_IDS]))).map((r) => r.team_id));
  const clubs = teams.filter((t) => !t.is_national && t.priority <= maxPriority && !leagueRun.has(t.id) && ENGLISH_COUNTRIES.has(t.country ?? ''));
  const wiki = await selectAll<{ qid: string; pro_team_id: number }>(db, 'pro_wiki_clubs', 'qid,pro_team_id', (q) => q.in('pro_team_id', clubs.map((c) => c.id)).not('qid', 'is', null));
  const qidOf = new Map(wiki.map((w) => [w.pro_team_id, w.qid]));
  const sites: { team: (typeof teams)[number]; url: string; kind: 'club' | 'federation' }[] = [];
  // Official websites (P856) in batches of 50.
  const qids = [...new Set(wiki.map((w) => w.qid))];
  const website = new Map<string, string>();
  for (let i = 0; i < qids.length; i += 50) {
    const res = await f.get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${qids.slice(i, i + 50).join('|')}`, { accept: 'application/json', noStore: true, documentedApi: true }).catch(() => null);
    if (!res || res.status >= 400) continue;
    const ents = (JSON.parse(res.text)?.entities ?? {}) as Record<string, any>;
    for (const [q, e] of Object.entries(ents)) { const v = e?.claims?.P856?.[0]?.mainsnak?.datavalue?.value; if (typeof v === 'string') website.set(q, v); }
  }
  for (const c of clubs) { const q = qidOf.get(c.id); const w = q ? website.get(q) : undefined; if (w) sites.push({ team: c, url: w, kind: 'club' }); }
  const bySlug = new Map(teams.map((t) => [t.slug, t]));
  for (const fed of FEDERATION_SITES) { const t = bySlug.get(fed.team); if (t) sites.push({ team: t, url: fed.url, kind: 'federation' }); }
  ctx.note('sites', String(sites.length));
  const queue = new PQueue({ concurrency: 6 });
  const found: any[] = [];
  for (const s of sites) queue.add(async () => {
    let host: string;
    try { host = new URL(s.url).hostname; } catch { return; }
    if (LEAGUE_RUN.test(host)) { ctx.inc('skipped_league_run'); return; }
    const page = await f.get(s.url, { noStore: true, attempts: 1 }).catch(() => null);
    if (!page || page.status >= 400) { ctx.inc('home_unreadable'); return; }
    if (LEAGUE_RUN_PAGE.test(page.text)) { ctx.inc('skipped_league_run'); return; }
    let feeds = feedLinks(page.text, s.url).filter((u) => !LEAGUE_RUN.test(new URL(u).hostname));
    // Prefer a news or men's/women's feed over a site-wide "all posts" one.
    feeds = feeds.sort((a, b) => Number(/news|men|women/i.test(b)) - Number(/news|men|women/i.test(a)));
    for (const url of feeds.slice(0, 2)) {
      const res = await f.get(url, { accept: 'application/rss+xml,application/atom+xml,*/*', noStore: true, attempts: 1 }).catch(() => null);
      if (!res || res.status >= 400 || parseFeed(res.text, url).length === 0) continue;
      const g = s.team.gender === 'w' ? 'w' : 'm';
      found.push({ id: `${s.kind}:${s.team.id}`, kind: s.kind, name: s.team.display_name, url, scope: s.kind === 'federation' ? 'international' : 'pro', gender: g, pro_team_id: s.team.id, enabled: true,
        link_label: `${s.team.display_name}${g === 'w' ? ' (women)' : ''}`, link_href: `/pro/teams/${s.team.slug}`, terms_url: s.url });
      ctx.inc('feeds_found');
      return;
    }
    ctx.inc('no_feed');
  });
  await queue.onIdle();
  if (found.length) {
    const { error } = await db.from('news_sources').upsert(found, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`club sources: ${error.message}`);
  }
});

registerJob('news-retag', async (ctx: JobContext) => {
  const db = ctx.db;
  const since = typeof ctx.params.since === 'string' ? ctx.params.since : new Date(Date.now() - 14 * 86400_000).toISOString();
  const ix = await entityIndex(db);
  const sources = new Map(((await selectAll<any>(db, 'news_sources', SRC_COLS)) as NewsSource[]).map((s) => [s.id, s]));
  const arts = await selectAll<any>(db, 'news_articles', 'id,source_id,url,title,published_at,match_text', (q) => q.gte('published_at', since));
  // One batch per source: the people lookup is one query per batch, not per story.
  const bySource = new Map<string, any[]>();
  for (const a of arts) (bySource.get(a.source_id) ?? bySource.set(a.source_id, []).get(a.source_id)!).push(a);
  for (const [sourceId, list] of bySource) {
    const src = sources.get(sourceId);
    if (!src) continue;
    const items = list.map((a) => ({ title: a.title as string, url: a.url as string, published: new Date(a.published_at), lede: String(a.match_text ?? '').slice(String(a.title).length + 2), categories: [] as string[], image: null }));
    const prepared = await prepare(db, ix, src, items, Date.now(), undefined, 400);
    const byHash = new Map(prepared.map((p) => [p.hash, p]));
    for (const a of list) {
      const p = byHash.get(urlHash(a.url));
      if (!p) continue;
      await db.from('news_articles').update({ kinds: p.kinds, scope: [...p.scope], gender: p.gender, importance: p.importance }).eq('id', a.id);
      await db.from('news_links').delete().eq('article_id', a.id).neq('method', 'scope');
      if (p.links.length) await db.from('news_links').upsert(p.links.map((l) => ({ article_id: a.id, entity_type: l.type, entity_id: l.id, label: l.label, href: l.href, method: l.method, is_primary: l.primary, published_at: a.published_at })), { onConflict: 'article_id,entity_type,entity_id' });
      ctx.inc('retagged');
    }
    await ctx.heartbeat();
  }
});
