import { normalizeResult } from '../../../normalize/records.js';
// Sidearm EventsResults JSON: /api/v2.1/EventsResults/{results|upcoming}?sportId=N&pageIndex=0&pageSize=M
// Both endpoints return {items:[...], before, after}. The results feed can span several seasons,
// and `gameStateDisplay` is unreliable (completed games are frequently still "SCHEDULED" while
// carrying a full W/L result), so a populated result wins over the display state.
import type { GameState, ScheduleEntry, SiteContext } from '../../../model.js';
import { int } from '../../../normalize/num.js';
import { absUrl, arr, bool, inSeason, isObj, isoDate, isoTime, obj, str, stripRank, type Dict } from './common.js';

export function resultsUrl(baseUrl: string, sportId: number, kind: 'results' | 'upcoming', pageSize = 100): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v2.1/EventsResults/${kind}?sportId=${sportId}&pageIndex=0&pageSize=${pageSize}`;
}

export function mapGameState(display: string | null | undefined, hasResult: boolean): GameState {
  const s = (display ?? '').toUpperCase();
  if (/POSTPONE/.test(s)) return 'postponed';
  if (/CANCEL/.test(s)) return 'cancelled';
  if (hasResult) return 'final';
  if (/COMPLETE|FINAL/.test(s)) return 'final';
  if (/LIVE|INPROGRESS|IN_PROGRESS|IN PROGRESS/.test(s)) return 'live';
  return 'scheduled';
}

function parseResult(raw: unknown): ScheduleEntry['result'] {
  if (!isObj(raw)) return null;
  const status = (str(raw['status']) ?? '').toUpperCase();
  const teamScore = int(raw['teamScore']);
  const opponentScore = int(raw['opponentScore']);
  if ((status === 'W' || status === 'L' || status === 'T') && teamScore != null && opponentScore != null) {
    return { status, teamScore, opponentScore };
  }
  return null;
}

function homeAwayOf(item: Dict): 'H' | 'A' | 'N' {
  const li = (str(item['locationIndicator']) ?? '').toUpperCase();
  if (li === 'H' || li === 'A' || li === 'N') return li;
  if (bool(item['neutralHometeam'])) return 'N';
  const status = (str(item['status']) ?? '').toUpperCase();
  if (status === 'H' || status === 'A' || status === 'N') return status;
  return 'H';
}

export function parseResultItem(raw: unknown, ctx: SiteContext, prettyLinks?: Map<string, string>): ScheduleEntry | null {
  if (!isObj(raw)) return null;
  const item = raw;
  const date = isoDate(str(item['date']) ?? str(item['gameDate'])) ?? isoDate(str(item['dateUtc']));
  if (!date) return null;
  const opponent = obj(item['opponent']);
  const opponentName = stripRank(str(opponent['title']) ?? str(opponent['name']) ?? str(item['eventName']) ?? '');
  if (!opponentName) return null;
  const result = normalizeResult(parseResult(item['result']));
  const res = obj(item['result']);
  const gameId = str(res['gameId']) ?? str(item['gameId']) ?? str(item['id']);
  const tournament = str(item['tournament']) ?? str(item['eventName']);
  const isExhibition = !!tournament && /exhib|scrimmage/i.test(tournament);
  const boxScorePath = str(res['boxScore']);
  const pretty = gameId ? prettyLinks?.get(gameId) ?? null : null;
  const boxScoreUrl = boxScorePath ? pretty ?? absUrl(ctx.baseUrl, boxScorePath) : pretty;
  const tbd = bool(item['tbd']) || bool(item['allDay']) || /tba|tbd/i.test(str(item['time']) ?? '');
  const facility = obj(item['gameFacility']);
  return {
    date,
    startTimeLocal: tbd ? null : isoTime(str(item['date']) ?? str(item['gameDate'])),
    opponentName,
    opponentSiteId: str(opponent['id']),
    homeAway: homeAwayOf(item),
    location: str(item['location']) ?? str(facility['title']),
    isConference: bool(item['isConference']),
    isExhibition,
    tournament: tournament && !isExhibition ? tournament : null,
    state: mapGameState(str(item['gameStateDisplay']), result != null),
    result,
    boxScoreUrl,
    siteGameId: gameId,
    attendance: null,
  };
}

/**
 * Parse one or more EventsResults payloads (results + upcoming), merged, deduplicated and
 * filtered to `ctx.season` (Aug 1 → Jan 31). Sorted by date ascending.
 */
export function parseResults(json: unknown, ctx: SiteContext, prettyLinks?: Map<string, string>): ScheduleEntry[] {
  const payloads = Array.isArray(json) && json.every((x) => isObj(x) && Array.isArray(x['items'])) ? json : [json];
  const byKey = new Map<string, ScheduleEntry>();
  for (const payload of payloads) {
    const items = Array.isArray(payload) ? payload : arr(obj(payload)['items']);
    for (const raw of items) {
      const entry = parseResultItem(raw, ctx, prettyLinks);
      if (!entry || !inSeason(entry.date, ctx.season)) continue;
      const key = entry.siteGameId ?? `${entry.date}|${entry.opponentName.toLowerCase()}`;
      const prev = byKey.get(key);
      // Prefer the row that carries a result / box score (results feed over upcoming feed).
      if (!prev || (!prev.result && entry.result) || (!prev.boxScoreUrl && entry.boxScoreUrl)) byKey.set(key, entry);
    }
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.startTimeLocal ?? '').localeCompare(b.startTimeLocal ?? ''));
}
