// Reads behind the News pages and sections: a page of stories for a team, player, league, conference or a whole area
// (College, Pro, International), and Top stories (most important of the last three days).
import type { FastifyInstance } from 'fastify';
import { getDb, type Db } from '../db/client.js';
import { KIND_LABEL, type NewsKind } from './classify.js';

export interface Story {
  id: number; url: string; title: string; publisher: string; published_at: string; kinds: NewsKind[]; scope: string[];
  gender: 'm' | 'w' | null; importance: number; outlets: number; also: { publisher: string; url: string }[];
  links: { type: string; id: string; label: string; href: string | null; primary: boolean }[];
}
export interface FeedQuery { scope?: 'college' | 'pro' | 'international' | null; type?: string | null; ids?: string[] | null; kinds?: NewsKind[] | null; gender?: 'm' | 'w' | null; before?: string | null; limit?: number }

export async function feed(db: Db, q: FeedQuery): Promise<Story[]> {
  const { data, error } = await db.rpc('news_feed', {
    p_scope: q.scope ?? null, p_type: q.type ?? null, p_ids: q.ids?.length ? q.ids : null, p_kinds: q.kinds?.length ? q.kinds : null,
    p_gender: q.gender ?? null, p_before: q.before ?? null, p_limit: Math.max(1, Math.min(60, q.limit ?? 20)),
  });
  if (error) throw new Error(`news feed: ${error.message}`);
  return (data ?? []) as Story[];
}

/** The most important stories of the last three days: kind and who it is about, plus how many outlets ran it. */
export function topOf(stories: Story[], n = 6, now = Date.now()): Story[] {
  const score = (s: Story) => s.importance + Math.min(6, Math.max(0, s.outlets - 1)) * 6 - (now - Date.parse(s.published_at)) / 3600_000 / 6;
  // A mix: at most two of a kind (a Monday of weekly awards would otherwise fill the list).
  const perKind = new Map<string, number>();
  const out: Story[] = [];
  for (const s of stories.filter((x) => now - Date.parse(x.published_at) < 3 * 86400_000 && x.importance > 0).sort((a, b) => score(b) - score(a))) {
    const k = s.kinds[0] ?? 'other';
    if ((perKind.get(k) ?? 0) >= 2) continue;
    perKind.set(k, (perKind.get(k) ?? 0) + 1);
    out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = Object.keys(KIND_LABEL) as NewsKind[];
const list = (v: unknown, ok: (s: string) => boolean) => String(v ?? '').split(',').map((s) => s.trim()).filter((s) => s && ok(s)).slice(0, 10);
const gender = (v: unknown) => (v === 'm' || v === 'w' ? v : null);

export function registerNewsApi(app: FastifyInstance): void {
  const cache = 'public, max-age=60';
  // /api/news?scope=college|pro|international&program=&player=&conference=&team=&league=&kind=&gender=&before=&limit=&top=1
  app.get<{ Querystring: Record<string, string> }>('/api/news', async (req, reply) => {
    const q = req.query;
    const scope = q.scope === 'college' || q.scope === 'pro' || q.scope === 'international' ? q.scope : null;
    const pairs: [string, string, (s: string) => boolean][] = [
      ['program', 'program', (s) => UUID.test(s)], ['player', 'college_player', (s) => UUID.test(s)], ['conference', 'conference', (s) => UUID.test(s)],
      ['team', 'pro_team', (s) => /^\d{1,7}$/.test(s)], ['pro_player', 'pro_player', (s) => /^\d{1,9}$/.test(s)], ['league', 'pro_league', (s) => /^\d{1,6}$/.test(s)],
    ];
    const db = getDb();
    let hit = pairs.find(([k]) => q[k]);
    let ids = hit ? list(q[hit[0]], hit[2]) : null;
    if (hit && !ids?.length) return reply.code(400).send({ error: `bad ${hit[0]}` });
    // A country: its senior national teams (men and women). Americans: the US players with the most recent minutes.
    if (!hit && q.country && /^[A-Za-z .'-]{2,40}$/.test(q.country)) {
      const { data } = await db.from('pro_teams').select('id,display_name').eq('national', true).eq('country', q.country);
      ids = ((data ?? []) as any[]).filter((t) => !/\bU-?\d{2}\b|olympic/i.test(t.display_name)).map((t) => String(t.id));
      hit = ['team', 'pro_team', () => true];
      if (!ids.length) return reply.header('Cache-Control', cache).send({ stories: [], kinds: KIND_LABEL, next_before: null });
    } else if (!hit && q.american === '1') {
      const { data } = await db.from('pro_players').select('id').eq('american', true).gt('minutes_recent', 0).order('minutes_recent', { ascending: false }).limit(400);
      ids = ((data ?? []) as any[]).map((p) => String(p.id));
      hit = ['pro_player', 'pro_player', () => true];
    }
    const kinds = q.kind ? (list(q.kind, (s) => (KINDS as string[]).includes(s)) as NewsKind[]) : null;
    const before = q.before && !Number.isNaN(Date.parse(q.before)) ? new Date(q.before).toISOString() : null;
    const limit = Math.min(60, Number(q.limit) || 20);
    const stories = await feed(db, { scope, type: hit?.[1] ?? null, ids, kinds, gender: gender(q.gender), before, limit });
    // Top stories come from a wider window than one page.
    const top = q.top === '1' && !before ? topOf(await feed(db, { scope, type: hit?.[1] ?? null, ids, kinds, gender: gender(q.gender), limit: 60 })) : undefined;
    return reply.header('Cache-Control', cache).send({
      stories, top, kinds: KIND_LABEL,
      next_before: stories.length === limit ? stories[stories.length - 1]!.published_at : null,
    });
  });
}
