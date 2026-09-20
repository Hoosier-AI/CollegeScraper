// Current-season scoreboard via the NCAA GraphQL "contests by date" persisted query. The old
// data.ncaa.com casablanca feed stopped at the 2025 season; ncaa.com itself now reads this query.
import type { Division, Gender, Fetcher } from '../../model.js';
import { graphqlGet } from './graphql.js';
import { PersistedQueryStore } from './persistedQueries.js';
import { mapGameState, parseScoreboard, scoreboardUrl, type ScoreboardGame } from './scoreboard.js';
import { int } from '../../normalize/num.js';

export const GQL_SCOREBOARD_FROM_SEASON = 2025;

export interface GqlContestTeam { isHome: boolean; isWinner?: boolean; score?: number | null; nameShort?: string | null; name6Char?: string | null; seoname?: string | null; seed?: number | null; teamRank?: number | null; conferenceSeo?: string | null }
export interface GqlContest { contestId: number | string; url?: string | null; gameState?: string | null; currentPeriod?: string | null; contestClock?: string | null; finalMessage?: string | null; startTimeEpoch?: number | string | null; startTime?: string | null; startDate?: string | null; roundNumber?: number | null; roundDescription?: string | null; teams: GqlContestTeam[] }

export function scoreboardVariables(gender: Gender, division: Division, date: string): Record<string, unknown> {
  const [y, m, d] = date.split('-');
  return { sportCode: gender === 'w' ? 'WSO' : 'MSO', division: Number(division.slice(1)), seasonYear: Number(y), contestDate: `${y}/${m}/${d}` };
}

const ACRONYMS = new Set(['acc', 'sec', 'mac', 'wac', 'mvc', 'ovc', 'wcc', 'caa', 'nec', 'sac', 'gac', 'ccc', 'aac', 'pac', 'usa', 'ncaa', 'ucla', 'smu', 'tcu', 'byu', 'lsu', 'uab', 'ucf', 'usc', 'nc', 'ny', 'nj', 'la', 'aec', 'asun', 'gnac', 'rmac', 'psac', 'ciaa', 'siac', 'nsic', 'gliac', 'glvc', 'mec', 'ecc', 'pbc', 'ssc', 'lsc', 'ncac', 'nescac', 'saa', 'odac', 'uaa', 'wiac', 'miac', 'cciw', 'oac', 'hcac', 'scac', 'asc', 'nwc', 'sciac', 'mac', 'ne10', 'nec', 'mwc', 'mvfc', 'sunyac', 'amcc', 'wiac', 'iiac', 'hcac', 'ncac', 'mascac', 'nac', 'csac', 'uec', 'nacc', 'srac', 'niac', 'nwac', 'peac', 'ccaa', 'mec', 'g-mac', 'gmac', 'cacc', 'ecac', 'liac', 'ccc', 'gnac', 'pac', 'sac', 'sec', 'cusa', 'wcc', 'wac', 'swac', 'meac', 'ovc', 'asun', 'caa', 'nec', 'maac', 'mvc']);
// Tokens that look like abbreviations (no vowels, or digits) are upper-cased too.
const looksAbbrev = (w: string) => /\d/.test(w) || (w.length <= 5 && !/[aeiouy]/.test(w));
export function titleizeSeo(seo: string | null | undefined): string | null {
  if (!seo) return null;
  return seo.split('-').map((w) => (ACRONYMS.has(w) || looksAbbrev(w) ? w.toUpperCase() : w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
}

/** Map the GraphQL contests document to the same shape `parseScoreboard` produces. */
export function parseGqlScoreboard(doc: unknown, gender: Gender, division: Division): ScoreboardGame[] {
  const contests = ((doc as any)?.data?.contests ?? (doc as any)?.contests ?? []) as GqlContest[];
  const out: ScoreboardGame[] = [];
  for (const c of contests) {
    const home = c.teams?.find((t) => t.isHome);
    const away = c.teams?.find((t) => !t.isHome);
    if (!home || !away || c.contestId == null) continue;
    const epoch = int(c.startTimeEpoch);
    const sd = c.startDate?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const date = sd ? `${sd[3]}-${sd[1]}-${sd[2]}` : epoch ? new Date(epoch * 1000 - 4 * 3600_000).toISOString().slice(0, 10) : null;
    if (!date) continue;
    const state = c.gameState === 'F' ? 'final' : c.gameState === 'I' ? 'live' : c.gameState === 'P' ? 'pre' : (c.gameState ?? 'pre');
    const team = (t: GqlContestTeam) => ({
      seo: t.seoname ?? null, short: t.nameShort ?? null, full: null, char6: t.name6Char ?? null,
      score: t.score == null ? null : Number(t.score), winner: !!t.isWinner, record: null,
      rank: t.teamRank ?? null, seed: t.seed ?? null,
      conferences: t.conferenceSeo ? [{ name: titleizeSeo(t.conferenceSeo) ?? t.conferenceSeo, seo: t.conferenceSeo }] : [],
    });
    out.push({
      contestId: String(c.contestId), gameId: null, url: `https://www.ncaa.com${c.url ?? `/game/${c.contestId}`}`, gender, division, date,
      startTimeEpoch: epoch, startTime: c.startTime ?? null, gameStateRaw: c.gameState ?? null, state: mapGameState(state),
      currentPeriod: c.currentPeriod ?? null, contestClock: c.contestClock ?? null, finalMessage: c.finalMessage ?? null, title: `${away.nameShort ?? ''} ${home.nameShort ?? ''}`.trim() || null,
      bracketRound: c.roundDescription || (c.roundNumber != null ? String(c.roundNumber) : null),
      home: team(home), away: team(away),
    });
  }
  return out;
}

/**
 * One day of games for a gender/division. Seasons from 2025 use the GraphQL query; older seasons
 * use the casablanca JSON. Returns [] for days without games (GraphQL) or a missing feed day (404).
 */
export async function scoreboardDay(fetcher: Fetcher, store: PersistedQueryStore, gender: Gender, division: Division, date: string): Promise<ScoreboardGame[]> {
  const season = Number(date.slice(0, 4));
  if (season >= GQL_SCOREBOARD_FROM_SEASON) {
    const doc = await graphqlGet<unknown>(fetcher, 'scoreboard', scoreboardVariables(gender, division, date), store);
    return parseGqlScoreboard({ data: doc }, gender, division);
  }
  try {
    const res = await fetcher.get(scoreboardUrl(gender, division, date), { accept: 'application/json' });
    return parseScoreboard(JSON.parse(res.text), { gender, division });
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return [];
    throw err;
  }
}
