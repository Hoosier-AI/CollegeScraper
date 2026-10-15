// A feed's items into stories: new ones only (by url), tagged (classify), linked to our pages (entities), grouped
// with the same story from other outlets (cluster) and given an importance for Top stories.
import { createHash } from 'node:crypto';
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { classify, KIND_WEIGHT } from './classify.js';
import { clusterFor, titleTokens, type Recent } from './cluster.js';
import { lookupPeople, personCandidates, resolvePeople, type EntityIndex, type Link, type Scope } from './entities.js';
import type { FeedItem } from './rss.js';

export interface NewsSource {
  id: string;
  kind: string;
  name: string;
  scope: Scope;
  gender: 'm' | 'w' | null;
  program_id: string | null;
  pro_team_id: number | null;
  link_label: string | null;
  link_href: string | null;
}

export const urlHash = (url: string) => createHash('md5').update(url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')).digest('hex');

const WOMEN = /\b(women'?s|womens|wsl|nwsl|uswnt|canwnt|lionesses|matildas|w league|super league women|she ?believes|female)\b/i;
const MEN = /\b(men'?s|mens|usmnt|canmnt|mls\b|three lions|el tri)\b/i;
export function genderOf(text: string, fallback: 'm' | 'w' | null): 'm' | 'w' | null {
  if (fallback) return fallback;
  const w = WOMEN.test(text), m = MEN.test(text);
  return w && !m ? 'w' : m && !w ? 'm' : null;
}

/** Stories older than this are not taken in (a school feed's first read holds months of them). */
const MAX_AGE_DAYS = 45;

export interface Prepared { hash: string; item: FeedItem; title: string; kinds: string[]; gender: 'm' | 'w' | null; scope: Set<string>; links: Link[]; importance: number; at: Date }

/** Kinds, gender, links and importance for a batch of items from one source (pure apart from the people lookup). */
export async function prepare(db: Db | null, ix: EntityIndex, src: NewsSource, items: FeedItem[], now = Date.now(), people = lookupPeople, maxAgeDays = MAX_AGE_DAYS): Promise<Prepared[]> {
  const scanScope: Scope = src.scope === 'college' ? 'college' : 'pro';
  const rows = items
    .map((item) => ({ item, at: item.published ?? new Date(now) }))
    .filter((r) => now - r.at.getTime() < maxAgeDays * 86400_000 && r.at.getTime() < now + 3600_000);
  const cands = rows.map((r) => personCandidates(`${r.item.title}. ${r.item.lede}`));
  const keys = [...new Set(cands.flat().map((c) => c.key))];
  const hits = db ? await people(db, keys, scanScope) : new Map();
  return rows.map(({ item, at }, i) => {
    const text = `${item.title}. ${item.lede}`;
    const gender = genderOf(text, src.gender);
    const links: Link[] = [];
    const add = (l: Link) => { if (!links.some((x) => x.type === l.type && x.id === l.id)) links.push(l); };
    // A school or club feed is about its own team.
    if (src.program_id && src.link_href) add({ type: 'program', id: src.program_id, label: src.link_label ?? src.name, href: src.link_href, method: 'scope', primary: true, gender: src.gender });
    if (src.pro_team_id && src.link_href) add({ type: 'pro_team', id: String(src.pro_team_id), label: src.link_label ?? src.name, href: src.link_href, method: 'scope', primary: true });
    for (const l of ix.scan(text, scanScope, gender)) add(l);
    for (const l of ix.scan(item.categories.join('. '), scanScope, gender)) add({ ...l, method: 'tag' });
    const teamIds = new Set(links.filter((l) => l.type === 'program' || l.type === 'pro_team').map((l) => l.id));
    for (const p of resolvePeople(cands[i]!, hits, teamIds)) {
      if (gender && p.gender && p.gender !== gender) continue;
      add({ type: p.type, id: p.id, label: p.label, href: p.href, method: p.method, primary: false, american: p.american });
    }
    // Primary: the source's team, else the first person, else the first team or league named.
    if (!links.some((l) => l.primary)) {
      const first = links.find((l) => l.type === 'pro_player' || l.type === 'college_player') ?? links[0];
      if (first) first.primary = true;
    }
    const kinds = classify(item.title, item.lede);
    const scope = new Set<string>([src.scope]);
    if (links.some((l) => l.national || l.intl)) scope.add('international');
    if (src.scope === 'international') scope.add('pro');
    // Importance: what kind of story, plus who it is about (Americans and US teams first, then the big leagues).
    let importance = Math.max(0, ...kinds.map((k) => KIND_WEIGHT[k as keyof typeof KIND_WEIGHT] ?? 0));
    if (links.some((l) => l.american)) importance += 12;
    if (links.some((l) => (l.type === 'pro_team' || l.type === 'pro_league') && l.country === 'USA')) importance += 10;
    if (links.some((l) => l.national && l.country === 'USA')) importance += 10;
    if (links.some((l) => (l.priority ?? 999) <= 30)) importance += 8;
    if (src.kind === 'school' || src.kind === 'club' || src.kind === 'federation') importance += 4; // straight from the team
    return { hash: urlHash(item.url), item, title: item.title, kinds, gender, scope, links, importance: Math.min(100, importance), at };
  });
}

/** Stories of the last 48 hours with their linked entities, for grouping new ones with them. */
export async function loadRecent(db: Db): Promise<Recent[]> {
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const arts = await selectAll<{ id: number; cluster_id: number | null; title: string; publisher: string; published_at: string }>(db, 'news_articles', 'id,cluster_id,title,publisher,published_at', (q) => q.gte('published_at', since));
  const links = await selectAll<{ article_id: number; entity_type: string; entity_id: string }>(db, 'news_links', 'article_id,entity_type,entity_id', (q) => q.gte('published_at', since));
  const ents = new Map<number, Set<string>>();
  for (const l of links) (ents.get(l.article_id) ?? ents.set(l.article_id, new Set()).get(l.article_id)!).add(`${l.entity_type}|${l.entity_id}`);
  return arts.map((a) => ({ id: a.id, cluster_id: a.cluster_id, tokens: titleTokens(a.title), entities: ents.get(a.id) ?? new Set(), at: Date.parse(a.published_at), publisher: a.publisher }));
}

/** Stores the new stories of one source; returns how many were new and how many got at least one link. */
export async function store(db: Db, src: NewsSource, prepared: Prepared[], recent: Recent[], publisherOf: (url: string) => string): Promise<{ added: number; linked: number }> {
  if (!prepared.length) return { added: 0, linked: 0 };
  const byHash = new Map(prepared.map((p) => [p.hash, p]));
  const known = new Set<string>();
  const hashes = [...byHash.keys()];
  for (let i = 0; i < hashes.length; i += 200) {
    const { data } = await db.from('news_articles').select('url_hash,image_url').in('url_hash', hashes.slice(i, i + 200));
    for (const r of (data ?? []) as { url_hash: string; image_url: string | null }[]) {
      known.add(r.url_hash);
      // A story stored before its feed's picture was read (or before the feed added one) gets it now.
      const img = byHash.get(r.url_hash)?.item.image;
      if (img && !r.image_url) await db.from('news_articles').update({ image_url: img }).eq('url_hash', r.url_hash).is('image_url', null);
    }
  }
  const fresh = [...byHash.values()].filter((p) => !known.has(p.hash));
  let added = 0, linked = 0;
  for (const p of fresh) {
    const publisher = publisherOf(p.item.url);
    const entities = new Set(p.links.map((l) => `${l.type}|${l.id}`));
    const tokens = titleTokens(p.title);
    const cluster = clusterFor({ tokens, entities, at: p.at.getTime(), publisher }, recent);
    const { data, error } = await db.from('news_articles').insert({
      url_hash: p.hash, url: p.item.url, source_id: src.id, publisher, title: p.title, published_at: p.at.toISOString(),
      kinds: p.kinds, scope: [...p.scope], gender: p.gender, cluster_id: cluster, importance: p.importance,
      match_text: `${p.item.title}. ${p.item.lede}`.slice(0, 600), image_url: p.item.image ?? null,
    }).select('id').single();
    if (error) { if (/duplicate key/i.test(error.message)) continue; throw new Error(`news insert: ${error.message}`); }
    const id = (data as { id: number }).id;
    added += 1;
    // The lead story of a group carries its own id, so the group's outlet count includes it.
    if (cluster != null) await db.from('news_articles').update({ cluster_id: cluster }).eq('id', cluster).is('cluster_id', null);
    if (p.links.length) {
      linked += 1;
      const { error: le } = await db.from('news_links').upsert(p.links.map((l) => ({ article_id: id, entity_type: l.type, entity_id: l.id, label: l.label, href: l.href, method: l.method, is_primary: l.primary, published_at: p.at.toISOString() })), { onConflict: 'article_id,entity_type,entity_id', ignoreDuplicates: true });
      if (le) throw new Error(`news links: ${le.message}`);
    }
    recent.push({ id, cluster_id: cluster, tokens, entities, at: p.at.getTime(), publisher });
  }
  return { added, linked };
}
