// Sidearm nextgen box score: /sports/{sportSlug}/stats/{season}/{opponent}/boxscore/{gameId}
// The whole game lives in the Nuxt payload (pinia → boxscore → boxscore → {[gameId]: game}).
// Every number is a string. Team `id` is the StatCrew code ("DUKE") that plays/scores/penalties
// reference; `code` is Sidearm's numeric id. Play clocks are elapsed-from-kickoff "mm:ss".
import type { BoxScore, BoxScoreTeam, EventType, GameEvent, PeriodLine, PlayerStatLine, SiteContext, TeamStatLine } from '../../../model.js';
import { EMPTY_PLAYER_LINE, EMPTY_TEAM_LINE } from '../../../model.js';
import { clockToSeconds, minutesFromClock } from '../../../normalize/clock.js';
import { int } from '../../../normalize/num.js';
import { cleanName, splitName } from '../../../normalize/names.js';
import { arr, bool, collapse, isObj, isoDate, nameJerseyKey, obj, str, type Dict } from './common.js';
import { decodeNuxtData, findObject } from './devalue.js';

/** Locate the embedded game object in a decoded Nuxt payload. */
export function findEmbeddedGame(root: unknown): Dict | null {
  const pinia = obj(obj(root)['pinia']);
  const store = obj(pinia['boxscore']);
  const games = obj(store['boxscore']);
  for (const v of Object.values(games)) if (isObj(v) && isObj(v['homeTeam']) && isObj(v['visitingTeam'])) return v;
  return findObject(root, (o) => isObj(o['homeTeam']) && isObj(o['visitingTeam']) && ('plays' in o || 'scores' in o || 'venue' in o));
}

const ACTION_MAP: Record<string, EventType> = {
  GOAL: 'goal', SHOT: 'shot', SAVE: 'save', CORNER: 'corner', FOUL: 'foul',
  YELLOW: 'yellow', YC: 'yellow', RED: 'red', RC: 'red', GREEN: 'green', GC: 'green',
  SUB: 'sub_in', OFFSIDE: 'offside', PENALTY: 'pk', PK: 'pk', PENALTYKICK: 'pk',
  GOALIE: 'goalie_change', KEEPER: 'goalie_change',
};

