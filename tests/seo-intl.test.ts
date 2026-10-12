// International (/intl): national-team pages are served under /intl, their old /pro addresses 301 there, a club
// asked for under /intl 301s back to /pro, and the pages link within the section. Fastify inject over fixtures.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { registerSeo } from '../src/seo/routes.js';
import { stringTemplate } from '../src/seo/template.js';
import { FixtureSeoData } from './helpers/seoFixtures.js';
import type { ProSeoData } from '../src/seo/pro/data.js';
import type { IntlSeoData } from '../src/seo/intl/data.js';
import { setIntlRegistry } from '../src/pro/intlRegistry.js';

const BASE = 'https://www.plaibook.live';
const shell = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const HTML = { accept: 'text/html' };
const between = (s: string, a: string, b: string) => { const i = s.indexOf(a); return i < 0 ? '' : s.slice(i + a.length, s.indexOf(b, i + a.length)); };

const wc = { id: 1, name: 'World Cup', slug: 'world-cup', logo: null, country: 'World', gender: 'm' as const, type: 'cup' as const, scope: 'intl' as const, level: 'senior' as const, confederation: 'FIFA' };
const mls = { id: 253, name: 'MLS', slug: 'usa-mls', logo: null, country: 'USA', gender: 'm' as const, type: 'league' as const, scope: 'club' as const, level: 'senior' as const, confederation: null };
const usa = { id: 2384, name: 'USA', slug: 'usa', logo: null, country: 'USA', gender: 'm' as const, national: true };
const wales = { id: 767, name: 'Wales', slug: 'wales', logo: null, country: 'Wales', gender: 'm' as const, national: true };
const galaxy = { id: 1605, name: 'LA Galaxy', slug: 'la-galaxy', logo: null, country: 'USA', gender: 'm' as const, national: false };
const match = { id: 1, slug: '2022-11-21-usa-vs-wales', kickoff: '2022-11-21T19:00:00Z', status: 'final', status_short: 'FT', elapsed: 90, elapsed_extra: null, round: 'Group B', season: 2022, league: wc,
  home: { ...usa, score: 1 }, away: { ...wales, score: 1 }, ht: [1, 0], et: [null, null], pen: [null, null], winner: 'draw', venue: null, detail: true } as any;
const leaguePage = (l: typeof wc | typeof mls) => ({ league: { ...l, enabled: true, current_season: 2026 }, season: 2026, seasons: [2026], standings: [], results: [match], fixtures: [], scorers: [], assists: [], teams: 48 }) as any;
const teamPage = (t: typeof usa | typeof galaxy) => ({ team: { ...t, founded: 1913, venue: null }, season: 2026, seasons: [2026], competitions: [], standings: [], squad: [], coaches: [], transfers: [], injuries: [], goals_by_period: [], goals_by_period_source: 'events', season_detail: [], splits: { home: {}, away: {} }, results: [match], fixtures: [] }) as any;
const ref = (key: string, name: string, slug: string) => ({ key, name, slug, logo: null, fifa_code: null, confederation: 'CONCACAF' });
const history = (key: string, name: string, slug: string) => ({ nation: { ...ref(key, name, slug), first_match: '1916-08-20', fifa: true }, gender: 'm', record: { played: 800, w: 350, d: 180, l: 270, gf: 1200, ga: 1000 }, first_match: '1916-08-20',
  competitions: [{ name: 'Friendly', played: 400, w: 150, d: 100, l: 150, gf: 500, ga: 500, first: '1916-08-20', last: '2026-10-06' }], opponents: [], biggest_wins: [], worst_defeats: [], recent: [],
  scorers: [{ name: 'Landon Donovan', goals: 57, penalties: 10, first: '2000-10-25', last: '2014-10-10', pro_player_id: null, slug: null }], caps: [], world_cups: { editions: 11, years: [2022] },
  elo: { rating: 1883, rank: 24, matches: 800, last_match: '2026-10-06', change_1y: 12, best: 1950, best_date: '2002-06-17', series: [] }, credits: [{ name: 'international_results', url: 'https://github.com/martj42/international_results', license: 'public domain (CC0)' }] }) as any;

