// Takedown requests (a player's `suppress` switch, src/legal): what every non-admin read leaves out. The site's /api
// routes, /v1 and the Plaibook mirror (/v1/site) all go through these, so a suppressed player is withheld everywhere
// the public or Plaibook can read; only the admin viewer (the trigger secret) sees the rows as stored.

/** A suppressed player (a takedown request) is 404 on the player routes and absent from search; rosters agree. */
export function visibleRoster<T extends { player?: { suppress?: boolean | null } | null }>(rows: T[]): T[] {
  return rows.filter((r) => !r.player?.suppress);
}
/**
 * A game with a suppressed player still adds up: the line keeps its numbers (team totals depend on them) but loses the
 * name and every id that leads to the person, and plays that name them lose their text. The raw source payload names
 * everyone, so it is not served for such a game.
 */
export function redactGame<T extends { players?: any[]; events?: any[]; raw?: unknown }>(r: T): T {
  const lines = r.players ?? [];
  const hidden = new Set(lines.filter((p) => p.suppress && p.player_season_id).map((p) => p.player_season_id));
  const anyHidden = lines.some((p) => p.suppress);
  const players = lines.map(({ suppress, ...p }) => (suppress ? { ...p, first_name: null, last_name: null, player_id: null, player_season_id: null, source_key: null, withheld: true } : p));
  if (!anyHidden) return { ...r, players };
  const events = (r.events ?? []).map((e) => {
    const who = hidden.has(e.player_season_id); const helper = hidden.has(e.assist_player_season_id);
    if (!who && !helper) return e;
    return { ...e, play_text: null, ...(who ? { player_season_id: null, player_name_raw: null } : {}), ...(helper ? { assist_player_season_id: null, assist_name_raw: null } : {}), withheld: true };
  });
  return { ...r, players, events, raw: undefined };
}
/** A match preview withholds suppressed players the way a box score does: numbers stay, names and ids go. */
export function redactPreview<T extends { sides: Record<string, any> }>(r: T): T {
  const line = ({ suppress, ...l }: any) => (suppress ? { ...l, name: null, player_id: null, player_season_id: null, headshot_url: null, withheld: true } : l);
  const lineup = (lu: any) => (lu ? { ...lu, starters: lu.starters.map(line), subs: lu.subs.map(line), dnp: lu.dnp.map(line), keeper: lu.keeper ? line(lu.keeper) : null } : lu);
  const leader = (x: any) => (x && !x.suppress ? (({ suppress, ...rest }) => rest)(x) : null);
  const sides: Record<string, any> = {};
  for (const [k, v] of Object.entries(r.sides)) sides[k] = v ? { ...v, lineup: lineup(v.lineup), last_lineup: lineup(v.last_lineup), leaders: { scorers: v.leaders.scorers.map(leader).filter(Boolean), assists: v.leaders.assists.map(leader).filter(Boolean), keeper: leader(v.leaders.keeper) } } : v;
  return { ...r, sides };
}
/** An individual national ranking never names a suppressed player (leaderboards already leave them out). */
export function visibleRankings<T extends { college_player_seasons?: { college_players?: { suppress?: boolean | null } | null } | null }>(rows: T[]): T[] {
  return rows.filter((x) => !x.college_player_seasons?.college_players?.suppress)
    .map((x) => (x.college_player_seasons?.college_players ? { ...x, college_player_seasons: { ...x.college_player_seasons, college_players: { ...x.college_player_seasons.college_players, suppress: undefined } } } : x));
}
/** Leader rows carry `suppress` from the leaders view; the player leaderboards filter it in SQL, this is the second lock. */
export function visibleLeaders<T extends { suppress?: boolean | null }>(rows: T[]): T[] {
  return rows.filter((r) => !r.suppress).map(({ suppress: _s, ...r }) => r as T);
}
/** A conference page's four leaderboards, each without suppressed players. */
export function redactConference<T extends { leaders?: Record<string, any[]> } | null>(r: T): T {
  if (!r?.leaders) return r;
  return { ...r, leaders: Object.fromEntries(Object.entries(r.leaders).map(([k, rows]) => [k, visibleLeaders(rows ?? [])])) };
}