function mapAction(action: string | null, text: string): EventType {
  const a = (action ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (a in ACTION_MAP) return ACTION_MAP[a]!;
  if (/^(END|PRD|START|FOR|LINEUP|TIMEOUT|CLOCK)/.test(a)) return 'other';
  const t = text.toLowerCase();
  if (/^goal by|scores/.test(t)) return 'goal';
  if (/penalty kick/.test(t)) return 'pk';
  if (/^shot by/.test(t)) return 'shot';
  if (/^save by|^save /.test(t)) return 'save';
  if (/corner kick/.test(t)) return 'corner';
  if (/^foul/.test(t)) return 'foul';
  if (/yellow card/.test(t)) return 'yellow';
  if (/red card/.test(t)) return 'red';
  if (/offside/.test(t)) return 'offside';
  if (/substitution|sub in|sub out/.test(t)) return 'sub_in';
  if (/at goalie|goalie change/.test(t)) return 'goalie_change';
  return 'other';
}

/** "Agunbiade, Remi" → "Remi Agunbiade"; already "First Last" stays as-is. */
export function displayFromLastFirst(raw: string | null | undefined): string | null {
  const s = collapse(raw)?.replace(/[.,;]+$/, '');
  if (!s) return null;
  if (!s.includes(',')) return s;
  const { firstName, lastName } = splitName(s);
  return cleanName(`${firstName} ${lastName}`);
}

/**
 * A "Last, First[ Middle]" token, optionally preceded by "#NN " or a TEAMCODE.
 * NAME is lazy (use with an explicit terminator such as " Assist" / " for " / " at goalie");
 * NAME_G is greedy up to the next comma/period/paren (use when the name ends the clause).
 */
const NAME = "([A-Za-z'’.\\- ]+?, [A-Za-z'’.\\- ]+?)";
const NAME_G = "([A-Za-z'’.\\- ]+?, [A-Za-z'’\\-]+(?: [A-Za-z'’\\-]+)*)";
const TEAMCODE = '(?:[A-Z0-9&.]{2,10} )?';

function stripTeamCode(name: string | null, codes: string[]): string | null {
  if (!name) return null;
  let s = name.trim();
  for (const c of codes) if (c && s.toUpperCase().startsWith(`${c.toUpperCase()} `)) s = s.slice(c.length + 1);
  return s.replace(/^#?\d+\s+/, '').trim() || null;
}

interface ParsedText { player: string | null; assist: string | null; secondary: string | null; outPlayer: string | null; saver: string | null }

/** Pull player names out of a play-by-play text for the actions that carry no player field. */
export function parsePlayText(type: EventType, text: string, codes: string[]): ParsedText {
  const t = text.replace(/\s+/g, ' ').trim();
  const out: ParsedText = { player: null, assist: null, secondary: null, outPlayer: null, saver: null };
  const grab = (re: RegExp, i = 1): string | null => { const m = t.match(re); return m ? stripTeamCode(m[i] ?? null, codes) : null; };
  switch (type) {
    case 'goal': {
      out.player = grab(new RegExp(`^GOAL by ${TEAMCODE}${NAME}(?: \\(|,| Assist| assist|\\.|$)`, 'i')) ?? grab(new RegExp(`^${TEAMCODE}${NAME} scores`, 'i'));
      const assist = t.match(/Assist(?:ed)? by ([^.()]+?)(?:\.|$)/i) ?? t.match(/\(Assist(?:ed)?(?: by)?:? ([^)]+)\)/i) ?? t.match(/\(([^)]+)\)\s*\.?$/);
      if (assist?.[1]) {
        const parts = assist[1].split(/ and |;/).map((s) => stripTeamCode(s, codes)).filter((s): s is string => !!s && !/^unassisted$/i.test(s));
        out.assist = parts[0] ?? null; out.secondary = parts[1] ?? null;
      }
      break;
    }
    case 'shot':
      out.player = grab(new RegExp(`^Shot by ${TEAMCODE}${NAME_G}`, 'i')) ?? grab(new RegExp(`^${TEAMCODE}${NAME} shot`, 'i'));
      out.saver = grab(/saved? by ([^.,]+(?:, [^.,]+)?)\.?$/i) ?? grab(/\bSAVE ([^.,]+, [^.,]+)/);
      break;
    case 'save':
      out.player = grab(new RegExp(`^Save by ${TEAMCODE}${NAME_G}`, 'i')) ?? grab(new RegExp(`^${TEAMCODE}${NAME} save`, 'i'));
      break;
    case 'corner':
      out.player = grab(new RegExp(`Corner kick by ${TEAMCODE}${NAME_G}`, 'i'));
      break;
    case 'foul':
      out.player = grab(new RegExp(`^Foul (?:on|by) ${TEAMCODE}${NAME_G}`, 'i'));
      break;
    case 'yellow': case 'red': case 'green':
      out.player = grab(new RegExp(`card (?:on|to) ${TEAMCODE}${NAME_G}`, 'i')) ?? grab(new RegExp(`^${TEAMCODE}${NAME} (?:yellow|red|green) card`, 'i'));
      break;
    case 'sub_in': case 'sub_out': {
      const m = t.match(new RegExp(`substitution: ${NAME} for ${NAME_G}`, 'i'));
      if (m) { out.player = stripTeamCode(m[1] ?? null, codes); out.outPlayer = stripTeamCode(m[2] ?? null, codes); break; }
      out.player = grab(new RegExp(`Sub in ${TEAMCODE}${NAME_G}`, 'i')) ?? grab(new RegExp(`${NAME} enters`, 'i'));
      out.outPlayer = grab(new RegExp(`Sub out ${TEAMCODE}${NAME_G}`, 'i')) ?? grab(new RegExp(`${NAME} leaves`, 'i'));
      break;
    }
    case 'goalie_change':
      out.player = grab(new RegExp(`^${TEAMCODE}${NAME} at goalie`, 'i')) ?? grab(new RegExp(`goalie ${TEAMCODE}${NAME_G}`, 'i'));
      break;
    case 'pk':
      out.player = grab(new RegExp(`Penalty kick by ${TEAMCODE}${NAME_G}`, 'i')) ?? grab(new RegExp(`^${TEAMCODE}${NAME} penalty`, 'i'));
      out.saver = grab(/saved? by ([^.,]+(?:, [^.,]+)?)\.?$/i);
      break;
    default:
      break;
  }
  return out;
}

/** venue.duration is "hh:mm" (e.g. "02:05" → 125). Plain "125" also accepted. */
export function durationMinutes(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return int(raw);
}

