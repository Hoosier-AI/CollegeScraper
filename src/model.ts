// Canonical, source-independent shapes. Every adapter (Sidearm, Presto, NCAA.com) maps its
// payload into these; jobs and the DB layer only ever see these types.

export type Gender = 'm' | 'w';
export type Division = 'd1' | 'd2' | 'd3';
export type SourceKind = 'sidearm' | 'presto' | 'ncaa';
export type SitePlatform = 'sidearm' | 'presto' | 'wmt' | 'other' | 'unknown';
export type Num = number | null;

/** A player as listed on a roster page/feed. */
export interface RosterPlayer {
  /** Stable key within this source + program + season (site player id, else "last|first|jersey"). */
  sourceKey: string;
  sitePlayerId: string | null;
  firstName: string;
  lastName: string;
  jersey: Num;
  positionRaw: string | null;
  classRaw: string | null;
  heightRaw: string | null;
  weightLb: Num;
  hometownRaw: string | null;
  highSchool: string | null;
  previousSchool: string | null;
  major: string | null;
  isCaptain: boolean;
  headshotUrl: string | null;
  bioUrl: string | null;
}

export interface Coach {
  name: string;
  title: string | null;
  isHead: boolean;
  headshotUrl: string | null;
}

export interface Roster {
  players: RosterPlayer[];
  coaches: Coach[];
  sourceUrl: string;
}

export type GameState = 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled';

/** One row of a program's schedule/results list. */
export interface ScheduleEntry {
  /** ISO date YYYY-MM-DD in the school's local time. */
  date: string;
  startTimeLocal: string | null;
  opponentName: string;
  opponentSiteId: string | null;
  homeAway: 'H' | 'A' | 'N';
  location: string | null;
  isConference: boolean;
  isExhibition: boolean;
  tournament: string | null;
  state: GameState;
  result: { status: 'W' | 'L' | 'T'; teamScore: number; opponentScore: number } | null;
  /** Absolute URL of the school's box score for this game, when linked. */
  boxScoreUrl: string | null;
  siteGameId: string | null;
  attendance: Num;
}

/** Season-to-date line for one player from the school's cumulative stats page. */
export interface SeasonPlayerLine {
  sourceKey: string;
  name: string;
  jersey: Num;
  gp: Num; gs: Num; minutes: Num;
  goals: Num; assists: Num; points: Num;
  shots: Num; sog: Num;
  yellow: Num; red: Num; gwg: Num;
  pkGoals: Num; pkAttempts: Num;
  // goalkeeper columns when the site lists them
  goalsAllowed: Num; saves: Num; shutouts: Num; gkMinutes: Num; gaa: Num; savePct: Num;
}

export interface SeasonTeamLine {
  goals: Num; assists: Num; shots: Num; sog: Num; saves: Num;
  fouls: Num; corners: Num; offsides: Num; yellow: Num; red: Num; pkGoals: Num; pkAttempts: Num;
  gamesPlayed: Num;
}

export interface SeasonStats {
  players: SeasonPlayerLine[];
  team: SeasonTeamLine | null;
  opponents: SeasonTeamLine | null;
  sourceUrl: string;
}

export interface PlayerStatLine {
  sourceKey: string;
  firstName: string;
  lastName: string;
  jersey: Num;
  position: string | null;
  starter: boolean;
  participated: boolean;
  minutes: Num;
  goals: Num; assists: Num; points: Num;
  shots: Num; sog: Num; shotsOffTarget: Num;
  pkGoals: Num; pkAttempts: Num;
  fouls: Num; yellow: Num; red: Num; green: Num;
  corners: Num; offsides: Num;
  isGoalie: boolean;
  goalsAllowed: Num; saves: Num; gkMinutes: Num;
  gwg: Num; unassistedGoals: Num; firstGoals: Num; otGoals: Num; emptyNetGoals: Num; tyingGoals: Num; shootoutGoals: Num;
  hatTrick: boolean;
}

export interface PeriodLine {
  period: number;
  score: Num; shots: Num; saves: Num; fouls: Num; corners: Num; offsides: Num;
}

export interface TeamStatLine {
  goals: Num; assists: Num; shots: Num; sog: Num; shotsOffTarget: Num;
  corners: Num; fouls: Num; offsides: Num; saves: Num;
  yellow: Num; red: Num; pkGoals: Num; pkAttempts: Num;
  gkMinutes: Num; gkGoalsAllowed: Num; gkSaves: Num;
  periodLines: PeriodLine[];
}

