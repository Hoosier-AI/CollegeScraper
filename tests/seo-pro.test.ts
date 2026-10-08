// Plaibook Stats Pro's server-rendered pages and sitemaps, end to end through Fastify inject over fixture data.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { registerSeo } from '../src/seo/routes.js';
import { stringTemplate } from '../src/seo/template.js';
import { FixtureSeoData } from './helpers/seoFixtures.js';
import type { ProSeoData } from '../src/seo/pro/data.js';
import type { ProMatchPage, ProPlayerPage } from '../src/seo/pro/pages.js';
import type { ProMatchRow } from '../src/pro/queries.js';

const BASE = 'https://www.plaibook.live';
const shell = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const HTML = { accept: 'text/html' };
const between = (s: string, a: string, b: string) => { const i = s.indexOf(a); return i < 0 ? '' : s.slice(i + a.length, s.indexOf(b, i + a.length)); };
const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));

const league = { id: 254, name: 'NWSL Women', slug: 'usa-nwsl-women', logo: null, country: 'USA', gender: 'w' as const, type: 'league' as const };
const thorns = { id: 3001, name: 'Portland Thorns', slug: 'portland-thorns-women', logo: null, country: 'USA', gender: 'w' as const };
const legacy = { id: 3002, name: 'Boston Legacy', slug: 'boston-legacy-women', logo: null, country: 'USA', gender: 'w' as const };

function matchRow(over: Partial<ProMatchRow> = {}): ProMatchRow {
  return { id: 1508568, slug: '2026-10-04-portland-thorns-women-vs-boston-legacy-women', kickoff: '2026-10-04T00:45:00.000Z', status: 'final', status_short: 'FT', elapsed: 90, elapsed_extra: null, round: 'Regular Season - 24', season: 2026,
    league, home: { ...thorns, score: 3 }, away: { ...legacy, score: 1 }, ht: [1, 1], et: [null, null], pen: [null, null], winner: 'home', venue: 'Providence Park, Portland', detail: true, ...over };
}
const side = (name: string) => ({ formation: '4-3-3', coach: 'Coach', starters: [{ slot: 1, player_id: 9, name, display: name, slug: 'sophia-smith-9', photo: null, number: 9, pos: 'F', grid: '4:1', starter: true, captain: false, minutes: 90, rating: 8.1, goals: 2, assists: 0, yellow: 0, red: 0, saves: null, conceded: null, shots: 4, shots_on: 3, passes: 20, key_passes: 1, tackles: 0 } as any], bench: [], stats: { possession: 55, shots: 14 } as any });
function matchPage(over: Partial<ProMatchPage> = {}): ProMatchPage {
  return { match: { ...matchRow(), referee: 'Calin Radosav' }, events: [{ seq: 1, minute: 12, extra: null, team_id: 3001, player_id: 9, player_name: 'S. Smith', assist_id: null, assist_name: 'O. Moultrie', type: 'goal', detail: 'Normal Goal', comments: null, side: 'home', player_slug: 'sophia-smith-9' }] as any,
    home: side('Sophia Smith'), away: side('Someone Else'), h2h: [], ...over };
}
function playerPage(over: Partial<ProPlayerPage> = {}): ProPlayerPage {
  return { player: { id: 9, name: 'Sophia Smith', slug: 'sophia-smith-9', short_name: 'S. Smith', first_name: 'Sophia', last_name: 'Smith', birth_date: '2000-08-10', birth_place: 'Windsor', birth_country: 'USA', nationality: 'USA', height_cm: 170, weight_kg: null, position: 'Attacker', photo: null, gender: 'w', noindex: false },
    team: thorns, seasons: [{ season: 2026, league, team: thorns, apps: 20, starts: 19, minutes: 1700, goals: 11, assists: 4, shots: 50, shots_on: 25, key_passes: 20, tackles: 5, yellow: 1, red: 0, saves: null, conceded: null, clean_sheets: null, rating: 7.4 }],
    matches: [], college: [{ college_name: 'Stanford University', school_seo: 'stanford', first_season: 2018, last_season: 2019, college_player_slug: null, verified: false }], ...over };
}

class FixtureProData implements ProSeoData {
  calls: string[] = [];
  async home(date: string) { this.calls.push('home'); return { date, matches: { date, total: 1, live: 0, groups: [{ league, priority: 2, matches: [matchRow()] }] }, featured: [{ ...league, current_season: 2026 }], counts: { leagues: 640, teams: 9000, players: 120000, matches: 50000 } }; }
  async leagues() { return [{ ...league, priority: 2, current_season: 2026 }]; }
  async league(slug: string) { return slug === league.slug ? { league: { ...league, enabled: true, current_season: 2026 }, season: 2026, seasons: [2026, 2025], standings: [{ name: '', rows: [{ rank: 1, team: thorns, played: 24, win: 14, draw: 5, lose: 5, gf: 40, ga: 20, gd: 20, points: 47, form: 'WWDLW', description: null }] }], results: [matchRow()], fixtures: [], scorers: [], assists: [], teams: 16 } : null; }
  async team() { return null; }
  async player(slug: string) { return slug === 'sophia-smith-9' ? playerPage() : slug === 'bench-only-10' ? playerPage({ player: { ...playerPage().player, slug: 'bench-only-10' }, seasons: [] }) : null; }
  async match(slug: string) {
    if (slug === matchRow().slug) return matchPage();
    if (slug === 'upcoming') return matchPage({ match: { ...matchRow({ slug: 'upcoming', status: 'scheduled', status_short: 'NS', home: { ...thorns, score: null }, away: { ...legacy, score: null }, winner: null }), referee: null } });
    if (slug === 'thin') return matchPage({ match: { ...matchRow({ slug: 'thin' }), referee: null }, events: [], home: { formation: null, coach: null, starters: [], bench: [], stats: null }, away: { formation: null, coach: null, starters: [], bench: [], stats: null } });
    return null;
  }
  async renamedSlug(kind: string, slug: string) { return kind === 'player' && slug === 'sophia-smith-old-9' ? 'sophia-smith-9' : null; }
  async sitemapLeagues() { return [{ path: '/pro/leagues/usa-nwsl-women' }]; }
  async countTeams() { return 3; }
  async teams() { return [{ path: '/pro/teams/portland-thorns-women' }]; }
  async matchYears() { return [2026, 2025]; }
  async countMatches(y: number) { return y === 2026 ? 5 : 0; }
  async matches() { return [{ path: `/pro/matches/${matchRow().slug}` }]; }
  async countPlayers() { return 2; }
  async players() { return [{ path: '/pro/players/sophia-smith-9' }]; }
}