function teamLine(team: Dict): TeamStatLine {
  const totals = obj(team['totals']);
  const shots = obj(totals['shots']);
  const pen = obj(totals['penalties']);
  const goalie = obj(totals['goalie']);
  const misc = obj(totals['miscStats']);
  const summary = obj(team['scoreSummary']);
  const periodLines: PeriodLine[] = [];
  for (const raw of arr(summary['periodSummaries'])) {
    const p = obj(raw);
    const period = int(p['period']);
    if (period == null) continue;
    periodLines.push({ period, score: int(p['score']), shots: int(p['shots']), saves: int(p['saves']), fouls: int(p['fouls']), corners: int(p['corners']), offsides: int(p['offsides']) });
  }
  const sum = (k: keyof PeriodLine): number | null => {
    if (!periodLines.length || periodLines.every((l) => l[k] == null)) return null;
    return periodLines.reduce((a, l) => a + (l[k] ?? 0), 0);
  };
  const pick = (direct: number | null, fromPeriods: number | null) => (direct != null && direct > 0 ? direct : fromPeriods ?? direct);
  return {
    ...EMPTY_TEAM_LINE(),
    goals: int(shots['goals']) ?? int(summary['score']),
    assists: int(shots['assists']),
    shots: int(shots['numberOfShots']) ?? int(summary['shots']),
    sog: int(shots['shotsOnGoal']),
    shotsOffTarget: int(shots['shotsOffTarget']),
    corners: pick(int(misc['corners']), sum('corners')),
    fouls: pick(int(pen['fouls']), sum('fouls')),
    offsides: pick(int(misc['offsides']), sum('offsides')),
    saves: pick(int(goalie['saves']), sum('saves')),
    yellow: int(pen['yellow']),
    red: int(pen['red']),
    pkGoals: int(shots['penaltyShotGoals']),
    pkAttempts: int(shots['penaltyShotsAttempted']),
    gkMinutes: minutesFromClock(str(goalie['minutes'])),
    gkGoalsAllowed: int(goalie['goalsAllowed']),
    gkSaves: int(goalie['saves']),
    periodLines,
  };
}

function playerLine(raw: unknown): PlayerStatLine | null {
  if (!isObj(raw)) return null;
  const p = raw;
  const name = str(p['name']) ?? str(p['playerFirstLastName']);
  if (!name) return null;
  const { firstName, lastName } = name.includes(',') ? splitName(name) : splitName(name);
  const uniform = str(p['uniform']);
  const jersey = int(uniform);
  const rosterPlayerId = str(p['rosterPlayerId']);
  const sourceKey = rosterPlayerId ?? nameJerseyKey(lastName, firstName, uniform);
  const shots = obj(p['shots']);
  const gt = obj(p['goalTypes']);
  const pen = obj(p['penalties']);
  const misc = obj(p['miscStats']);
  const goalie = isObj(p['goalie']) ? p['goalie'] : null;
  const gamePlayed = str(p['gamePlayed']);
  const line: PlayerStatLine = {
    ...EMPTY_PLAYER_LINE(sourceKey, cleanName(firstName), cleanName(lastName)),
    jersey,
    position: (str(p['position']) ?? null)?.toUpperCase() ?? null,
    starter: str(p['gameStarted']) === '1' || bool(p['gameStarted']),
    participated: gamePlayed == null ? true : gamePlayed !== '0' && gamePlayed.toLowerCase() !== 'false',
    minutes: int(p['minutesPlayed']) ?? int(misc['minutesPlayed']),
    goals: int(shots['goals']), assists: int(shots['assists']), points: int(shots['points']),
    shots: int(shots['numberOfShots']), sog: int(shots['shotsOnGoal']), shotsOffTarget: int(shots['shotsOffTarget']),
    pkGoals: int(shots['penaltyShotGoals']), pkAttempts: int(shots['penaltyShotsAttempted']),
    fouls: int(pen['fouls']), yellow: int(pen['yellow']), red: int(pen['red']), green: int(pen['green']),
    corners: int(misc['corners']), offsides: int(misc['offsides']),
    isGoalie: bool(p['isAGoalie']) || goalie != null,
    goalsAllowed: goalie ? int(goalie['goalsAllowed']) : null,
    saves: goalie ? int(goalie['saves']) : null,
    gkMinutes: goalie ? minutesFromClock(str(goalie['minutes'])) : null,
    gwg: int(gt['gameWinningGoals']), unassistedGoals: int(gt['unassistedGoals']), firstGoals: int(gt['firstGoals']),
    otGoals: int(gt['overtimeGoals']), emptyNetGoals: int(gt['emptyNetGoals']), tyingGoals: int(gt['gameTyingGoals']), shootoutGoals: int(gt['shootoutGoals']),
    hatTrick: (int(gt['hatTricks']) ?? 0) > 0,
  };
  return line;
}

