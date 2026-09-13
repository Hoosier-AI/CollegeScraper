// Map the four NCAA GraphQL game documents (box score, team stats, play-by-play, scoring summary)
// plus the optional gamecenter contest record into the canonical BoxScore.
//
// Fixture quirks (contest 6310566) that shape the mapping below:
//  * numbers arrive as strings ("2"), sometimes "" (→ null); `teamBoxscore[].teamId` is a number
//    while `teams[].teamId` is a string.
//  * team-level `shots`, `saves`, `fouls` are "0" while `shotsOnGoal`, `goalie.saves`,
//    `penalties.fouls` carry the real values; `goalie.minutesPlayed` is "990" (11 × 90).
//  * the starting keepers have position "GK" and `goalie: null`; only bench keepers carry the
//    `goalie` sub-object, and every player's `saves` is "0" even though the team goalie line
//    (and the PBP "Save by …" lines) show saves.
//  * the PBP interleaves two feeds (Sidearm-style "Shot by BRY Lyshoj, Jonas, out top." and
//    LiveStats-style "Shot (goalmouth:outhigh;) by Jonas Lyshoj"), clocks are "MM:SS" or
//    "MM:SS:tenths", and homeScore/visitorScore are all null.
import {
  EMPTY_PLAYER_LINE, EMPTY_TEAM_LINE,
  type BoxScore, type BoxScoreTeam, type Division, type EventType, type GameEvent, type GameState,
  type Gender, type PlayerStatLine, type TeamStatLine,
} from '../../model.js';
import { int } from '../../normalize/num.js';
import { cleanName, nameKeyFromDisplay } from '../../normalize/names.js';

export interface NcaaGameDocs {
  /** `data.boxscore` from GetGamecenterBoxscoreSoccerById_web (required). */
  boxscore: unknown;
  /** `data.playbyplay` from GetGamecenterPbpGenericById_web. */
  pbp?: unknown | null;
  /** `data.scoringSummary` from GetGamecenterScoringSummaryById_web. */
  scoring?: unknown | null;
  /** `data.boxscore` from GetGamecenterTeamStatsSoccerById_web (teamStats without players). */
  teamStats?: unknown | null;
  /** `data.contests[0]` from GetGamecenterGameById_web (venue, linescores, records). */
  gamecenter?: unknown | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';

interface RawTeam { teamId: string; isHome: boolean; seoname: string | null; nameShort: string | null; nameFull: string | null; name6Char: string | null; teamName: string | null }

function rawTeams(doc: Obj): RawTeam[] {
  return arr(doc.teams).map((t) => {
    const o = obj(t);
    return {
      teamId: String(o.teamId ?? ''),
      isHome: bool(o.isHome),
      seoname: str(o.seoname),
      nameShort: str(o.nameShort),
      nameFull: str(o.nameFull),
      name6Char: str(o.name6Char),
      teamName: str(o.teamName),
    };
  }).filter((t) => t.teamId !== '');
}

// ---------------------------------------------------------------------------------------------
// Clocks

/** "45:00" | "03:46:04" (MM:SS:tenths) | "1:02:15" → seconds since kickoff. */
export function pbpClockToSeconds(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,3}):(\d{2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Normalise "03:46:04" → "03:46" for display. */
function displayClock(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,3}:\d{2})(?::\d{1,2})?$/);
  return m ? m[1]! : s;
}

// ---------------------------------------------------------------------------------------------
// Play text → event

const nameRe = String.raw`[A-Z][\p{L}'.\-]*(?:[ ,][\p{L}'.\-]+)*`;

/** Strip a leading team abbreviation ("BRY Lyshoj, Jonas" → "Lyshoj, Jonas"). */
function stripAbbrev(name: string): { abbrev: string | null; name: string } {
  const m = name.match(/^([A-Z0-9&]{2,6})\s+(.+)$/);
  if (m && m[1] === m[1]!.toUpperCase() && /^[A-Z]/.test(m[2]!)) return { abbrev: m[1]!, name: m[2]! };
  return { abbrev: null, name };
}