export interface BoxScoreTeam {
  /** Name as printed by the source. */
  name: string;
  /** Source's own id/code for the team (Sidearm teamId code, NCAA teamId, Presto slug). */
  sourceTeamId: string | null;
  /** NCAA seo slug when the source knows it (NCAA.com only). */
  ncaaSeo: string | null;
  isHome: boolean;
  score: Num;
  record: string | null;
  totals: TeamStatLine;
  players: PlayerStatLine[];
}

export type EventType =
  | 'goal' | 'shot' | 'save' | 'corner' | 'foul' | 'yellow' | 'red' | 'green'
  | 'sub_in' | 'sub_out' | 'offside' | 'pk' | 'goalie_change' | 'other';

export interface GameEvent {
  period: number;
  clock: string | null;
  clockSeconds: Num;
  seq: number;
  side: 'home' | 'away' | null;
  type: EventType;
  playerNameRaw: string | null;
  assistNameRaw: string | null;
  homeScore: Num;
  awayScore: Num;
  text: string;
}

export interface BoxScore {
  source: SourceKind;
  sourceUrl: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  startTimeLocal: string | null;
  status: GameState;
  venueName: string | null;
  venueCity: string | null;
  attendance: Num;
  officials: { title: string; name: string }[];
  neutral: boolean;
  conferenceGame: boolean;
  postseason: boolean;
  tournament: string | null;
  overtime: boolean;
  shootout: boolean;
  durationMin: Num;
  periods: number;
  home: BoxScoreTeam;
  away: BoxScoreTeam;
  events: GameEvent[];
  /** NCAA contest id when the source is NCAA.com. */
  ncaaContestId: string | null;
}

export interface PlayerBio {
  honors: string[];
  bioText: string | null;
  sourceUrl: string;
}

/** Everything an adapter needs to know about one program on its athletics site. */
export interface SiteContext {
  host: string;            // e.g. goduke.com
  baseUrl: string;         // https://goduke.com
  gender: Gender;
  season: number;          // fall calendar year
  sportSlug: string | null;   // sidearm: mens-soccer ; presto: msoc
  sportId: number | null;     // sidearm sport id (from roster json)
  teamSlug: string | null;    // presto: /teams/{teamSlug}
}

export interface HttpResponseLike {
  status: number;
  url: string;
  text: string;
  notModified: boolean;
}

export interface Fetcher {
  get(url: string, opts?: { accept?: string; skipCache?: boolean; attempts?: number }): Promise<HttpResponseLike>;
}

export interface SiteAdapter {
  readonly platform: Exclude<SitePlatform, 'other' | 'unknown'>;
  /** Fill sportSlug/sportId/teamSlug for this program. Returns null when the sport is not found on the site. */
  discover(fetcher: Fetcher, ctx: SiteContext): Promise<SiteContext | null>;
  roster(fetcher: Fetcher, ctx: SiteContext): Promise<Roster>;
  schedule(fetcher: Fetcher, ctx: SiteContext): Promise<ScheduleEntry[]>;
  seasonStats(fetcher: Fetcher, ctx: SiteContext): Promise<SeasonStats | null>;
  boxScore(fetcher: Fetcher, ctx: SiteContext, url: string, hint?: { date?: string | null }): Promise<BoxScore>;
  playerBio(fetcher: Fetcher, ctx: SiteContext, url: string): Promise<PlayerBio>;
}

export const EMPTY_TEAM_LINE = (): TeamStatLine => ({
  goals: null, assists: null, shots: null, sog: null, shotsOffTarget: null,
  corners: null, fouls: null, offsides: null, saves: null,
  yellow: null, red: null, pkGoals: null, pkAttempts: null,
  gkMinutes: null, gkGoalsAllowed: null, gkSaves: null, periodLines: [],
});

export const EMPTY_PLAYER_LINE = (sourceKey: string, firstName: string, lastName: string): PlayerStatLine => ({
  sourceKey, firstName, lastName, jersey: null, position: null, starter: false, participated: true,
  minutes: null, goals: null, assists: null, points: null, shots: null, sog: null, shotsOffTarget: null,
  pkGoals: null, pkAttempts: null, fouls: null, yellow: null, red: null, green: null, corners: null, offsides: null,
  isGoalie: false, goalsAllowed: null, saves: null, gkMinutes: null,
  gwg: null, unassistedGoals: null, firstGoals: null, otGoals: null, emptyNetGoals: null, tyingGoals: null, shootoutGoals: null,
  hatTrick: false,
});
