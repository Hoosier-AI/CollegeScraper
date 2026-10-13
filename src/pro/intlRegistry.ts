// Which competitions and teams live in the International section (/intl) rather than Pro (/pro): the slugs of every
// competition with scope 'intl' and every national team (pro_teams.intl, migration 164), kept in memory so a page
// or a sitemap links straight to the right section. Refreshed every ten minutes; empty (everything Pro, as before the
// split) until the first load or when the columns are missing.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';

let state = { leagues: new Set<string>(), teams: new Set<string>(), at: 0 };
let loading: Promise<void> | null = null;

async function load(db: Db): Promise<void> {
  try {
    const [leagues, teams] = await Promise.all([
      selectAll<{ slug: string }>(db, 'pro_leagues', 'slug', (q) => q.eq('scope', 'intl').not('slug', 'is', null)),
      selectAll<{ slug: string }>(db, 'pro_teams', 'slug', (q) => q.eq('intl', true).not('slug', 'is', null)),
    ]);
    state = { leagues: new Set(leagues.map((l) => l.slug)), teams: new Set(teams.map((t) => t.slug)), at: Date.now() };
  } catch {
    // Before migration 164: keep what we had (empty: every address stays under /pro), try again in a minute.
    state = { ...state, at: Date.now() - 9 * 60_000 };
  }
}

/** Loads the slugs when older than ten minutes; concurrent callers share one load. */
export async function ensureIntlRegistry(db: Db): Promise<void> {
  if (Date.now() - state.at < 10 * 60_000) return;
  loading ??= load(db).finally(() => { loading = null; });
  await loading;
}

export const isIntlLeague = (slug: string) => state.leagues.has(slug);
export const isIntlTeam = (slug: string) => state.teams.has(slug);
/** A match address ("2022-11-21-usa-vs-wales") whose home side is a national team. */
export function isIntlMatchSlug(slug: string): boolean {
  const m = /^\d{4}-\d{2}-\d{2}-(.+?)-vs-/.exec(slug);
  return !!m && state.teams.has(m[1]!);
}

/** Tests: set the slugs directly. */
export function setIntlRegistry(leagues: string[], teams: string[]): void {
  state = { leagues: new Set(leagues), teams: new Set(teams), at: Date.now() };
}