function tidy(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = cleanName(name).replace(/[.,;]+$/, '').trim();
  return s && !/^team$/i.test(s) ? s : null;
}

export interface ClassifiedPlay {
  type: EventType;
  player: string | null;
  assist: string | null;
  /** Team abbreviation embedded in the text ("BRY", "UNH"), when present. */
  abbrev: string | null;
  /** Team display name embedded in the text ("Offside against New Hampshire"). */
  teamName: string | null;
  /** True for "Foulwon by X" — the side must be flipped to the fouling team. */
  flipSide: boolean;
  /** Secondary event produced by the same line (e.g. the outgoing player of a substitution). */
  extra: { type: EventType; player: string | null } | null;
}

/** Classify one play-by-play line using the shared site-adapter vocabulary. */
export function classifyPlay(text: string): ClassifiedPlay {
  const t = cleanName(text);
  const out: ClassifiedPlay = { type: 'other', player: null, assist: null, abbrev: null, teamName: null, flipSide: false, extra: null };
  const byName = (re: RegExp): string | null => {
    const m = t.match(re);
    if (!m || !m[1]) return null;
    const { abbrev, name } = stripAbbrev(m[1].trim());
    if (abbrev) out.abbrev = abbrev;
    return tidy(name);
  };
  // trailing "by <name>" — Sidearm "by BRY Last, First, detail." or LiveStats "by First Last"
  const sidearmBy = new RegExp(String.raw`\bby\s+((?:[A-Z0-9&]{2,6}\s+)?[A-Z][\p{L}'.\-]+,\s*[\p{L}'.\- ]+?)(?=\s*(?:,|\.|\s+Assist\b|\s+for\b|$))`, 'u');
  const liveBy = new RegExp(String.raw`\bby\s+((?:[A-Z0-9&]{2,6}\s+)?[A-Z][\p{L}'.\-]*(?:\s+[\p{L}'.\-]+)*)\s*[.]?$`, 'u');
  const anyBy = (): string | null => byName(sidearmBy) ?? byName(liveBy);

  if (/^(?:[A-Z0-9&]{2,6}\s+)?substitution\s*:/i.test(t) || /^sub(?:stitution)?\b.*\bfor\b/i.test(t)) {
    const m = t.match(/^(?:([A-Z0-9&]{2,6})\s+)?substitution\s*:\s*(.+?)\s+for\s+(.+?)\.?$/i) ?? t.match(/^sub\s+(?:in\s+)?()(.+?)\s+for\s+(.+?)\.?$/i);
    if (m) {
      out.type = 'sub_in';
      out.abbrev = m[1] ? m[1].toUpperCase() : null;
      out.player = tidy(m[2]);
      out.extra = { type: 'sub_out', player: tidy(m[3]) };
      return out;
    }
  }
  if (/^sub\s+in\b/i.test(t)) { out.type = 'sub_in'; out.player = tidy(t.replace(/^sub\s+in\s*/i, '')); return out; }
  if (/^sub\s+out\b/i.test(t)) { out.type = 'sub_out'; out.player = tidy(t.replace(/^sub\s+out\s*/i, '')); return out; }
  if (/at goalie for/i.test(t) || /goal(?:ie|keeper) change/i.test(t)) {
    out.type = 'goalie_change';
    const m = t.match(new RegExp(String.raw`^(${nameRe})\s+at goalie for\s+(.+?)\.?$`, 'u'));
    if (m) { out.player = tidy(m[1]); out.teamName = tidy(m[2]); }
    return out;
  }
  if (/penalty\s*kick|penaltykick|penalty shot/i.test(t)) {
    out.type = /\bgoal\b|\bgood\b|\bmade\b|\bscored\b/i.test(t) ? 'goal' : 'pk';
    out.player = anyBy();
    return out;
  }
  if (/^goal\b(?!\s*kick)/i.test(t) || /\bGOAL by\b/.test(t) || /^goal\s*\(/i.test(t)) {
    out.type = 'goal';
    const m = t.match(new RegExp(String.raw`\bby\s+((?:[A-Z0-9&]{2,6}\s+)?.+?)\s+Assist(?:ed)?\s+by\s+(.+?)\.?$`, 'iu'));
    if (m) {
      const p = stripAbbrev(m[1]!.trim()); if (p.abbrev) out.abbrev = p.abbrev;
      out.player = tidy(p.name); out.assist = tidy(m[2]);
    } else {
      out.player = anyBy();
      const a = t.match(/\bassist(?:ed)?\s+by\s+(.+?)\.?$/i); if (a) out.assist = tidy(a[1]);
    }
    return out;
  }
  if (/^assist\b/i.test(t)) { out.type = 'other'; out.assist = anyBy(); return out; }
  if (/^shot\b|\bshot by\b|^header\b|^blocked shot|^shot on goal/i.test(t)) { out.type = 'shot'; out.player = anyBy(); return out; }
  if (/^saved?\s+by\b|^save\b/i.test(t)) { out.type = 'save'; out.player = anyBy(); return out; }
  if (/^corner/i.test(t)) { out.type = 'corner'; out.player = anyBy(); return out; }
  if (/yellow\s*card|cardyellow/i.test(t)) { out.type = 'yellow'; out.player = anyBy() ?? tidy(t.match(/yellow card\s+(?:on|to|for)\s+(.+?)\.?$/i)?.[1]); return out; }
  if (/red\s*card|cardred/i.test(t)) { out.type = 'red'; out.player = anyBy() ?? tidy(t.match(/red card\s+(?:on|to|for)\s+(.+?)\.?$/i)?.[1]); return out; }
  if (/green\s*card|cardgreen/i.test(t)) { out.type = 'green'; out.player = anyBy(); return out; }
  if (/^foul\s*won\b|^foulwon\b/i.test(t)) { out.type = 'foul'; out.flipSide = true; return out; }
  if (/^foul\b/i.test(t)) {
    out.type = 'foul';
    out.player = tidy(t.match(/^foul\s+(?:on|by|committed by)\s+(.+?)\.?$/i)?.[1]) ?? anyBy();
    return out;
  }
  if (/^offside/i.test(t)) {
    out.type = 'offside';
    const m = t.match(/^offside(?:s)?\s+(?:against|on|by)\s+(.+?)\.?$/i);
    if (m) { const p = stripAbbrev(m[1]!.trim()); if (p.abbrev) out.abbrev = p.abbrev; out.teamName = tidy(p.name); }
    return out;
  }
  const t0 = t.match(/^([A-Z0-9&]{2,6})\s/);
  if (t0 && /^[A-Z0-9&]+$/.test(t0[1]!)) out.abbrev = t0[1]!;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Events

interface SideResolver { fromTeamId(id: unknown): 'home' | 'away' | null; fromAbbrev(a: string | null): 'home' | 'away' | null; fromName(n: string | null): 'home' | 'away' | null }

function sideResolver(teams: RawTeam[]): SideResolver {
  const home = teams.find((t) => t.isHome) ?? null;
  const away = teams.find((t) => !t.isHome) ?? null;
  const norm = (s: string | null) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matchAbbrev = (t: RawTeam | null, a: string) => {
    if (!t) return false;
    const c6 = norm(t.name6Char), sh = norm(t.nameShort);
    return !!a && (c6 === a || c6.startsWith(a) || a.startsWith(c6) && c6.length >= 3 || sh.startsWith(a));
  };
  return {
    fromTeamId: (id) => { const s = id == null ? '' : String(id); if (!s) return null; if (home && s === home.teamId) return 'home'; if (away && s === away.teamId) return 'away'; return null; },
    fromAbbrev: (a) => { if (!a) return null; const A = norm(a); const h = matchAbbrev(home, A), w = matchAbbrev(away, A); return h && !w ? 'home' : w && !h ? 'away' : null; },
    fromName: (n) => {
      if (!n) return null; const N = norm(n);
      const hit = (t: RawTeam | null) => !!t && [t.nameShort, t.nameFull, t.teamName, t.name6Char].some((x) => x && norm(x) === N);
      const h = hit(home), w = hit(away); return h && !w ? 'home' : w && !h ? 'away' : null;
    },
  };
}

function periodIsOvertime(n: number, display: string | null): boolean {
  return n > 2 || /\bOT\b|overtime/i.test(display ?? '');
}
function periodIsShootout(display: string | null): boolean {
  return /\bPK\b|shootout|penalt/i.test(display ?? '');
}

interface Built { events: GameEvent[]; periods: number; overtime: boolean; shootout: boolean; goalsHome: number; goalsAway: number; savesByPlayer: Map<string, number>; shotsBySide: { home: number; away: number } }

export function buildEvents(pbp: Obj, teams: RawTeam[]): Built {
  const sides = sideResolver(teams);
  const periods = arr(pbp.periods).map(obj);
  type Draft = Omit<GameEvent, 'seq' | 'homeScore' | 'awayScore'> & { feedHome: number | null; feedAway: number | null; key: string | null; isAssist: boolean };
  const drafts: Draft[] = [];
  let overtime = false, shootout = false, maxPeriod = 0;
  for (const p of periods) {
    const periodNumber = int(p.periodNumber) ?? maxPeriod + 1;
    const display = str(p.periodDisplay);
    maxPeriod = Math.max(maxPeriod, periodNumber);
    if (periodIsOvertime(periodNumber, display)) overtime = true;
    if (periodIsShootout(display)) shootout = true;
    for (const g of arr(p.playbyplayStats).map(obj)) {
      const groupSide = sides.fromTeamId(g.teamId);
      for (const pl of arr(g.plays).map(obj)) {
        const text = cleanName(str(pl.playText) ?? '');
        if (!text) continue;
        const clockRaw = str(pl.clock) ?? str(g.clock);
        const clockSeconds = pbpClockToSeconds(clockRaw);
        const c = classifyPlay(text);
        let side = sides.fromTeamId(pl.teamId) ?? groupSide;
        const textSide = sides.fromAbbrev(c.abbrev) ?? sides.fromName(c.teamName);
        if (textSide) side = textSide;
        if (c.flipSide && side) side = side === 'home' ? 'away' : 'home';
        const base = { period: periodNumber, clock: displayClock(clockRaw), clockSeconds, side, feedHome: int(pl.homeScore), feedAway: int(pl.visitorScore) };
        const mk = (type: EventType, player: string | null, assist: string | null, isAssist = false): Draft => ({
          ...base, type, playerNameRaw: player, assistNameRaw: assist, text,
          isAssist,
          key: type === 'other' ? null : `${periodNumber}|${type}|${side ?? '?'}|${clockSeconds ?? '?'}|${type === 'foul' || type === 'corner' || type === 'offside' ? '' : player ? nameKeyFromDisplay(player) : ''}`,
        });
        drafts.push(mk(c.type, c.player, c.assist, c.type === 'other' && !!c.assist));
        if (c.extra) drafts.push(mk(c.extra.type, c.extra.player, null));
      }
    }
  }
  // Stable order by (period, clock) so the two interleaved feeds line up; clock-less rows sort first.
  const ordered = drafts.map((d, i) => ({ d, i })).sort((a, b) =>
    a.d.period - b.d.period || (a.d.clockSeconds ?? -1) - (b.d.clockSeconds ?? -1) || a.i - b.i).map((x) => x.d);
  // Dedupe cross-feed duplicates (same period/type/side/second/player) and fold "Assist by X" into its goal.
  const kept: Draft[] = [];
  const seen = new Map<string, Draft>();
  for (const d of ordered) {
    if (d.isAssist) {
      const goal = [...kept].reverse().find((k) => k.type === 'goal' && k.period === d.period && (k.side === d.side || !d.side) && !k.assistNameRaw);
      if (goal) { goal.assistNameRaw = d.assistNameRaw; continue; }
    }
    if (d.key) {
      const prev = seen.get(d.key);
      if (prev) {
        if (!prev.playerNameRaw && d.playerNameRaw) prev.playerNameRaw = d.playerNameRaw;
        if (!prev.assistNameRaw && d.assistNameRaw) prev.assistNameRaw = d.assistNameRaw;
        continue;
      }
      seen.set(d.key, d);
    }
    kept.push(d);
  }
  let home = 0, away = 0;
  const savesByPlayer = new Map<string, number>();
  const shotsBySide = { home: 0, away: 0 };
  const events: GameEvent[] = kept.map((d, i) => {
    if (d.type === 'goal') { if (d.side === 'home') home += 1; else if (d.side === 'away') away += 1; }
    if (d.feedHome != null && d.feedAway != null) { home = d.feedHome; away = d.feedAway; }
    if (d.type === 'save' && d.playerNameRaw) { const k = nameKeyFromDisplay(d.playerNameRaw); savesByPlayer.set(k, (savesByPlayer.get(k) ?? 0) + 1); }
    if ((d.type === 'shot' || d.type === 'goal') && d.side) shotsBySide[d.side] += 1;
    const { feedHome: _h, feedAway: _a, key: _k, isAssist: _i, ...rest } = d;
    void _h; void _a; void _k; void _i;
    return { ...rest, seq: i + 1, homeScore: home, awayScore: away };
  });
  return { events, periods: maxPeriod, overtime, shootout, goalsHome: home, goalsAway: away, savesByPlayer, shotsBySide };
}

// ---------------------------------------------------------------------------------------------
// Players & totals

const isGkPosition = (p: string | null) => /^(gk|g|goalkeeper|goalie|keeper)$/i.test((p ?? '').trim());

/** Prefer the larger of two possibly-null counts (NCAA often zero-fills one of the duplicates). */
function best(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function plausibleMinutes(m: number | null): number | null {
  return m != null && m >= 0 && m <= 150 ? m : null;
}

export function mapPlayer(raw: Obj, savesFromPbp: Map<string, number>): PlayerStatLine {
  const first = cleanName(str(raw.firstName) ?? '');
  const last = cleanName(str(raw.lastName) ?? '');
  const number = int(raw.number);
  const sourceKey = `${last}|${first}|${number ?? ''}`.toLowerCase();
  const goalie = raw.goalie && typeof raw.goalie === 'object' ? obj(raw.goalie) : null;
  const pen = obj(raw.penalties);
  const gt = obj(raw.goalTypes);
  const position = str(raw.position);
  const isGoalie = goalie != null || isGkPosition(position);
  const goals = int(raw.goals), assists = int(raw.assists);
  const pbpSaves = savesFromPbp.get(nameKeyFromDisplay(`${first} ${last}`)) ?? null;
  const minutes = int(raw.minutesPlayed);
  const line: PlayerStatLine = {
    ...EMPTY_PLAYER_LINE(sourceKey, first, last),
    jersey: number,
    position,
    starter: bool(raw.starter),
    participated: bool(raw.participated),
    minutes,
    goals, assists,
    points: int(raw.points) ?? (goals != null && assists != null ? goals * 2 + assists : null),
    shots: int(raw.shots), sog: int(raw.shotsOnGoal),
    pkGoals: int(raw.penaltyShotGoals), pkAttempts: int(raw.penaltyShotAttempts),
    fouls: int(pen.fouls), yellow: int(pen.yellowCards), red: int(pen.redCards), green: int(pen.greenCards),
    isGoalie,
    goalsAllowed: isGoalie ? (int(raw.goalsAllowed) ?? int(goalie?.goalsAllowed)) : null,
    saves: isGoalie ? best(best(int(raw.saves), int(goalie?.saves)), pbpSaves) : int(raw.saves),
    gkMinutes: isGoalie ? plausibleMinutes(int(goalie?.minutesPlayed) ?? minutes) : null,
    gwg: int(gt.gameWinningGoals), unassistedGoals: int(gt.unassistedGoals), firstGoals: int(gt.firstGoals),
    otGoals: int(gt.overtimeGoals), emptyNetGoals: int(gt.emptyNetGoals), tyingGoals: int(gt.gameTyingGoals),
    shootoutGoals: int(gt.shootoutGoals),
    hatTrick: (int(gt.hattricks) ?? 0) > 0,
  };
  if (line.shots != null && line.sog != null) {
    if (line.shots < line.sog) line.shots = null; // zero-filled shots (see header)
    else line.shotsOffTarget = line.shots - line.sog;
  }
  return line;
}

export function mapTeamTotals(ts: Obj, pbpShots: number | null): TeamStatLine {
  const goalie = obj(ts.goalie);
  const pen = obj(ts.penalties);
  const line: TeamStatLine = {
    ...EMPTY_TEAM_LINE(),
    goals: int(ts.goals), assists: int(ts.assists),
    shots: int(ts.shots), sog: int(ts.shotsOnGoal),
    corners: int(ts.corners),
    fouls: best(int(ts.fouls), int(pen.fouls)),
    offsides: int(ts.offsides),
    saves: best(int(ts.saves), int(goalie.saves)),
    yellow: int(pen.yellowCards), red: int(pen.redCards),
    pkGoals: int(ts.penaltyShotGoals), pkAttempts: int(ts.penaltyShotAttempts),
    gkMinutes: plausibleMinutes(int(goalie.minutesPlayed)),
    gkGoalsAllowed: int(goalie.goalsAllowed), gkSaves: int(goalie.saves),
  };
  // NCAA zero-fills total shots; when implausible (< SOG) fall back to the PBP count (shots + goals).
  if (line.shots != null && line.sog != null && line.shots < line.sog) {
    line.shots = pbpShots != null && pbpShots >= line.sog ? pbpShots : null;
  }
  if (line.shots != null && line.sog != null) line.shotsOffTarget = line.shots - line.sog;
  return line;
}

function mapStatus(status: string | null, period: string | null): GameState {
  const s = (status ?? '').toLowerCase(), p = (period ?? '').toLowerCase();
  if (s === 'f' || s === 'final' || p === 'final') return 'final';
  if (s === 'i' || s === 'live' || s === 'in progress' || s === 'in-progress') return 'live';
  if (s.includes('postpone') || p.includes('postpone')) return 'postponed';
  if (s.includes('cancel') || p.includes('cancel')) return 'cancelled';
  return 'scheduled';
}

// ---------------------------------------------------------------------------------------------

export function parseNcaaBoxScore(docs: NcaaGameDocs, contestId: string, gender: Gender, division: Division, date: string): BoxScore {
  void gender; void division;
  const box = obj(docs.boxscore);
  const tsDoc = obj(docs.teamStats);
  const pbp = obj(docs.pbp);
  const scoring = obj(docs.scoring);
  const gc = obj(docs.gamecenter);

  const teams = [rawTeams(box), rawTeams(tsDoc), rawTeams(pbp), rawTeams(scoring), rawTeams(gc)].find((t) => t.length >= 2) ?? rawTeams(box);
  const homeRaw = teams.find((t) => t.isHome);
  const awayRaw = teams.find((t) => !t.isHome);
  if (!homeRaw || !awayRaw) throw new Error(`parseNcaaBoxScore(${contestId}): could not identify home/away teams`);

  const built = buildEvents(pbp, teams);

  const teamBox = (doc: Obj, teamId: string): Obj | null => {
    const hit = arr(doc.teamBoxscore).map(obj).find((tb) => String(tb.teamId ?? '') === teamId);
    return hit ?? null;
  };

  const scoreFor = (teamId: string, isHome: boolean): number | null => {
    const fromDoc = (doc: Obj) => { const t = arr(doc.teams).map(obj).find((x) => String(x.teamId ?? '') === teamId); return t ? int(t.score) : null; };
    void isHome; return fromDoc(scoring) ?? fromDoc(gc) ?? null;
  };

  let anyShootoutGoals = false;
  const buildTeam = (raw: RawTeam, isHome: boolean): BoxScoreTeam => {
    const tb = teamBox(box, raw.teamId);
    const tbStats = teamBox(tsDoc, raw.teamId);
    const statsObj = obj(tbStats?.teamStats ?? tb?.teamStats);
    const side: 'home' | 'away' = isHome ? 'home' : 'away';
    const totals = mapTeamTotals(statsObj, built.events.length > 0 ? built.shotsBySide[side] : null);
    const players = arr(tb?.playerStats).map((p) => mapPlayer(obj(p), built.savesByPlayer));
    // Sole participating keeper: inherit the team goalie line when the player row is zero-filled.
    const keepers = players.filter((p) => p.isGoalie && p.participated);
    if (keepers.length === 1) {
      const k = keepers[0]!;
      if ((k.saves ?? 0) === 0 && (totals.gkSaves ?? 0) > 0) k.saves = totals.gkSaves;
      if (k.goalsAllowed == null && totals.gkGoalsAllowed != null) k.goalsAllowed = totals.gkGoalsAllowed;
      if (k.gkMinutes == null && k.minutes != null) k.gkMinutes = k.minutes;
    }
    if ((int(obj(statsObj.goalTypes).shootoutGoals) ?? 0) > 0 || players.some((p) => (p.shootoutGoals ?? 0) > 0)) anyShootoutGoals = true;
    const playerGoals = players.reduce<number | null>((acc, p) => (p.goals == null ? acc : (acc ?? 0) + p.goals), null);
    const score = scoreFor(raw.teamId, isHome) ?? totals.goals ?? playerGoals ?? (built.events.some((e) => e.type === 'goal') ? (isHome ? built.goalsHome : built.goalsAway) : null);
    const gcTeam = arr(gc.teams).map(obj).find((t) => String(t.teamId ?? '') === raw.teamId);
    const record = str(gcTeam?.record)?.replace(/[()]/g, '') ?? null;
    // Per-period score lines from the gamecenter linescores.
    const linescores = arr(gc.linescores).map(obj);
    totals.periodLines = linescores.map((ls, i) => ({
      period: i + 1, score: int(isHome ? ls.home : ls.visit), shots: null, saves: null, fouls: null, corners: null, offsides: null,
    }));
    return {
      name: raw.nameShort ?? raw.nameFull ?? raw.seoname ?? raw.teamId,
      sourceTeamId: raw.teamId,
      ncaaSeo: raw.seoname,
      isHome,
      score,
      record,
      totals,
      players,
    };
  };

  const home = buildTeam(homeRaw, true);
  const away = buildTeam(awayRaw, false);

  const status = mapStatus(str(box.status) ?? str(pbp.status), str(box.period));
  const location = obj(gc.location);
  const venueName = str(location.venue);
  const venueCity = [str(location.city), str(location.stateUsps)].filter(Boolean).join(', ') || null;
  const periods = Math.max(built.periods, arr(gc.linescores).length, status === 'final' ? 2 : 0);
  const overtime = built.overtime || periods > 2;
  const shootout = built.shootout || anyShootoutGoals;

  return {
    source: 'ncaa',
    sourceUrl: `https://www.ncaa.com/game/${contestId}`,
    date,
    startTimeLocal: str(gc.startTime),
    status,
    venueName,
    venueCity,
    attendance: null,
    officials: [],
    neutral: false,
    conferenceGame: false,
    postseason: bool(gc.isChampionship) || bool(gc.isConferenceTournament),
    tournament: null,
    overtime,
    shootout,
    durationMin: null,
    periods,
    home,
    away,
    events: built.events,
    ncaaContestId: contestId,
  };
}
