// NCAA.com "casablanca" daily scoreboard JSON.
//   https://data.ncaa.com/casablanca/scoreboard/soccer-men/d1/2024/10/05/scoreboard.json
// Days without any games (and the whole off-season) answer 404 (S3 NoSuchKey XML body).
import { z } from 'zod';
import type { Division, Fetcher, GameState, Gender } from '../../model.js';
import { int } from '../../normalize/num.js';

export const SCOREBOARD_HOST = 'https://data.ncaa.com';

export function sportPath(gender: Gender): 'soccer-men' | 'soccer-women' {
  return gender === 'w' ? 'soccer-women' : 'soccer-men';
}

/** `date` is ISO YYYY-MM-DD. */
export function scoreboardUrl(gender: Gender, division: Division, date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`scoreboardUrl: date must be YYYY-MM-DD, got ${date}`);
  return `${SCOREBOARD_HOST}/casablanca/scoreboard/${sportPath(gender)}/${division}/${m[1]}/${m[2]}/${m[3]}/scoreboard.json`;
}

/** Parse gender/division back out of a scoreboard URL or request path. */
export function scoreboardPathInfo(urlOrPath: string): { gender: Gender; division: Division; date: string } | null {
  const m = urlOrPath.match(/scoreboard\/soccer-(men|women)\/(d[123])\/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  return { gender: m[1] === 'women' ? 'w' : 'm', division: m[2] as Division, date: `${m[3]}-${m[4]}-${m[5]}` };
}

const looseString = z.union([z.string(), z.number()]).transform((v) => String(v)).nullable().optional();

const ScoreboardTeamSchema = z.object({
  score: looseString,
  names: z.object({
    char6: z.string().optional().nullable(),
    short: z.string().optional().nullable(),
    seo: z.string().optional().nullable(),
    full: z.string().optional().nullable(),
  }).passthrough(),
  winner: z.boolean().optional().nullable(),
  seed: looseString,
  description: z.string().optional().nullable(),
  rank: looseString,
  conferences: z.array(z.object({
    conferenceName: z.string().optional().nullable(),
    conferenceSeo: z.string().optional().nullable(),
  }).passthrough()).optional().nullable(),
}).passthrough();

const ScoreboardGameSchema = z.object({
  gameID: looseString,
  url: z.string(),
  home: ScoreboardTeamSchema,
  away: ScoreboardTeamSchema,
  startTime: z.string().optional().nullable(),
  startTimeEpoch: looseString,
  startDate: z.string().optional().nullable(),
  gameState: z.string().optional().nullable(),
  currentPeriod: z.string().optional().nullable(),
  contestClock: z.string().optional().nullable(),
  finalMessage: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  contestName: z.string().optional().nullable(),
  bracketRound: z.string().optional().nullable(),
  bracketId: looseString,
  network: z.string().optional().nullable(),
}).passthrough();

export const ScoreboardSchema = z.object({
  games: z.array(z.object({ game: ScoreboardGameSchema }).passthrough()),
  updated_at: z.string().optional().nullable(),
  hideRank: z.boolean().optional().nullable(),
}).passthrough();

export type ScoreboardJson = z.infer<typeof ScoreboardSchema>;

export interface ScoreboardTeam {
  seo: string | null;
  short: string | null;
  full: string | null;
  char6: string | null;
  score: number | null;
  winner: boolean;
  /** "(6-3-2)" → "6-3-2" */
  record: string | null;
  rank: number | null;
  seed: number | null;
  conferences: { name: string; seo: string | null }[];
}

export interface ScoreboardGame {
  contestId: string;
  gameId: string | null;
  url: string;
  gender: Gender;
  division: Division;
  /** ISO YYYY-MM-DD from `startDate`, falling back to `startTimeEpoch` (Eastern). */
  date: string;
  startTimeEpoch: number | null;
  startTime: string | null;
  /** Raw casablanca state: "pre" | "live" | "final" (others passed through). */
  gameStateRaw: string | null;
  state: GameState;
  currentPeriod: string | null;
  contestClock: string | null;
  /** "FINAL", "FINAL (OT)", "FINAL (2OT)" … as NCAA.com prints it. */
  finalMessage: string | null;
  title: string | null;
  bracketRound: string | null;
  home: ScoreboardTeam;
  away: ScoreboardTeam;
}

export function mapGameState(raw: string | null | undefined): GameState {
  const s = (raw ?? '').toLowerCase();
  if (s === 'final' || s === 'f') return 'final';
  if (s === 'live' || s === 'i' || s === 'in progress') return 'live';
  if (s.includes('postpone')) return 'postponed';
  if (s.includes('cancel')) return 'cancelled';
  return 'scheduled';
}

/** "10-05-2024" → "2024-10-05" */
export function isoFromStartDate(startDate: string | null | undefined): string | null {
  const m = (startDate ?? '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/** Epoch seconds → YYYY-MM-DD in America/New_York (NCAA scoreboards are Eastern). */
export function isoFromEpochEastern(epoch: number | null): string | null {
  if (epoch == null || !Number.isFinite(epoch)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(epoch * 1000));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const y = g('year'), mo = g('month'), d = g('day');
  return y && mo && d ? `${y}-${mo}-${d}` : null;
}

function mapTeam(t: z.infer<typeof ScoreboardTeamSchema>): ScoreboardTeam {
  const desc = (t.description ?? '').trim();
  const rec = desc.match(/\(?\s*(\d+-\d+(?:-\d+)?)\s*\)?/);
  return {
    seo: t.names.seo || null,
    short: t.names.short || null,
    full: t.names.full || null,
    char6: t.names.char6 || null,
    score: int(t.score),
    winner: t.winner === true,
    record: rec ? rec[1]! : null,
    rank: int(t.rank),
    seed: int(t.seed),
    conferences: (t.conferences ?? [])
      .filter((c) => (c.conferenceName ?? '').trim() !== '')
      .map((c) => ({ name: c.conferenceName!.trim(), seo: c.conferenceSeo || null })),
  };
}

export function contestIdFromUrl(url: string | null | undefined): string | null {
  const m = (url ?? '').match(/\/game\/(\d+)/);
  return m ? m[1]! : null;
}

/**
 * Parse one scoreboard document. `gender`/`division` come from the request path (the JSON does
 * not repeat them); pass the URL to derive them, or pass them explicitly.
 */
export function parseScoreboard(json: unknown, ctx: { gender: Gender; division: Division } | string): ScoreboardGame[] {
  const info = typeof ctx === 'string' ? scoreboardPathInfo(ctx) : ctx;
  if (!info) throw new Error(`parseScoreboard: cannot derive gender/division from ${String(ctx)}`);
  const doc = ScoreboardSchema.parse(typeof json === 'string' ? JSON.parse(json) : json);
  const out: ScoreboardGame[] = [];
  for (const { game } of doc.games) {
    const contestId = contestIdFromUrl(game.url);
    if (!contestId) continue;
    const epoch = int(game.startTimeEpoch);
    const date = isoFromStartDate(game.startDate) ?? isoFromEpochEastern(epoch);
    if (!date) continue;
    out.push({
      contestId,
      gameId: game.gameID ?? null,
      url: `https://www.ncaa.com${game.url.startsWith('/') ? '' : '/'}${game.url}`,
      gender: info.gender,
      division: info.division,
      date,
      startTimeEpoch: epoch,
      startTime: game.startTime || null,
      gameStateRaw: game.gameState ?? null,
      state: mapGameState(game.gameState),
      currentPeriod: game.currentPeriod || null,
      contestClock: game.contestClock || null,
      finalMessage: game.finalMessage || null,
      title: game.title || null,
      bracketRound: game.bracketRound || null,
      home: mapTeam(game.home),
      away: mapTeam(game.away),
    });
  }
  return out;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

/** Every ISO date from Aug 10 of `season` through Dec 20 (inclusive) — the fall soccer window. */
export function seasonDates(season: number, opts: { from?: string; to?: string } = {}): string[] {
  const from = opts.from ?? `${season}-08-10`;
  const to = opts.to ?? `${season}-12-20`;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error(`seasonDates: bad range ${from}..${to}`);
  const out: string[] = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return out;
}

export interface ScoreboardDay {
  date: string;
  url: string;
  /** 'ok' when the JSON existed, 'missing' on 404 (no games that day). */
  status: 'ok' | 'missing';
  games: ScoreboardGame[];
}

function isNotFound(err: unknown): boolean {
  const e = err as { status?: unknown; message?: unknown };
  if (typeof e?.status === 'number') return e.status === 404;
  return typeof e?.message === 'string' && /\b404\b/.test(e.message);
}

/**
 * Fetch a run of daily scoreboards. Days that 404 are reported as `status: 'missing'` with no
 * games; any other error propagates (or is handed to `onError` when supplied, which skips the day).
 */
export async function fetchScoreboardRange(
  fetcher: Fetcher,
  gender: Gender,
  division: Division,
  dates: string[] | number,
  opts: { onError?: (date: string, err: unknown) => void } = {},
): Promise<ScoreboardDay[]> {
  const list = typeof dates === 'number' ? seasonDates(dates) : dates;
  const out: ScoreboardDay[] = [];
  for (const date of list) {
    const url = scoreboardUrl(gender, division, date);
    try {
      const res = await fetcher.get(url, { accept: 'application/json' });
      if (res.status === 404) { out.push({ date, url, status: 'missing', games: [] }); continue; }
      out.push({ date, url, status: 'ok', games: parseScoreboard(res.text, { gender, division }) });
    } catch (err) {
      if (isNotFound(err)) { out.push({ date, url, status: 'missing', games: [] }); continue; }
      if (opts.onError) { opts.onError(date, err); continue; }
      throw err;
    }
  }
  return out;
}