class Pro implements Partial<ProSeoData> {
  async home(date: string) { return { date, matches: { date, total: 0, live: 0, groups: [] }, featured: [], counts: { leagues: 1, teams: 1, players: 1, matches: 1 }, next_us: null, abroad: null } as any; }
  async league(slug: string) { return slug === 'world-cup' ? leaguePage(wc) : slug === 'usa-mls' ? leaguePage(mls) : null; }
  async team(slug: string) { return slug === 'usa' ? teamPage(usa) : slug === 'la-galaxy' ? teamPage(galaxy) : null; }
  async player() { return null; }
  async match(slug: string) { return slug === match.slug ? { match: { ...match, referee: null }, events: [], home: { formation: null, coach: null, starters: [], bench: [], stats: null }, away: { formation: null, coach: null, starters: [], bench: [], stats: null }, h2h: [] } as any : null; }
  async renamedSlug() { return null; }
  async countTeams() { return 0; }
  async countPlayers() { return 0; }
  async matchYears() { return []; }
  async sitemapLeagues() { return []; }
}
class Intl implements IntlSeoData {
  async ensureRegistry() { setIntlRegistry(['world-cup'], ['usa', 'wales']); }
  async home(date: string) { return { date, matches: { date, total: 0, live: 0, groups: [] }, upcoming: [], recent: [match], tournaments: [], counts: { tournaments: 120, nations: 211, nations_all: 600 } } as any; }
  async tournaments() { return [{ ...wc, priority: 34, current_season: 2026, starts_on: '2026-06-11', ends_on: '2026-07-19', state: 'off' }] as any; }
  async nations() { return [{ id: 2384, name: 'USA', slug: 'usa', logo: null, gender: 'm', level: 'senior', confederation: 'CONCACAF', competitions: 5, country: 'USA' }] as any; }
  async rankings() { return { gender: 'm', updated_at: null, credit: null, rows: [{ nation: ref('spain', 'Spain', 'spain'), rank: 1, rating: 2353, change_1y: 40, matches: 700, last_match: '2026-10-06', best: 2353, best_date: '2026-07-19' }] } as any; }
  async leaders() { return { stat: 'goals', per90: false, min_minutes: 0, total: 0, limit: 50, offset: 0, rows: [] } as any; }
  async history(slug: string) { return slug === 'usa' ? history('united-states', 'United States', 'usa') : slug === 'yugoslavia' ? history('yugoslavia', 'Yugoslavia', 'yugoslavia') : null; }
  async player() { return null; }
  async sitemap() { return [{ path: '/intl' }, { path: '/intl/tournaments/world-cup' }]; }
}

describe('international seo routes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    const seo = registerSeo(app, { data: new FixtureSeoData(), template: stringTemplate(shell), baseUrl: BASE, pro: new Pro() as unknown as ProSeoData, intl: new Intl() });
    app.setNotFoundHandler(seo.notFound);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('national-team addresses under /pro 301 to /intl, clubs under /intl 301 back', async () => {
    for (const [from, to] of [['/pro/leagues/world-cup', '/intl/tournaments/world-cup'], ['/pro/teams/usa', '/intl/teams/usa'], [`/pro/matches/${match.slug}`, `/intl/matches/${match.slug}`],
      ['/intl/tournaments/usa-mls', '/pro/leagues/usa-mls'], ['/intl/teams/la-galaxy', '/pro/teams/la-galaxy']]) {
      const r = await app.inject({ url: from, headers: HTML });
      expect([from, r.statusCode, r.headers.location]).toEqual([from, 301, to]);
    }
  });

  it('a tournament renders under /intl with its canonical, International crumbs and links in the section', async () => {
    const r = await app.inject({ url: '/intl/tournaments/world-cup', headers: HTML });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(`<link rel="canonical" href="${BASE}/intl/tournaments/world-cup" />`);
    const ssr = between(r.body, '<section id="ssr">', '</section>');
    expect(ssr).toContain('<a href="/intl">Plaibook Stats International</a>');
    expect(ssr).toContain(`<a href="/intl/matches/${match.slug}">`);
  });

  it('a national team page carries its history; a nation the provider lacks is its history alone', async () => {
    const r = await app.inject({ url: '/intl/teams/usa', headers: HTML });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(`<link rel="canonical" href="${BASE}/intl/teams/usa" />`);
    expect(r.body).toContain('All-time record');
    expect(r.body).toContain('Landon Donovan');
    const y = await app.inject({ url: '/intl/teams/yugoslavia', headers: HTML });
    expect(y.statusCode).toBe(200);
    expect(between(y.body, '<title>', '</title>')).toContain('Yugoslavia National Team');
    expect((await app.inject({ url: '/intl/teams/nowhere', headers: HTML })).statusCode).toBe(404);
  });

  it('the section pages render and the sitemap index lists the international sitemap', async () => {
    for (const u of ['/intl', '/intl/matches', '/intl/tournaments', '/intl/teams', '/intl/rankings', '/intl/players', '/intl/h2h']) expect([u, (await app.inject({ url: u, headers: HTML })).statusCode]).toEqual([u, 200]);
    const rank = await app.inject({ url: '/intl/rankings', headers: HTML });
    expect(rank.body).toContain('Plaibook Elo');
    expect(rank.body).toContain('Spain');
    const idx = await app.inject({ url: '/sitemap.xml' });
    expect(idx.body).toContain(`${BASE}/sitemaps/intl-core.xml`);
    expect((await app.inject({ url: '/sitemaps/intl-core.xml' })).body).toContain(`${BASE}/intl/tournaments/world-cup`);
  });
});
