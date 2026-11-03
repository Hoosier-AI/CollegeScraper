// Season totals that already count the newest matches (2026-11-02). A player's season row in a covered league comes
// from the provider's daily crawl (league_players), and our own per-match totals never overwrite it (migration 171),
// so after a game the apps, minutes and goals on the team page, the player page and Plaibook trailed the match by up to
// a day. At read time a provider row gets the player's lines from finals that ended AFTER the row was fetched: those
// cannot be in it, so nothing is counted twice, and the next crawl replaces the row (and the addition) by itself. A
// final that ended before the fetch is taken as included (if the provider was late with it, the row is short until the
// next crawl, as before). Pure; tests/pro/catchUp.test.ts.

export interface SeasonRowLike {
  player_id: number; league_id: number; season: number; team_id: number; source?: string | null; computed_at?: string | null;
  apps?: number | null; starts?: number | null; minutes?: number | null; goals?: number | null; assists?: number | null;
  yellow?: number | null; red?: number | null; rating?: number | string | null; [k: string]: unknown;
}
export interface FinalRef { id: number; league_id: number; season: number; final_at: string | null }
export interface FixtureLine {
  fixture_id: number; team_id: number; player_id: number | null; starter?: boolean | null; minutes?: number | null; from_events?: boolean | null;
  [k: string]: unknown;
}

// Counted per match: added when the line has a number (a row without the stat gets it from zero).
const SUM = ['goals', 'assists', 'yellow', 'red', 'saves', 'conceded', 'shots', 'shots_on', 'key_passes', 'passes', 'tackles', 'interceptions', 'duels_won', 'dribbles_won', 'fouls_drawn', 'fouls_committed'] as const;
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** The lines the provider row cannot hold yet: this player, club, competition and season, played, final after the fetch. */
export function newLinesFor(row: SeasonRowLike, lines: FixtureLine[], finals: Map<number, FinalRef>): FixtureLine[] {
  if (row.source !== 'provider') return [];
  const fetched = Date.parse(row.computed_at ?? '');
  if (!Number.isFinite(fetched)) return [];
  return lines.filter((l) => {
    if (l.player_id !== row.player_id || l.team_id !== row.team_id) return false;
    const f = finals.get(l.fixture_id);
    if (!f || f.league_id !== row.league_id || f.season !== row.season) return false;
    const ended = Date.parse(f.final_at ?? '');
    if (!Number.isFinite(ended) || ended <= fetched) return false;
    return (num(l.minutes) ?? 0) > 0 || !!l.from_events;
  });
}

/** The row with the newest matches added (apps, starts, minutes, the counted stats, rating weighted by apps), and
 *  `latest_added` = how many. The row itself when there is nothing to add. */
export function withNewMatches<T extends SeasonRowLike>(row: T, lines: FixtureLine[], finals: Map<number, FinalRef>): T & { latest_added?: number } {
  const add = newLinesFor(row, lines, finals);
  if (!add.length) return row;
  const out: Record<string, unknown> = { ...row };
  out.apps = (num(row.apps) ?? 0) + add.length;
  out.starts = (num(row.starts) ?? 0) + add.filter((l) => l.starter).length;
  out.minutes = (num(row.minutes) ?? 0) + add.reduce((n, l) => n + (num(l.minutes) ?? 0), 0);
  for (const k of SUM) {
    const vals = add.map((l) => num(l[k])).filter((v): v is number => v != null);
    if (vals.length) out[k] = (num(row[k]) ?? 0) + vals.reduce((a, b) => a + b, 0);
  }
  const rated = add.map((l) => num(l.rating)).filter((v): v is number => v != null);
  const base = num(row.rating); const apps = num(row.apps) ?? 0;
  if (rated.length) out.rating = Math.round((((base ?? 0) * (base == null ? 0 : apps)) + rated.reduce((a, b) => a + b, 0)) / ((base == null ? 0 : apps) + rated.length) * 100) / 100;
  out.latest_added = add.length;
  return out as T & { latest_added: number };
}

/** The oldest fetch time among a set of provider rows (finals that ended after it may need adding), or null. */
export function oldestFetch(rows: SeasonRowLike[]): number | null {
  const t = rows.filter((r) => r.source === 'provider').map((r) => Date.parse(r.computed_at ?? '')).filter(Number.isFinite);
  return t.length ? Math.min(...t) : null;
}