describe('pro seo routes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    const seo = registerSeo(app, { data: new FixtureSeoData(), template: stringTemplate(shell), baseUrl: BASE, pro: new FixtureProData() });
    app.setNotFoundHandler(seo.notFound);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('renders a final with a score-line title, SportsEvent JSON-LD and the summary', async () => {
    const r = await app.inject({ url: `/pro/matches/${matchRow().slug}`, headers: HTML });
    expect(r.statusCode).toBe(200);
    expect(between(r.body, '<title>', '</title>')).toBe('Portland Thorns 3-1 Boston Legacy, NWSL Women, Oct 4, 2026 | Plaibook Stats');
    expect(r.body).toContain(`<link rel="canonical" href="${BASE}/pro/matches/${matchRow().slug}" />`);
    expect(r.body).not.toContain('name="robots"');
    const ld = jsonLd(r.body);
    expect(ld.map((j) => j['@type'])).toEqual(['SportsEvent', 'BreadcrumbList']);
    expect(ld[0]).toMatchObject({ sport: 'Soccer', homeTeam: { name: 'Portland Thorns' }, superEvent: { name: 'NWSL Women' } });
    const ssr = between(r.body, '<section id="ssr">', '</section>');
    expect(ssr).toContain('<a href="/pro/players/sophia-smith-9">Sophia Smith</a>');
    expect(ssr).toContain('assisted by O. Moultrie');
    expect(ssr).toContain('Plaibook Stats Pro');
  });

  it('unplayed and score-only matches are noindex', async () => {
    for (const s of ['upcoming', 'thin']) {
      const r = await app.inject({ url: `/pro/matches/${s}`, headers: HTML });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('<meta name="robots" content="noindex,follow" />');
    }
  });

  it('a player page carries Person JSON-LD with the college, and links to the college team', async () => {
    const r = await app.inject({ url: '/pro/players/sophia-smith-9', headers: HTML });
    const ld = jsonLd(r.body);
    expect(ld[0]).toMatchObject({ '@type': 'Person', name: 'Sophia Smith', birthDate: '2000-08-10', alumniOf: [{ name: 'Stanford University' }], affiliation: { name: 'Portland Thorns' } });
    expect(between(r.body, '<section id="ssr">', '</section>')).toContain('<a href="/teams/stanford/women">Stanford University</a>');
    const bench = await app.inject({ url: '/pro/players/bench-only-10', headers: HTML });
    expect(bench.body).toContain('noindex,follow');
  });

  it('renamed slugs 301, unknown ones are real 404s, the scoreboard is the app shell', async () => {
    const moved = await app.inject({ url: '/pro/players/sophia-smith-old-9', headers: HTML });
    expect(moved.statusCode).toBe(301);
    expect(moved.headers.location).toBe('/pro/players/sophia-smith-9');
    expect((await app.inject({ url: '/pro/players/nobody-1', headers: HTML })).statusCode).toBe(404);
    expect((await app.inject({ url: '/pro/matches', headers: HTML })).statusCode).toBe(200);
  });

  it('league and home pages', async () => {
    const l = await app.inject({ url: '/pro/leagues/usa-nwsl-women', headers: HTML });
    expect(between(l.body, '<title>', '</title>')).toBe('NWSL Women 2026: Table, Results, Fixtures and Top Scorers | Plaibook Stats');
    expect(l.body).toContain('Portland Thorns top the table on 47 points');
    const h = await app.inject({ url: '/pro', headers: HTML });
    expect(h.statusCode).toBe(200);
    expect(between(h.body, '<section id="ssr">', '</section>')).toContain('640 professional competitions');
  });

  it('the sitemap index lists the pro files; the files list only indexable pages', async () => {
    const idx = await app.inject({ url: '/sitemap.xml' });
    expect(idx.body).toContain('/sitemaps/pro-core.xml');
    expect(idx.body).toContain('/sitemaps/pro-teams-1.xml');
    expect(idx.body).toContain('/sitemaps/pro-matches-2026-1.xml');
    expect(idx.body).not.toContain('/sitemaps/pro-matches-2025-1.xml');
    expect(idx.body).toContain('/sitemaps/pro-players-1.xml');
    const core = await app.inject({ url: '/sitemaps/pro-core.xml' });
    expect(core.body).toContain(`<loc>${BASE}/pro/leagues/usa-nwsl-women</loc>`);
    expect((await app.inject({ url: '/sitemaps/pro-matches-2026-1.xml' })).body).toContain('/pro/matches/2026-10-04-');
    expect((await app.inject({ url: '/sitemaps/pro-players-2.xml' })).statusCode).toBe(404);
  });
});
