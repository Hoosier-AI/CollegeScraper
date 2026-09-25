// Hand-built page models and an in-memory SeoData for the SEO tests (no database).
import type { ConferencePage, EntityKind, Gender, HomePage, MatchPage, PlayerPage, RankingsPage, SeoData, SitemapEntry, TeamPage, TeamsIndexPage } from '../../src/seo/types.js';

export const CURRENT = 2026;
export const TEAM_ID = '11111111-1111-4111-8111-111111111111';
export const PLAYER_ID = '22222222-2222-4222-8222-222222222222';
export const GAME_ID = '33333333-3333-4333-8333-333333333333';
export const CONF_ID = '44444444-4444-4444-8444-444444444444';

const duke = { name: 'Duke', school_seo: 'duke', gender: 'm' as Gender };
const wake = { name: 'Wake Forest', school_seo: 'wake-forest', gender: 'm' as Gender };
const acc = { name: 'Atlantic Coast Conference', seo: 'acc', short_name: 'ACC', division: 'd1' };

export function teamFixture(over: Partial<TeamPage> = {}): TeamPage {
  return {
    id: TEAM_ID, name: 'Duke', school_name: 'Duke', school_long_name: 'Duke University', school_seo: 'duke', gender: 'm',
    season: CURRENT, seasons: [2026, 2025, 2024], member: true, division: 'd1', conference: acc,
    logo: 'https://example.com/duke.svg', athletics_url: 'https://goduke.com',
    coaches: [{ name: 'Kevin Coach', title: 'Head Coach', is_head: true }, { name: 'Sam Assistant', title: 'Assistant Coach', is_head: false }],
    record: { w: 8, l: 2, t: 1, gf: 21, ga: 9, conf: { w: 3, l: 1, t: 0 } },
    standing: { rank: 2, pod: null, conf_pts: 9 },
    poll: { rank: 7, label: 'Poll 5' },
    roster: [
      { name: 'Jane <Doe>', slug: 'jane-doe-222222', jersey: 9, position: 'F', class_label: 'Jr.', gp: 11, gs: 10, minutes: 820, goals: 6, assists: 3, points: 15, saves: null, ga: null, shutouts: null },
      { name: 'Kim Keeper', slug: 'kim-keeper-aaaaaa', jersey: 1, position: 'GK', class_label: 'Sr.', gp: 11, gs: 11, minutes: 990, goals: 0, assists: 0, points: 0, saves: 40, ga: 9, shutouts: 4 },
      { name: 'Bench Player', slug: 'bench-player-bbbbbb', jersey: 30, position: 'D', class_label: 'Fr.', gp: 0, gs: 0, minutes: 0, goals: 0, assists: 0, points: 0, saves: null, ga: null, shutouts: null },
    ],
    games: [
      { slug: '2026-09-12-wake-forest-at-duke-men', date: '2026-09-12', status: 'final', home: true, neutral: false, overtime: false, opponent: 'Wake Forest', opponent_team: wake, score_for: 2, score_against: 1 },
      { slug: '2026-10-30-duke-at-wake-forest-men', date: '2026-10-30', status: 'scheduled', home: false, neutral: false, overtime: false, opponent: 'Wake Forest', opponent_team: wake, score_for: null, score_against: null },
    ],
    updated_at: '2026-09-20T12:00:00Z',
    ...over,
  };
}

export function playerFixture(over: Partial<PlayerPage> = {}): PlayerPage {
  return {
    id: PLAYER_ID, slug: 'jane-doe-222222', name: 'Jane Doe', noindex: false, headshot_url: null, hometown: 'Durham, N.C.', high_school: 'Jordan HS',
    seasons: [{ season: 2026, team: duke, jersey: 9, position: 'F', class_label: 'Jr.', gp: 11, gs: 10, minutes: 820, goals: 6, assists: 3, points: 15, shots: 30, sog: 14, saves: null, ga: null, gaa: null, save_pct: null, shutouts: null }],
    honors: ['ACC Offensive Player of the Week'], updated_at: '2026-09-20T12:00:00Z',
    ...over,
  };
}

export function matchFixture(over: Partial<MatchPage> = {}): MatchPage {
  return {
    id: GAME_ID, slug: '2026-09-12-wake-forest-at-duke-men', season: CURRENT, date: '2026-09-12', start_epoch: 1789254000, kickoff_tbd: false,
    gender: 'm', division: 'd1', status: 'final',
    home: { name: 'Duke', team: duke, score: 2, conference: 'Atlantic Coast Conference' },
    away: { name: 'Wake Forest', team: wake, score: 1, conference: 'Atlantic Coast Conference' },
    overtime: false, shootout: false, neutral_site: false, conference_game: true, postseason: false, tournament: null,
    venue_name: 'Koskinen Stadium', venue_city: 'Durham, N.C.', attendance: 2100,
    events: [
      { minute: "12′", side: 'home', type: 'goal', player: 'Jane Doe', assist: null },
      { minute: "55′", side: 'away', type: 'yellow', player: 'Alex Away', assist: null },
    ],
    team_stats: { home: { shots: 14, sog: 6, corners: 5, fouls: 9, saves: 3, yc: 0, rc: 0 }, away: { shots: 8, sog: 4, corners: 2, fouls: 12, saves: 4, yc: 1, rc: 0 } },
    players: { home: [{ name: 'Jane Doe', slug: 'jane-doe-222222', jersey: 9, position: 'F', starter: true, minutes: 80, goals: 1, assists: 0, shots: 4, saves: null, is_goalie: false }], away: [] },
    updated_at: '2026-09-13T01:00:00Z',
    ...over,
  };
}