function team(raw: Dict, isHome: boolean, fallbackName: string | null, fallbackScore: number | null): BoxScoreTeam {
  const players: PlayerStatLine[] = [];
  for (const p of arr(raw['players'])) { const l = playerLine(p); if (l) players.push(l); }
  return {
    name: str(raw['name']) ?? fallbackName ?? (isHome ? 'Home' : 'Away'),
    sourceTeamId: str(raw['id']) ?? str(raw['code']),
    ncaaSeo: null,
    isHome,
    score: int(obj(raw['scoreSummary'])['score']) ?? fallbackScore,
    record: str(raw['record']),
    totals: teamLine(raw),
    players,
  };
}

interface Draft { period: number; clock: string | null; clockSeconds: number | null; order: number; side: 'home' | 'away' | null; type: EventType; player: string | null; assist: string | null; text: string; isGoal: boolean }

function sideOf(raw: Dict, homeId: string | null, awayId: string | null): 'home' | 'away' | null {
  if (typeof raw['isAHomeTeam'] === 'boolean') return raw['isAHomeTeam'] ? 'home' : 'away';
  const code = (str(raw['team']) ?? str(raw['teamId']) ?? '').toUpperCase();
  if (code && homeId && code === homeId.toUpperCase()) return 'home';
  if (code && awayId && code === awayId.toUpperCase()) return 'away';
  return null;
}

