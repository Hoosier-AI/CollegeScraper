// One side (men's or women's) of an answer that covers both: ?gender=m|w on the Today pages, match days, transfers,
// search, a college referee and a college coach. No gender: the answer is unchanged. Plaibook keeps the same rules as a
// second lock (plaibook api/_lib/statsSide.mjs); keep the two in step.
export type Side = 'm' | 'w';
export const sideOf = (v: unknown): Side | null => (v === 'm' || v === 'w' ? v : null);

/** True when a thing's gender is the side, or when either is unknown (nothing to filter on). */
export const onSide = (gender: unknown, side: Side | null): boolean => !gender || !side || gender === side;

const leagueOf = (x: any) => x?.league?.gender ?? x?.gender ?? null;
const countMatches = (groups: any[]) => groups.reduce((n, g) => n + (g.matches || []).length, 0);
const countLive = (groups: any[]) => groups.reduce((n, g) => n + (g.matches || []).filter((m: any) => m.status === 'live').length, 0);

/** A day of matches by competition ({ groups, total, live }) kept to the side, counts redone. */
export function matchesOnSide<T extends { groups?: any[] } | null | undefined>(day: T, side: Side | null): T {
  if (!day || !side) return day;
  const groups = (day.groups || []).filter((g: any) => onSide(g?.league?.gender, side));
  return { ...day, groups, total: countMatches(groups), live: countLive(groups) };
}

/** Pro Today: today's matches, the next US match day, featured leagues, Americans abroad. */
export function proHomeOnSide(d: any, side: Side | null): any {
  if (!d || !side) return d;
  return {
    ...d,
    matches: matchesOnSide(d.matches, side),
    next_us: d.next_us ? matchesOnSide(d.next_us, side) : d.next_us,
    featured: (d.featured || []).filter((l: any) => onSide(l.gender, side)),
    abroad: d.abroad ? { ...d.abroad, lines: (d.abroad.lines || []).filter((l: any) => onSide(leagueOf(l.match), side)) } : d.abroad,
  };
}

/** International Today: today's matches, coming up, latest results, tournaments. */
export function intlHomeOnSide(d: any, side: Side | null): any {
  if (!d || !side) return d;
  return {
    ...d,
    matches: matchesOnSide(d.matches, side),
    upcoming: (d.upcoming || []).filter((m: any) => onSide(leagueOf(m), side)),
    recent: (d.recent || []).filter((m: any) => onSide(leagueOf(m), side)),
    tournaments: (d.tournaments || []).filter((t: any) => onSide(t.gender, side)),
  };
}

/** Transfers, by the destination club's side (else the club left). */
export const transfersOnSide = (rows: any[], side: Side | null) => (side ? rows.filter((r) => onSide(r?.to?.gender ?? r?.from?.gender, side)) : rows);

/** A college referee kept to one side: seasons, latest games, teams, and the career figures redone (game-weighted). */
export function refereeOnSide(d: any, side: Side | null): any {
  if (!d || !side) return d;
  const seasons = (d.seasons || []).filter((s: any) => onSide(s.gender, side));
  const recent = (d.recent || []).filter((r: any) => onSide(r.match?.gender, side));
  const teams = (d.teams || []).filter((t: any) => onSide(t.program?.gender, side));
  const games = seasons.reduce((n: number, s: any) => n + (Number(s.games) || 0), 0);
  const weighted = (k: string) => (games ? seasons.reduce((n: number, s: any) => n + (Number(s[k]) || 0) * (Number(s.games) || 0), 0) / games : null);
  const career = games ? Object.fromEntries(['cards_pg', 'yellow_pg', 'red_pg', 'pens_pg', 'fouls_pg', 'goals_pg', 'home_pct', 'draw_pct'].map((k) => [k, weighted(k)]).concat([['games', games]])) : d.career;
  return { ...d, seasons, recent, teams, career, referee: d.referee ? { ...d.referee, last_date: recent[0]?.match?.game_date || d.referee.last_date } : d.referee };
}

/** A college coach kept to one side: seasons, and the head-coach record redone from them. */
export function coachOnSide(d: any, side: Side | null): any {
  if (!d || !side) return d;
  const seasons = (d.seasons || []).filter((s: any) => onSide(s.program?.gender, side));
  const head = seasons.filter((s: any) => s.is_head && s.record);
  const sum = (k: string) => head.reduce((n: number, s: any) => n + (Number(s.record[k]) || 0), 0);
  const w = sum('w'), l = sum('l'), t = sum('t');
  return { ...d, seasons, head_record: head.length ? { w, l, t, seasons: head.length, win_share: w + l + t ? (w + t / 2) / (w + l + t) : null } : null };
}
