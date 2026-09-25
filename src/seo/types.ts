// Page models for the server-rendered (search-engine) view of the public pages. They are deliberately small and
// already cleaned (suppressed players removed or withheld), so head.ts and body.ts stay pure and testable with
// fixtures. src/seo/data.ts fills them from the database; tests fill them by hand.

export type Gender = 'm' | 'w';

export interface TeamRef { name: string; school_seo: string; gender: Gender }
export interface ConferenceRef { name: string; seo: string; short_name?: string | null; division?: string | null }
export interface Record3 { w: number; l: number; t: number }

export interface RosterEntry {
  name: string;
  /** Null when the player has no public profile (no slug yet). */
  slug: string | null;
  jersey: number | null; position: string | null; class_label: string | null;
  gp: number | null; gs: number | null; minutes: number | null; goals: number | null; assists: number | null; points: number | null;
  saves: number | null; ga: number | null; shutouts: number | null;
}

export interface TeamGame {
  slug: string | null; date: string; status: string;
  /** This team was the home side. */
  home: boolean; neutral: boolean; overtime: boolean;
  opponent: string; opponent_team: TeamRef | null;
  score_for: number | null; score_against: number | null;
}

export interface TeamPage {
  id: string; name: string; school_name: string | null; school_long_name: string | null; school_seo: string; gender: Gender;
  season: number; seasons: number[];
  /** An NCAA member this season (non-members only appear as opponents and are not indexed). */
  member: boolean;
  division: string | null; conference: ConferenceRef | null;
  logo: string | null; athletics_url: string | null;
  coaches: { name: string; title: string | null; is_head: boolean }[];
  record: (Record3 & { gf: number | null; ga: number | null; conf: Record3 | null }) | null;
  standing: { rank: number | null; pod: string | null; conf_pts: number | null } | null;
  poll: { rank: number; label: string | null } | null;
  roster: RosterEntry[];
  games: TeamGame[];
  updated_at: string | null;
}

export interface PlayerSeason {
  season: number; team: TeamRef; jersey: number | null; position: string | null; class_label: string | null;
  gp: number | null; gs: number | null; minutes: number | null; goals: number | null; assists: number | null; points: number | null;
  shots: number | null; sog: number | null; saves: number | null; ga: number | null; gaa: number | null; save_pct: number | null; shutouts: number | null;
}

export interface PlayerPage {
  id: string; slug: string; name: string;
  /** Kept out of search engines on request (college_players.noindex). */
  noindex: boolean;
  headshot_url: string | null; hometown: string | null; high_school: string | null;
  /** Newest first. */
  seasons: PlayerSeason[];
  honors: string[];
  updated_at: string | null;
}

export interface MatchSide { name: string; team: TeamRef | null; score: number | null; conference: string | null }
export interface MatchEvent { minute: string | null; side: 'home' | 'away' | null; type: 'goal' | 'yellow' | 'red'; player: string | null; assist: string | null }
export interface TeamLine { shots: number | null; sog: number | null; corners: number | null; fouls: number | null; saves: number | null; yc: number | null; rc: number | null }
export interface BoxLine { name: string; slug: string | null; jersey: number | null; position: string | null; starter: boolean; minutes: number | null; goals: number | null; assists: number | null; shots: number | null; saves: number | null; is_goalie: boolean }

export interface MatchPage {
  id: string; slug: string; season: number; date: string;
  /** Unix seconds; null or kickoff_tbd when no time is published. */
  start_epoch: number | null; kickoff_tbd: boolean;
  gender: Gender; division: string | null; status: string;
  home: MatchSide; away: MatchSide;
  overtime: boolean; shootout: boolean; neutral_site: boolean; conference_game: boolean; postseason: boolean; tournament: string | null;
  venue_name: string | null; venue_city: string | null; attendance: number | null;
  events: MatchEvent[];
  team_stats: { home: TeamLine | null; away: TeamLine | null };
  players: { home: BoxLine[]; away: BoxLine[] };
  updated_at: string | null;
}

export interface StandingRow { rank: number | null; pod: string | null; team: TeamRef; conf: Record3; conf_pts: number | null; overall: Record3 | null; gf: number | null; ga: number | null }
export interface ConferencePage {
  id: string; seo: string; name: string; short_name: string | null; division: string | null; season: number;
  tables: { gender: Gender; source: string; rows: StandingRow[]; members: TeamRef[] }[];
}

export interface PollRow { rank: number; name: string; team: TeamRef | null; points: number | null; record: string | null; previous_rank: number | null; first_place_votes: number | null }
export interface Poll { gender: Gender; division: string; week_of: string; label: string | null; rows: PollRow[] }
export interface RankingsPage { season: number; polls: Poll[] }

export interface TeamsIndexEntry { team: TeamRef; division: string | null; conference: ConferenceRef | null }
export interface TeamsIndexPage { season: number; teams: TeamsIndexEntry[] }

export interface HomePage { season: number; conferences: ConferenceRef[]; polls: Poll[]; teams: number }

export interface SitemapEntry { path: string; lastmod?: string | null }

export type EntityKind = 'team' | 'player' | 'match' | 'conference';

/** Everything the SEO routes and sitemaps read. Implemented over the database in data.ts. */
export interface SeoData {
  /** The fall season in progress (July rollover), same rule as /api/meta. */
  currentSeason(): number;
  /** One program for a season; `season` null means the current season, or the program's latest when it has none. */
  team(school: string, gender: Gender, season: number | null): Promise<TeamPage | null>;
  teamKeyById(id: string): Promise<{ school_seo: string; gender: Gender } | null>;
  player(slug: string): Promise<PlayerPage | null>;
  playerSlugById(id: string): Promise<string | null>;
  match(slug: string): Promise<MatchPage | null>;
  matchSlugById(id: string): Promise<string | null>;
  /** The current slug of a player or game that used to answer at `slug` (renamed, reoriented). */
  renamedSlug(kind: 'player' | 'game', slug: string): Promise<string | null>;
  conference(seo: string, season: number): Promise<ConferencePage | null>;
  conferenceSeoById(id: string): Promise<string | null>;
  rankings(season: number): Promise<RankingsPage>;
  teams(season: number): Promise<TeamsIndexPage>;
  home(season: number): Promise<HomePage>;
  /** Slug (or "school/gender" for teams) to the entity's uuid, for the single-page app. */
  resolve(kind: EntityKind, key: string): Promise<string | null>;
  sitemapSeasons(): Promise<number[]>;
  sitemapTeams(): Promise<SitemapEntry[]>;
  sitemapConferences(): Promise<SitemapEntry[]>;
  countMatches(season: number): Promise<number>;
  matches(season: number, offset: number, limit: number): Promise<SitemapEntry[]>;
  countPlayers(season: number): Promise<number>;
  players(season: number, offset: number, limit: number): Promise<SitemapEntry[]>;
}
