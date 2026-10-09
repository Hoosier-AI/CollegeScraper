// What the /pro server-rendered pages and the pro sitemaps read. The page models come straight from
// src/pro/queries.ts (the same reads the app's /api/pro routes use); the sitemap lists only indexable pages.
import type { Db } from '../../db/client.js';
import { selectAll } from '../../db/client.js';
import * as Q from '../../pro/queries.js';
import type { SitemapEntry } from '../types.js';
import { proPaths } from './pages.js';

export interface ProSeoData {
  home(date: string): ReturnType<typeof Q.home>;
  leagues(): ReturnType<typeof Q.leagues>;
  league(slug: string, season: number | null): ReturnType<typeof Q.league>;
  team(slug: string, season: number | null): ReturnType<typeof Q.team>;
  player(slug: string): ReturnType<typeof Q.player>;
  match(slug: string): ReturnType<typeof Q.match>;
  renamedSlug(kind: Q.ProKind, slug: string): Promise<string | null>;
  leaders(f: Q.LeadersFilter): ReturnType<typeof Q.leaders>;
  countries(): ReturnType<typeof Q.countries>;
  country(slug: string): ReturnType<typeof Q.country>;
  college(): ReturnType<typeof Q.collegeHub>;
  transfers(): ReturnType<typeof Q.transfersFeed>;
  sitemapCountries(): Promise<SitemapEntry[]>;
  // sitemaps
  sitemapLeagues(): Promise<SitemapEntry[]>;
  countTeams(): Promise<number>;
  teams(offset: number, limit: number): Promise<SitemapEntry[]>;
  matchYears(): Promise<number[]>;
  countMatches(year: number): Promise<number>;
  matches(year: number, offset: number, limit: number): Promise<SitemapEntry[]>;
  countPlayers(): Promise<number>;
  players(offset: number, limit: number): Promise<SitemapEntry[]>;
}

const yearRange = (y: number) => ({ from: `${y}-01-01T00:00:00Z`, to: `${y + 1}-01-01T00:00:00Z` });

export class DbProSeoData implements ProSeoData {
  constructor(private db: Db) {}
  home(date: string) { return Q.home(this.db, date); }
  leagues() { return Q.leagues(this.db); }
  league(slug: string, season: number | null) { return Q.league(this.db, slug, season); }
  team(slug: string, season: number | null) { return Q.team(this.db, slug, season); }
  player(slug: string) { return Q.player(this.db, slug); }
  match(slug: string) { return Q.match(this.db, slug); }
  renamedSlug(kind: Q.ProKind, slug: string) { return Q.renamedSlug(this.db, kind, slug); }
  leaders(f: Q.LeadersFilter) { return Q.leaders(this.db, f); }
  countries() { return Q.countries(this.db); }
  country(slug: string) { return Q.country(this.db, slug); }
  college() { return Q.collegeHub(this.db); }
  transfers() { return Q.transfersFeed(this.db, { limit: 100 }); }
  async sitemapCountries(): Promise<SitemapEntry[]> {
    return (await Q.countries(this.db)).filter((c) => c.leagues > 0).map((c) => ({ path: `/pro/countries/${c.slug}` }));
  }

  async sitemapLeagues(): Promise<SitemapEntry[]> {
    const rows = await selectAll<{ slug: string }>(this.db, 'pro_leagues', 'slug', (q) => q.eq('enabled', true).not('slug', 'is', null).order('priority'));
    return rows.map((r) => ({ path: proPaths.league(r.slug) }));
  }
  /** Clubs with a season record (they have played): the rest are noindex. */
  async countTeams(): Promise<number> {
    const { count } = await this.db.from('pro_teams').select('id', { count: 'exact', head: true }).not('profile_synced_at', 'is', null);
    return count ?? 0;
  }
  async teams(offset: number, limit: number): Promise<SitemapEntry[]> {
    const { data, error } = await this.db.from('pro_teams').select('slug').not('profile_synced_at', 'is', null).order('id').range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { slug: string }[]).map((r) => ({ path: proPaths.team(r.slug) }));
  }
  async matchYears(): Promise<number[]> {
    const { data } = await this.db.from('pro_fixtures').select('kickoff').eq('status', 'final').not('detail_fetched_at', 'is', null).order('kickoff', { ascending: true }).limit(1);
    const first = (data as { kickoff: string }[] | null)?.[0]?.kickoff;
    if (!first) return [];
    const out: number[] = [];
    for (let y = new Date().getUTCFullYear(); y >= Number(first.slice(0, 4)); y -= 1) out.push(y);
    return out;
  }
  /** Finals with detail only: score-only finals and unplayed matches are noindex. */
  async countMatches(year: number): Promise<number> {
    const r = yearRange(year);
    const { count } = await this.db.from('pro_fixtures').select('id', { count: 'exact', head: true }).eq('status', 'final').not('detail_fetched_at', 'is', null).gte('kickoff', r.from).lt('kickoff', r.to);
    return count ?? 0;
  }
  async matches(year: number, offset: number, limit: number): Promise<SitemapEntry[]> {
    const r = yearRange(year);
    const { data, error } = await this.db.from('pro_fixtures').select('slug').eq('status', 'final').not('detail_fetched_at', 'is', null).gte('kickoff', r.from).lt('kickoff', r.to).order('id').range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { slug: string }[]).map((x) => ({ path: proPaths.match(x.slug) }));
  }
  /** Players who have played lately or are in a squad (pro_players.indexable, nightly); the rest stay out. */
  async countPlayers(): Promise<number> {
    const { count } = await this.db.from('pro_players').select('id', { count: 'exact', head: true }).eq('indexable', true).eq('noindex', false);
    return count ?? 0;
  }
  async players(offset: number, limit: number): Promise<SitemapEntry[]> {
    const { data, error } = await this.db.from('pro_players').select('slug').eq('indexable', true).eq('noindex', false).order('id').range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { slug: string }[]).map((x) => ({ path: proPaths.player(x.slug) }));
  }
}