export const conferenceFixture = (): ConferencePage => ({
  id: CONF_ID, seo: 'acc', name: 'Atlantic Coast Conference', short_name: 'ACC', division: 'd1', season: CURRENT,
  tables: [{ gender: 'm', source: 'conference', members: [duke, wake], rows: [
    { rank: 1, pod: null, team: wake, conf: { w: 4, l: 0, t: 0 }, conf_pts: 12, overall: { w: 9, l: 1, t: 0 }, gf: 20, ga: 5 },
    { rank: 2, pod: null, team: duke, conf: { w: 3, l: 1, t: 0 }, conf_pts: 9, overall: { w: 8, l: 2, t: 1 }, gf: 21, ga: 9 },
  ] }],
});

export const rankingsFixture = (season = CURRENT): RankingsPage => ({
  season, polls: [{ gender: 'm', division: 'd1', week_of: '2026-09-22', label: 'Poll 5', rows: [
    { rank: 1, name: 'Wake Forest', team: wake, points: 625, record: '9-1-0', previous_rank: 2, first_place_votes: 20 },
    { rank: 7, name: 'Duke', team: duke, points: 400, record: '8-2-1', previous_rank: 9, first_place_votes: 0 },
  ] }],
});

export class FixtureSeoData implements SeoData {
  calls: string[] = [];
  team_ = teamFixture();
  player_ = playerFixture();
  match_ = matchFixture();
  playerSeasons: Record<number, number> = { 2026: 5, 2025: 3 };
  gameCounts: Record<number, number> = { 2026: 7, 2025: 0 };
  currentSeason() { return CURRENT; }
  async team(school: string, gender: Gender, season: number | null) { this.calls.push(`team:${school}/${gender}/${season}`); return school === 'duke' && gender === 'm' ? { ...this.team_, season: season ?? CURRENT } : null; }
  async teamKeyById(id: string) { return id === TEAM_ID ? { school_seo: 'duke', gender: 'm' as Gender } : null; }
  async player(slug: string) { return slug === this.player_.slug ? this.player_ : null; }
  async playerSlugById(id: string) { return id === PLAYER_ID ? this.player_.slug : null; }
  async match(slug: string) { return slug === this.match_.slug ? this.match_ : null; }
  async matchSlugById(id: string) { return id === GAME_ID ? this.match_.slug : null; }
  async renamedSlug(kind: 'player' | 'game', slug: string) { return kind === 'player' && slug === 'jane-smith-222222' ? this.player_.slug : null; }
  async conference(seo: string) { return seo === 'acc' ? conferenceFixture() : null; }
  async conferenceSeoById(id: string) { return id === CONF_ID ? 'acc' : null; }
  async rankings(season: number) { return rankingsFixture(season); }
  async teams(season: number): Promise<TeamsIndexPage> { return { season, teams: [{ team: duke, division: 'd1', conference: acc }, { team: wake, division: 'd1', conference: acc }] }; }
  async home(season: number): Promise<HomePage> { return { season, teams: 2, conferences: [acc], polls: rankingsFixture(season).polls }; }
  async resolve(kind: EntityKind, key: string) {
    if (kind === 'team') return key === 'duke/m' ? TEAM_ID : null;
    if (kind === 'player') return key === this.player_.slug ? PLAYER_ID : null;
    if (kind === 'match') return key === this.match_.slug ? GAME_ID : null;
    return key === 'acc' ? CONF_ID : null;
  }
  async sitemapSeasons() { return [2025, 2026]; }
  async sitemapTeams(): Promise<SitemapEntry[]> { return [{ path: '/teams/duke/men', lastmod: '2026-09-20T12:00:00Z' }, { path: '/teams/wake-forest/men', lastmod: null }]; }
  async sitemapConferences(): Promise<SitemapEntry[]> { return [{ path: '/conferences/acc' }]; }
  async countMatches(season: number) { return this.gameCounts[season] ?? 0; }
  async matches(season: number, offset: number, limit: number) {
    return Array.from({ length: this.gameCounts[season] ?? 0 }, (_, i) => ({ path: `/matches/${season}-game-${i}`, lastmod: '2026-09-13T00:00:00Z' })).slice(offset, offset + limit);
  }
  async countPlayers(season: number) { return this.playerSeasons[season] ?? 0; }
  async players(season: number, offset: number, limit: number) {
    return Array.from({ length: this.playerSeasons[season] ?? 0 }, (_, i) => ({ path: `/players/p${season}-${i}` })).slice(offset, offset + limit);
  }
}
