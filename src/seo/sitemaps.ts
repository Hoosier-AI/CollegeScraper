// Sitemaps: /sitemap.xml is an index of
//   /sitemaps/core.xml                 home, rankings, teams index, conferences
//   /sitemaps/teams.xml                one URL per NCAA program (canonical, current season)
//   /sitemaps/matches-<season>-<n>.xml  games, at most 40,000 per file
//   /sitemaps/players-<season>-<n>.xml  players who appeared that season (never noindex or suppressed ones)
//   /sitemaps/pro-core.xml              Plaibook Stats Pro: home, competitions index, every enabled competition
//   /sitemaps/pro-teams-<n>.xml          clubs with a profile
//   /sitemaps/pro-matches-<year>-<n>.xml finals with detail (score-only finals and unplayed matches are noindex)
//   /sitemaps/pro-players-<n>.xml        players who have played
// Every document is built on demand and kept in memory for an hour.
import type { SeoData, SitemapEntry } from './types.js';
import type { ProSeoData } from './pro/data.js';
import { LruCache } from './cache.js';
import { esc, trimBase } from './util.js';

export const PER_FILE = 40_000;
const FILE = /^(matches|players)-(\d{4})-(\d{1,3})\.xml$/;
const PRO_FILE = /^pro-(?:(teams|players)-(\d{1,3})|matches-(\d{4})-(\d{1,3}))\.xml$/;

const lastmod = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export function urlsetXml(base: string, entries: SitemapEntry[]): string {
  const b = trimBase(base);
  const urls = entries.map((e) => { const lm = lastmod(e.lastmod); return `<url><loc>${esc(b + e.path)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}</url>`; });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function sitemapIndexXml(base: string, files: { path: string; lastmod?: string | null }[]): string {
  const b = trimBase(base);
  const items = files.map((f) => { const lm = lastmod(f.lastmod); return `<sitemap><loc>${esc(b + f.path)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}</sitemap>`; });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>\n`;
}

export class Sitemaps {
  private cache: LruCache<string>;
  constructor(private data: SeoData, private baseUrl: string, private opts: { perFile?: number; ttlMs?: number } = {}, private pro: ProSeoData | null = null) {
    this.cache = new LruCache<string>(200, opts.ttlMs ?? 3600_000);
  }
  private get perFile() { return this.opts.perFile ?? PER_FILE; }

  /** The XML for a sitemap path (/sitemap.xml or /sitemaps/<file>), or null when there is no such file. */
  async get(path: string): Promise<string | null> {
    const hit = this.cache.get(path);
    if (hit !== undefined) return hit;
    const xml = await this.build(path);
    if (xml != null) this.cache.set(path, xml);
    return xml;
  }

  private async build(path: string): Promise<string | null> {
    if (path === '/sitemap.xml') return sitemapIndexXml(this.baseUrl, await this.files());
    const m = /^\/sitemaps\/(.+)$/.exec(path);
    if (!m) return null;
    const file = m[1]!;
    if (file === 'core.xml') {
      const confs = await this.data.sitemapConferences();
      return urlsetXml(this.baseUrl, [{ path: '/' }, { path: '/rankings' }, { path: '/teams' }, ...confs]);
    }
    if (file === 'teams.xml') return urlsetXml(this.baseUrl, await this.data.sitemapTeams());
    if (this.pro) {
      if (file === 'pro-core.xml') return urlsetXml(this.baseUrl, [{ path: '/pro' }, { path: '/pro/matches' }, { path: '/pro/leagues' }, { path: '/pro/players' }, { path: '/pro/leaders' }, { path: '/pro/countries' }, { path: '/pro/college' }, { path: '/pro/transfers' }, { path: '/pro/sources' }, ...(await this.pro.sitemapLeagues())]);
      if (file === 'pro-countries.xml') return urlsetXml(this.baseUrl, await this.pro.sitemapCountries());
      const p = PRO_FILE.exec(file);
      if (p) {
        const [, kind, nStr, year, mStr] = p;
        const page = Number(nStr ?? mStr);
        if (page < 1) return null;
        const offset = (page - 1) * this.perFile;
        const count = kind === 'teams' ? await this.pro.countTeams() : kind === 'players' ? await this.pro.countPlayers() : await this.pro.countMatches(Number(year));
        if (offset >= count) return null;
        const rows = kind === 'teams' ? await this.pro.teams(offset, this.perFile) : kind === 'players' ? await this.pro.players(offset, this.perFile) : await this.pro.matches(Number(year), offset, this.perFile);
        return urlsetXml(this.baseUrl, rows);
      }
    }
    const f = FILE.exec(file);
    if (!f) return null;
    const kind = f[1] as 'matches' | 'players', season = Number(f[2]), n = Number(f[3]);
    if (n < 1) return null;
    const count = kind === 'matches' ? await this.data.countMatches(season) : await this.data.countPlayers(season);
    const offset = (n - 1) * this.perFile;
    if (offset >= count) return null;
    const rows = kind === 'matches' ? await this.data.matches(season, offset, this.perFile) : await this.data.players(season, offset, this.perFile);
    return urlsetXml(this.baseUrl, rows);
  }

  /** Index entries: core and teams first, then each season's matches and players, newest season first. */
  async files(): Promise<{ path: string }[]> {
    const out: { path: string }[] = [{ path: '/sitemaps/core.xml' }, { path: '/sitemaps/teams.xml' }];
    const seasons = (await this.data.sitemapSeasons()).sort((a, b) => b - a);
    for (const s of seasons) {
      const [games, players] = await Promise.all([this.data.countMatches(s), this.data.countPlayers(s)]);
      for (let i = 0; i < Math.ceil(games / this.perFile); i += 1) out.push({ path: `/sitemaps/matches-${s}-${i + 1}.xml` });
      for (let i = 0; i < Math.ceil(players / this.perFile); i += 1) out.push({ path: `/sitemaps/players-${s}-${i + 1}.xml` });
    }
    if (this.pro) {
      out.push({ path: '/sitemaps/pro-core.xml' }, { path: '/sitemaps/pro-countries.xml' });
      const [teams, players, years] = await Promise.all([this.pro.countTeams(), this.pro.countPlayers(), this.pro.matchYears()]);
      for (let i = 0; i < Math.ceil(teams / this.perFile); i += 1) out.push({ path: `/sitemaps/pro-teams-${i + 1}.xml` });
      for (const y of years) {
        const m = await this.pro.countMatches(y);
        for (let i = 0; i < Math.ceil(m / this.perFile); i += 1) out.push({ path: `/sitemaps/pro-matches-${y}-${i + 1}.xml` });
      }
      for (let i = 0; i < Math.ceil(players / this.perFile); i += 1) out.push({ path: `/sitemaps/pro-players-${i + 1}.xml` });
    }
    return out;
  }
}
