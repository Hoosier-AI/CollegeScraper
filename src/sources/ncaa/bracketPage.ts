// NCAA.com's championship bracket page (www.ncaa.com/brackets/soccer-men/d1/2026). The page is server-rendered by
// Nuxt and carries the whole bracket in its __NUXT_DATA__ script: every position, its contest id, the teams known so
// far (with seeds and home side) and the kickoff. The scoreboard only lists a game once both teams are known, so the
// men's 16 seeded teams (first-round byes) are only here until the first round is played (2026-11-16).
import type { Division, Gender } from '../../model.js';

export const bracketPageUrl = (gender: Gender, division: Division, season: number) =>
  `https://www.ncaa.com/brackets/soccer-${gender === 'w' ? 'women' : 'men'}/${division}/${season}`;

export interface BracketPageTeam { seo: string; name: string; seed: number | null; isHome: boolean; score: number | null; winner: boolean }
export interface BracketPageGame {
  contestId: number; slot: number; round: number; date: string | null; startEpoch: number | null;
  state: 'pre' | 'live' | 'final'; teams: BracketPageTeam[];
}
export interface BracketPage { championshipId: number | null; title: string | null; games: BracketPageGame[] }

const WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef']);

/** Nuxt's payload format (devalue): a flat array where objects and arrays hold indexes into it. */
export function unflattenNuxt(flat: unknown[]): unknown {
  const done = new Map<number, unknown>();
  const at = (i: number): unknown => {
    if (done.has(i)) return done.get(i);
    const v = flat[i];
    let out: unknown;
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && WRAPPERS.has(v[0])) out = at(v[1] as number);
      else if (v[0] === 'Set') out = v.slice(1).map((x) => at(x as number));
      else if (v[0] === 'Date') out = v[1];
      else { const arr: unknown[] = []; done.set(i, arr); for (const x of v) arr.push(at(x as number)); return arr; }
    } else if (v && typeof v === 'object') {
      const obj: Record<string, unknown> = {};
      done.set(i, obj);
      for (const [k, x] of Object.entries(v)) obj[k] = typeof x === 'number' ? at(x) : x;
      return obj;
    } else out = v;
    done.set(i, out);
    return out;
  };
  return at(0);
}

const int = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** "11/19/2026" -> "2026-11-19". */
const isoDate = (v: unknown): string | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v ?? '').trim());
  return m ? `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null;
};
const state = (g: Record<string, unknown>): BracketPageGame['state'] => {
  const s = String(g.statusCodeDisplay ?? g.gameState ?? '').toLowerCase();
  return s === 'final' || s === 'f' ? 'final' : s === 'live' || s === 'i' ? 'live' : 'pre';
};

export function parseBracketPage(html: string): BracketPage | null {
  const m = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  let root: any;
  try { root = unflattenNuxt(JSON.parse(m[1]!)); } catch { return null; }
  const c = root?.pinia?.main?.championship;
  if (!c || !Array.isArray(c.games)) return null;
  const games: BracketPageGame[] = [];
  for (const g of c.games as Record<string, unknown>[]) {
    const contestId = int(g.contestId), slot = int(g.bracketPositionId ?? g.bracketId);
    if (contestId == null || slot == null) continue;
    const teams = (Array.isArray(g.teams) ? g.teams : []).flatMap((t: any): BracketPageTeam[] => {
      const seo = String(t?.seoname ?? '').trim();
      if (!seo || /^(tba|tbd)$/i.test(seo)) return [];
      return [{ seo, name: String(t.nameShort ?? t.nameFull ?? seo), seed: int(t.seed), isHome: !!t.isHome, score: int(t.score), winner: !!t.isWinner }];
    });
    games.push({ contestId, slot, round: Math.floor(slot / 100), date: isoDate(g.startDate), startEpoch: int(g.startTimeEpoch) || null, state: state(g), teams });
  }
  return { championshipId: int(c.championshipId), title: typeof c.title === 'string' ? c.title : null, games };
}