/** Map the embedded game object into the canonical BoxScore. */
export function mapEmbeddedGame(game: Dict, url: string, _ctx: SiteContext): BoxScore {
  const venue = obj(game['venue']);
  const rules = obj(venue['rules']);
  const homeRaw = obj(game['homeTeam']);
  const awayRaw = obj(game['visitingTeam']);
  const homeId = str(homeRaw['id']) ?? str(game['homeTeamId']);
  const awayId = str(awayRaw['id']) ?? str(game['visitingTeamId']);
  const codes = [homeId, awayId].filter((c): c is string => !!c);

  const home = team(homeRaw, true, str(game['homeTeamName']), int(game['homeScore']) ?? int(game['homeTeamScore']));
  const away = team(awayRaw, false, str(game['visitingTeamName']), int(game['visitingScore']) ?? int(game['visitingTeamScore']));

  const drafts: Draft[] = [];
  let order = 0;
  for (const raw of arr(game['plays'])) {
    if (!isObj(raw)) continue;
    const text = collapse(str(raw['text'])) ?? '';
    const type = mapAction(str(raw['action']), text);
    const period = int(raw['period']) ?? 1;
    const clock = str(raw['clock']);
    const parsed = parsePlayText(type, text, codes);
    const side = sideOf(raw, homeId, awayId);
    const num = int(raw['number']);
    const base = { period, clock, clockSeconds: clockToSeconds(clock), side, text };
    const ord = num ?? order;
    if (type === 'sub_in') {
      drafts.push({ ...base, order: ord, type: 'sub_in', player: displayFromLastFirst(parsed.player), assist: null, isGoal: false });
      if (parsed.outPlayer) drafts.push({ ...base, order: ord + 0.5, type: 'sub_out', player: displayFromLastFirst(parsed.outPlayer), assist: null, isGoal: false });
    } else {
      const player = displayFromLastFirst(parsed.player ?? str(raw['nameOfPlayer']) ?? str(raw['player']));
      drafts.push({ ...base, order: ord, type, player, assist: displayFromLastFirst(parsed.assist), isGoal: type === 'goal' });
      if (parsed.saver && (type === 'shot' || type === 'pk')) {
        drafts.push({ ...base, order: ord + 0.5, side: side === 'home' ? 'away' : side === 'away' ? 'home' : null, type: 'save', player: displayFromLastFirst(parsed.saver), assist: null, isGoal: false });
      }
    }
    order++;
  }

  const hasDraft = (type: EventType, period: number, clockSeconds: number | null, side: 'home' | 'away' | null) =>
    drafts.some((d) => d.type === type && d.period === period && d.side === side && (clockSeconds == null || d.clockSeconds == null || Math.abs(d.clockSeconds - clockSeconds) <= 60));

  for (const raw of arr(game['scores'])) {
    if (!isObj(raw)) continue;
    const period = int(raw['period']) ?? 1;
    const clock = str(raw['time']);
    const clockSeconds = clockToSeconds(clock);
    const side = sideOf(raw, homeId, awayId);
    if (hasDraft('goal', period, clockSeconds, side)) continue;
    const player = displayFromLastFirst(str(raw['nameOfPlayer']));
    const a1 = str(raw['nameOfFirstAssist']);
    const assist = a1 && a1 !== '0' ? displayFromLastFirst(a1) : null;
    const desc = str(raw['description']);
    drafts.push({ period, clock, clockSeconds, order: 100000 + drafts.length, side, type: 'goal', player, assist, isGoal: true,
      text: `GOAL by ${player ?? 'unknown'}${assist ? ` (Assist ${assist})` : ''}${desc ? ` - ${desc}` : ''}` });
  }
  for (const raw of arr(game['penalties'])) {
    if (!isObj(raw)) continue;
    const kind = (str(raw['type']) ?? '').toUpperCase();
    const type: EventType = /RED/.test(kind) ? 'red' : /GREEN/.test(kind) ? 'green' : 'yellow';
    const period = int(raw['period']) ?? 1;
    const clock = str(raw['time']);
    const clockSeconds = clockToSeconds(clock);
    const side = sideOf(raw, homeId, awayId);
    if (hasDraft(type, period, clockSeconds, side)) continue;
    const player = displayFromLastFirst(str(raw['nameOfPlayer']));
    drafts.push({ period, clock, clockSeconds, order: 200000 + drafts.length, side, type, player, assist: null, isGoal: false,
      text: `${type[0]!.toUpperCase()}${type.slice(1)} card on ${player ?? 'unknown'}` });
  }

  drafts.sort((a, b) => a.period - b.period || (a.clockSeconds ?? -1) - (b.clockSeconds ?? -1) || a.order - b.order);
  let hs = 0; let as = 0;
  const events: GameEvent[] = drafts.map((d, i) => {
    if (d.isGoal) { if (d.side === 'home') hs++; else if (d.side === 'away') as++; }
    return { period: d.period, clock: d.clock, clockSeconds: d.clockSeconds, seq: i, side: d.side, type: d.type, playerNameRaw: d.player, assistNameRaw: d.assist, homeScore: hs, awayScore: as, text: d.text };
  });

  const regPeriods = int(rules['periods']) ?? 2;
  const maxPeriodPlayed = Math.max(
    regPeriods === 0 ? 0 : 0,
    ...drafts.map((d) => d.period),
    ...[home, away].flatMap((t) => t.totals.periodLines.map((l) => l.period)),
    int(obj(homeRaw['scoreSummary'])['periods']) ?? 0,
    arr(game['periods']).length,
  );
  const periods = maxPeriodPlayed > 0 ? maxPeriodPlayed : regPeriods;
  const otGoals = (int(obj(obj(homeRaw['totals'])['goalTypes'])['overtimeGoals']) ?? 0) + (int(obj(obj(awayRaw['totals'])['goalTypes'])['overtimeGoals']) ?? 0);
  const soGoals = (int(obj(obj(homeRaw['totals'])['goalTypes'])['shootoutGoals']) ?? 0) + (int(obj(obj(awayRaw['totals'])['goalTypes'])['shootoutGoals']) ?? 0);
  const shootout = soGoals > 0 || arr(game['plays']).some((p) => isObj(p) && /shootout/i.test(`${str(p['action']) ?? ''} ${str(p['text']) ?? ''}`));
  const tournament = str(venue['tournamentName']) ?? str(venue['tournament']) ?? null;
  const durationMin = durationMinutes(str(venue['duration']));

  const date = isoDate(str(venue['date'])) ?? isoDate(str(game['gameDate'])) ?? '';
  const finished = home.score != null && away.score != null;
  return {
    source: 'sidearm',
    sourceUrl: url,
    date,
    startTimeLocal: str(venue['start']),
    status: finished ? 'final' : 'scheduled',
    venueName: str(venue['stadium']),
    venueCity: str(venue['location']),
    attendance: int(venue['attendance']),
    officials: arr(venue['officials']).map((o) => ({ title: str(obj(o)['title']) ?? '', name: str(obj(o)['name']) ?? '' })).filter((o) => o.name),
    neutral: bool(venue['isNeutral']) || bool(game['isNeutral']),
    conferenceGame: bool(venue['isALeagueGame']) || bool(game['isALeagueGame']),
    postseason: bool(venue['isAPostseasonGame']) || !!tournament,
    tournament,
    overtime: periods > regPeriods || otGoals > 0,
    shootout,
    durationMin,
    periods,
    home,
    away,
    events,
    ncaaContestId: null,
  };
}

/** Parse a Sidearm box score page (HTML with embedded Nuxt payload) into the canonical BoxScore. */
export function parseBoxScore(html: string, url: string, ctx: SiteContext): BoxScore {
  const root = decodeNuxtData(html);
  const game = findEmbeddedGame(root);
  if (!game) throw new Error(`Sidearm box score: no embedded game found at ${url}`);
  return mapEmbeddedGame(game, url, ctx);
}
