// What the International (/intl) server-rendered pages and the international sitemap read: the same models as the
// app's /api/intl routes (src/pro/intl.ts), plus the Pro models for a tournament, team, player or match.
import type { Db } from '../../db/client.js';
import { selectAll } from '../../db/client.js';
import * as Q from '../../pro/queries.js';
import * as I from '../../pro/intl.js';
import { ensureIntlRegistry } from '../../pro/intlRegistry.js';
import type { SitemapEntry } from '../types.js';

export interface IntlSeoData {
  ensureRegistry(): Promise<void>;
  home(date: string): ReturnType<typeof I.home>;
  tournaments(): ReturnType<typeof I.tournaments>;
  nations(): ReturnType<typeof I.nations>;
  rankings(gender: 'm' | 'w'): ReturnType<typeof I.rankings>;
  leaders(): ReturnType<typeof Q.leaders>;
  /** A nation's history by its International address (a national team's slug, or a nation's key). */
  history(slug: string): Promise<Awaited<ReturnType<typeof I.nationHistory>>>;
  /** `intl` is null for a player under 18 (no profile, src/pro/minor.ts). */
  player(slug: string): Promise<{ player: NonNullable<Awaited<ReturnType<typeof Q.player>>>; intl: Awaited<ReturnType<typeof I.playerInternational>> | null } | null>;
  sitemap(): Promise<SitemapEntry[]>;
}

export class DbIntlSeoData implements IntlSeoData {
  constructor(private db: Db) {}
  ensureRegistry() { return ensureIntlRegistry(this.db); }
  home(date: string) { return I.home(this.db, date); }
  tournaments() { return I.tournaments(this.db); }
  nations() { return I.nations(this.db); }
  rankings(gender: 'm' | 'w') { return I.rankings(this.db, gender); }
  leaders() { return Q.leaders(this.db, { stat: 'goals', scope: 'intl', level: 'senior', limit: 50 }); }
  async history(slug: string) {
    const n = await I.nationOf(this.db, slug);
    return n ? I.nationHistory(this.db, n.key, n.gender) : null;
  }
  async player(slug: string) {
    const p = await Q.player(this.db, slug);
    if (!p) return null;
    return { player: p, intl: 'minor' in p ? null : await I.playerInternational(this.db, p.player.id) };
  }
  /** The section's pages, every tournament, every senior national team, and the nations without a provider side. */
  async sitemap(): Promise<SitemapEntry[]> {
    const [ts, ns, history] = await Promise.all([
      I.tournaments(this.db), I.nations(this.db),
      selectAll<{ key: string }>(this.db, 'intl_nations', 'key', (q) => q.is('team_m', null).is('team_w', null).gte('matches', 20)).catch(() => []),
    ]);
    return [
      { path: '/intl/matches' }, { path: '/intl/tournaments' }, { path: '/intl/teams' }, { path: '/intl/rankings' }, { path: '/intl/players' }, { path: '/intl/leaders' },
      ...ts.map((t) => ({ path: `/intl/tournaments/${t.slug}` })),
      ...ns.filter((n) => n.level === 'senior').map((n) => ({ path: `/intl/teams/${n.slug}` })),
      ...history.map((h) => ({ path: `/intl/teams/${h.key}` })),
    ];
  }
}
