// Reads for the International section (/intl): national-team football. Matches, tournaments, nations and players come
// from the same pro_* tables as Pro (one crawl, one live job), filtered to scope 'intl' (migration 163); a tournament,
// nation, player or match page is the Pro page's model. Only the lists that differ live here.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import type { LeagueLevel } from '../sources/apiFootball/leagues.js';
import { easternDayRange, FIXTURE_SELECT, matchesByDate, toMatchRow, type ProMatchRow } from './queries.js';
import { sourcesOff } from './sources.js';

const LEAGUE_COLS = 'id,name,slug,logo,country,country_flag,gender,type,scope,level,confederation,priority,current_season';

/** Confederations in the order the section lists them: the world first, the US's own next. */
export const CONFEDERATIONS = ['FIFA', 'CONCACAF', 'UEFA', 'CONMEBOL', 'CAF', 'AFC', 'OFC', 'Other'] as const;
const confRank = (c: string | null | undefined) => { const i = CONFEDERATIONS.indexOf((c ?? 'Other') as (typeof CONFEDERATIONS)[number]); return i < 0 ? CONFEDERATIONS.length : i; };

export interface IntlTournament {
  id: number; name: string; slug: string; logo: string | null; gender: 'm' | 'w'; type: 'league' | 'cup'; level: LeagueLevel; confederation: string;
  priority: number; current_season: number | null; starts_on: string | null; ends_on: string | null;
  /** Playing now (between its current season's first and last day), coming up, or between editions. */
  state: 'live' | 'upcoming' | 'off';
}

/** Every international competition we follow, with its current edition's dates. */
export async function tournaments(db: Db): Promise<IntlTournament[]> {
  const rows = await selectAll<any>(db, 'pro_leagues', LEAGUE_COLS, (q) => q.eq('enabled', true).eq('scope', 'intl').order('priority').order('name'));
  const seasons = rows.length ? await selectAll<{ league_id: number; season: number; starts_on: string | null; ends_on: string | null }>(db, 'pro_seasons', 'league_id,season,starts_on,ends_on', (q) => q.in('league_id', rows.map((r) => r.id))) : [];
  const edition = new Map(seasons.map((s) => [`${s.league_id}-${s.season}`, s]));
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((l): IntlTournament => {
    const e = l.current_season != null ? edition.get(`${l.id}-${l.current_season}`) : undefined;
    const starts = e?.starts_on ?? null, ends = e?.ends_on ?? null;
    const state: IntlTournament['state'] = starts && ends && starts <= today && today <= ends ? 'live' : starts && starts > today ? 'upcoming' : 'off';
    return { id: l.id, name: l.name, slug: l.slug, logo: l.logo ?? null, gender: l.gender ?? 'm', type: l.type, level: (l.level === 'youth' ? 'youth' : 'senior') as LeagueLevel, confederation: l.confederation ?? 'Other',
      priority: l.priority, current_season: l.current_season ?? null, starts_on: starts, ends_on: ends, state };
  }).sort((a, b) => confRank(a.confederation) - confRank(b.confederation) || a.priority - b.priority || a.name.localeCompare(b.name));
}

export interface IntlNation { id: number; name: string; slug: string; logo: string | null; gender: 'm' | 'w'; level: LeagueLevel; confederation: string; competitions: number; country: string | null }

let nationsCache: { at: number; rows: IntlNation[] } | null = null;
/**
 * Every national team that plays a competition we follow: its confederation is the one whose competitions it plays
 * most (a World Cup alone says nothing), youth when it only plays youth competitions. Ten minutes in memory: ~4k
 * membership rows behind it.
 */
export async function nations(db: Db): Promise<IntlNation[]> {
  if (nationsCache && Date.now() - nationsCache.at < 10 * 60_000) return nationsCache.rows;
  const lgs = await selectAll<{ id: number; level: string; confederation: string | null; gender: 'm' | 'w' }>(db, 'pro_leagues', 'id,level,confederation,gender', (q) => q.eq('scope', 'intl').eq('enabled', true));
  const byId = new Map(lgs.map((l) => [l.id, l]));
  const members = lgs.length ? await selectAll<{ league_id: number; team_id: number }>(db, 'pro_league_teams', 'league_id,team_id', (q) => q.in('league_id', lgs.map((l) => l.id))) : [];
  const per = new Map<number, { leagues: Set<number> }>();
  for (const m of members) { const x = per.get(m.team_id) ?? { leagues: new Set<number>() }; x.leagues.add(m.league_id); per.set(m.team_id, x); }
  const ids = [...per.keys()];
  const teams = ids.length ? await selectAll<any>(db, 'pro_teams', 'id,display_name,slug,logo,gender,country,national,intl', (q) => q.in('id', ids)) : [];
  const rows: IntlNation[] = [];
  for (const t of teams) {
    // A club seen in an international competition (a few invitationals mix them in) is not a nation.
    if (!t.intl) continue;
    const ls = [...(per.get(t.id)?.leagues ?? [])].map((id) => byId.get(id)).filter(Boolean) as typeof lgs;
    const votes = new Map<string, number>();
    for (const l of ls) if (l.confederation && l.confederation !== 'FIFA' && l.confederation !== 'Other') votes.set(l.confederation, (votes.get(l.confederation) ?? 0) + 1);
    const confederation = [...votes.entries()].sort((a, b) => b[1] - a[1] || confRank(a[0]) - confRank(b[0]))[0]?.[0] ?? 'Other';
    const level: LeagueLevel = ls.length && ls.every((l) => l.level === 'youth') ? 'youth' : /\bU-?\d{2}\b/i.test(t.display_name) ? 'youth' : 'senior';
    const gender: 'm' | 'w' = t.gender === 'w' || ls.some((l) => l.gender === 'w') ? 'w' : 'm';
    rows.push({ id: t.id, name: t.display_name, slug: t.slug, logo: t.logo ?? null, gender, level, confederation, competitions: ls.length, country: t.country ?? null });
  }
  rows.sort((a, b) => confRank(a.confederation) - confRank(b.confederation) || a.name.localeCompare(b.name));
  nationsCache = { at: Date.now(), rows };
  return rows;
}

/**
 * The section's front door: today's international matches (live first), the next ones when today has none (an
 * international window is a few days every month or two), the last week's results, the tournaments playing now or
 * next, and the counts.
 */
export async function home(db: Db, date: string) {
  const { from } = easternDayRange(date);
  const intlIds = (await selectAll<{ id: number }>(db, 'pro_leagues', 'id', (q) => q.eq('enabled', true).eq('scope', 'intl'))).map((l) => l.id).concat([-1]);
  const [today, upcomingRes, recentRes, ts, ns] = await Promise.all([
    matchesByDate(db, { date, scope: 'intl' }),
    db.from('pro_fixtures').select(FIXTURE_SELECT).in('league_id', intlIds).eq('status', 'scheduled').gte('kickoff', from).order('kickoff').limit(60),
    db.from('pro_fixtures').select(FIXTURE_SELECT).in('league_id', intlIds).eq('status', 'final').lt('kickoff', from).gte('kickoff', new Date(Date.parse(from) - 10 * 86400_000).toISOString()).order('kickoff', { ascending: false }).limit(80),
    tournaments(db),
    nations(db),
  ]);
  const todayIds = new Set(today.groups.flatMap((g) => g.matches.map((m) => m.id)));
  const upcoming: ProMatchRow[] = ((upcomingRes.data ?? []) as any[]).map(toMatchRow).filter((m) => !todayIds.has(m.id));
  const recent: ProMatchRow[] = ((recentRes.data ?? []) as any[]).map(toMatchRow);
  return {
    date, matches: today, upcoming, recent,
    tournaments: ts.filter((t) => t.state !== 'off' || t.priority < 100).slice(0, 40),
    counts: { tournaments: ts.length, nations: ns.filter((n) => n.level === 'senior').length, nations_all: ns.length },
  };
}

// ---------- nations' history (open sources, migration 164) ----------
const HISTORY_CREDIT: Record<string, { name: string; url: string; license: string }> = {
  'intl-results': { name: 'international_results (Mart Jürisoo)', url: 'https://github.com/martj42/international_results', license: 'public domain (CC0)' },
  'worldcup-db': { name: 'The Fjelstul World Cup Database (Joshua C. Fjelstul, Ph.D.)', url: 'https://github.com/jfjelstul/worldcup', license: 'CC BY-SA 4.0' },
  'openfootball-wc': { name: 'openfootball', url: 'https://github.com/openfootball/worldcup', license: 'public domain (CC0)' },
  wikipedia: { name: 'Wikipedia', url: 'https://en.wikipedia.org', license: 'CC BY-SA 4.0' },
  elo: { name: 'Plaibook Elo, worked out from every result (World Football Elo method)', url: 'https://www.plaibook.live/intl/rankings', license: 'ours' },
};
/** Which source's copy of a match counts when several have it: the World Cup database, then martj42, then the rest. */
export const SOURCE_RANK: Record<string, number> = { 'worldcup-db': 0, 'intl-results': 1, 'openfootball-wc': 2, wikipedia: 3 };

export interface NationRef { key: string; name: string; slug: string | null; logo: string | null; fifa_code: string | null; confederation: string | null }
export interface IntlResult {
  date: string; home: NationRef; away: NationRef; home_score: number | null; away_score: number | null; aet: boolean | null; pen: [number | null, number | null]; shootout_winner: string | null;
  tournament: string; stage: string | null; city: string | null; country: string | null; neutral: boolean | null; source: string; match_slug: string | null;
}

/** The nation behind an International team address: a pro_teams slug (its senior side) or a nation's own key for a
 *  side the provider never had (Yugoslavia, Czechoslovakia). */
export async function nationOf(db: Db, slug: string): Promise<{ key: string; gender: 'm' | 'w'; team_id: number | null } | null> {
  const { data: t } = await db.from('pro_teams').select('id').eq('slug', slug).maybeSingle();
  const id = (t as { id?: number } | null)?.id;
  if (id != null) {
    const { data: n } = await db.from('intl_nations').select('key,team_m,team_w').or(`team_m.eq.${id},team_w.eq.${id}`).limit(1).maybeSingle();
    const x = n as { key: string; team_m: number | null; team_w: number | null } | null;
    return x ? { key: x.key, gender: x.team_w === id ? 'w' : 'm', team_id: id } : null;
  }
  const { data: n } = await db.from('intl_nations').select('key').eq('key', slug).maybeSingle();
  return n ? { key: (n as { key: string }).key, gender: 'm', team_id: null } : null;
}

async function nationRefs(db: Db, keys: string[], gender: 'm' | 'w'): Promise<Map<string, NationRef>> {
  const uniq = [...new Set(keys)];
  const rows = uniq.length ? await selectAll<{ key: string; name: string; fifa_code: string | null; confederation: string | null; team_m: number | null; team_w: number | null }>(db, 'intl_nations', 'key,name,fifa_code,confederation,team_m,team_w', (q) => q.in('key', uniq)) : [];
  const teamIds = rows.map((r) => (gender === 'w' ? r.team_w : r.team_m)).filter((x): x is number => x != null);
  const teams = new Map((teamIds.length ? await selectAll<{ id: number; slug: string; logo: string | null }>(db, 'pro_teams', 'id,slug,logo', (q) => q.in('id', teamIds)) : []).map((t) => [t.id, t]));
  return new Map(rows.map((r) => { const t = teams.get((gender === 'w' ? r.team_w : r.team_m) ?? -1); return [r.key, { key: r.key, name: r.name, slug: t?.slug ?? r.key, logo: t?.logo ?? null, fifa_code: r.fifa_code, confederation: r.confederation }]; }));
}

/** Every result of a nation (or between two), the best source of each match, switched-off sources left out. */
async function results(db: Db, gender: 'm' | 'w', nation: string, opponent?: string) {
  const off = await sourcesOff(db);
  const rows = await selectAll<any>(db, 'intl_src_matches', 'source,date,home,away,home_score,away_score,pen_home,pen_away,aet,shootout_winner,tournament,stage,city,country,neutral,pro_fixture_id',
    (q) => q.eq('gender', gender).eq('level', 'senior').or(opponent ? `and(home.eq.${nation},away.eq.${opponent}),and(home.eq.${opponent},away.eq.${nation})` : `home.eq.${nation},away.eq.${nation}`).order('date'));
  const best = new Map<string, any>();
  for (const r of rows) {
    if (off.has(r.source)) continue;
    const k = `${r.date}|${[r.home, r.away].sort().join('|')}`;
    const cur = best.get(k);
    if (!cur || (SOURCE_RANK[r.source] ?? 9) < (SOURCE_RANK[cur.source] ?? 9)) best.set(k, { ...r, pro_fixture_id: r.pro_fixture_id ?? cur?.pro_fixture_id ?? null });
    else if (!cur.pro_fixture_id && r.pro_fixture_id) cur.pro_fixture_id = r.pro_fixture_id;
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function toResults(db: Db, rows: any[], gender: 'm' | 'w'): Promise<IntlResult[]> {
  const refs = await nationRefs(db, rows.flatMap((r) => [r.home, r.away]), gender);
  const fxIds = rows.map((r) => r.pro_fixture_id).filter(Boolean);
  const slugs = new Map<number, string>();
  for (let i = 0; i < fxIds.length; i += 300) for (const f of await selectAll<{ id: number; slug: string }>(db, 'pro_fixtures', 'id,slug', (q) => q.in('id', fxIds.slice(i, i + 300)))) slugs.set(Number(f.id), f.slug);
  const ref = (k: string): NationRef => refs.get(k) ?? { key: k, name: k, slug: k, logo: null, fifa_code: null, confederation: null };
  return rows.map((r) => ({ date: r.date, home: ref(r.home), away: ref(r.away), home_score: r.home_score, away_score: r.away_score, aet: r.aet, pen: [r.pen_home, r.pen_away], shootout_winner: r.shootout_winner,
    tournament: r.tournament, stage: r.stage, city: r.city, country: r.country, neutral: r.neutral, source: r.source, match_slug: r.pro_fixture_id ? slugs.get(Number(r.pro_fixture_id)) ?? null : null }));
}

type Tally = { played: number; w: number; d: number; l: number; gf: number; ga: number };
const tallyOf = (rows: any[], nation: string): Tally => {
  const t: Tally = { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  for (const r of rows) {
    if (r.home_score == null || r.away_score == null) continue;
    const us = r.home === nation ? r.home_score : r.away_score, them = r.home === nation ? r.away_score : r.home_score;
    t.played += 1; t.gf += us; t.ga += them;
    if (us > them) t.w += 1; else if (us < them) t.l += 1; else t.d += 1;
  }
  return t;
};

/**
 * A nation's history for its International page: record since its first match, by competition, against each
 * opponent, its biggest wins and defeats, its top scorers (goals in the results' own source), most capped players,
 * World Cup squads, and its Plaibook Elo over time with today's rank. Results come from open sources; every block
 * credits them.
 */
export async function nationHistory(db: Db, key: string, gender: 'm' | 'w') {
  const [nationRow, rows, caps, eloRows, eloNow] = await Promise.all([
    db.from('intl_nations').select('key,name,fifa_code,confederation,first_match,team_m,team_w,fifa').eq('key', key).maybeSingle().then((r) => r.data as any),
    results(db, gender, key),
    selectAll<any>(db, 'intl_caps', 'source,person,player_name,caps,goals,first_year,last_year,pro_player_id', (q) => q.eq('nation', key).eq('gender', gender).order('caps', { ascending: false, nullsFirst: false }).limit(60)),
    selectAll<{ date: string; rating: number }>(db, 'intl_elo', 'date,rating', (q) => q.eq('gender', gender).eq('nation', key).order('date')),
    db.from('intl_elo_current').select('rating,rank,matches,last_match,change_1y,best,best_date').eq('gender', gender).eq('nation', key).maybeSingle().then((r) => r.data as any),
  ]);
  if (!nationRow) return null;
  const record = tallyOf(rows, key);
  const byComp = new Map<string, any[]>();
  for (const r of rows) byComp.set(r.tournament, [...(byComp.get(r.tournament) ?? []), r]);
  const byOpp = new Map<string, any[]>();
  for (const r of rows) { const o = r.home === key ? r.away : r.home; byOpp.set(o, [...(byOpp.get(o) ?? []), r]); }
  const margin = (r: any) => (r.home === key ? 1 : -1) * ((r.home_score ?? 0) - (r.away_score ?? 0));
  const scored = rows.filter((r) => r.home_score != null);
  const biggestWins = [...scored].filter((r) => margin(r) > 0).sort((a, b) => margin(b) - margin(a) || b.date.localeCompare(a.date)).slice(0, 5);
  const worstDefeats = [...scored].filter((r) => margin(r) < 0).sort((a, b) => margin(a) - margin(b) || b.date.localeCompare(a.date)).slice(0, 5);
  // Scorers: the goals of each match's chosen source (two sources' goals for one World Cup match are not added up).
  const chosen = new Map(rows.map((r) => [`${r.date}|${r.home}|${r.away}`, r.source]));
  const goals = await selectAll<{ source: string; date: string; home: string; away: string; scorer: string; own_goal: boolean; penalty: boolean; pro_player_id: number | null }>(db, 'intl_src_goals', 'source,date,home,away,scorer,own_goal,penalty,pro_player_id', (q) => q.eq('gender', gender).eq('team', key));
  const scorers = new Map<string, { name: string; goals: number; penalties: number; first: string; last: string; pro_player_id: number | null }>();
  for (const g of goals) {
    if (g.own_goal || chosen.get(`${g.date}|${g.home}|${g.away}`) !== g.source) continue;
    const s = scorers.get(g.scorer) ?? { name: g.scorer, goals: 0, penalties: 0, first: g.date, last: g.date, pro_player_id: g.pro_player_id };
    s.goals += 1; if (g.penalty) s.penalties += 1; if (g.date < s.first) s.first = g.date; if (g.date > s.last) s.last = g.date;
    scorers.set(g.scorer, s);
  }
  const playerIds = [...new Set([...caps.map((c) => c.pro_player_id), ...[...scorers.values()].map((s) => s.pro_player_id)].filter(Boolean))];
  const people = new Map((playerIds.length ? await selectAll<{ id: number; slug: string; photo: string | null }>(db, 'pro_players', 'id,slug,photo', (q) => q.in('id', playerIds)) : []).map((p) => [p.id, p]));
  const squads = await selectAll<{ year: number; tournament: string; player_name: string; shirt: number | null; position: string | null; pro_player_id: number | null }>(db, 'intl_squads', 'year,tournament,player_name,shirt,position,pro_player_id', (q) => q.eq('nation', key).eq('gender', gender).order('year', { ascending: false }));
  const opponents = [...byOpp.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20);
  const refs = await nationRefs(db, [key, ...opponents.map(([o]) => o)], gender);
  const wcEditions = [...new Set(squads.map((s) => s.year))];
  // Elo through time, thinned to one point a month (a rating line, not every match).
  const series: { date: string; rating: number }[] = [];
  for (const e of eloRows) { const last = series[series.length - 1]; if (last && last.date.slice(0, 7) === e.date.slice(0, 7)) last.rating = Number(e.rating); else series.push({ date: e.date, rating: Number(e.rating) }); }
  const usedSources = [...new Set(rows.map((r) => r.source)), ...(squads.length ? ['worldcup-db'] : [])];
  return {
    nation: { ...refs.get(key)!, first_match: nationRow.first_match, fifa: nationRow.fifa }, gender,
    record, first_match: rows[0]?.date ?? null,
    competitions: [...byComp.entries()].map(([name, rs]) => ({ name, ...tallyOf(rs, key), first: rs[0].date, last: rs[rs.length - 1].date })).sort((a, b) => b.played - a.played),
    opponents: opponents.map(([o, rs]) => ({ nation: refs.get(o) ?? { key: o, name: o, slug: o, logo: null, fifa_code: null, confederation: null }, ...tallyOf(rs, key), last: rs[rs.length - 1].date })),
    biggest_wins: await toResults(db, biggestWins, gender), worst_defeats: await toResults(db, worstDefeats, gender),
    recent: await toResults(db, rows.slice(-25).reverse(), gender),
    scorers: [...scorers.values()].sort((a, b) => b.goals - a.goals || a.first.localeCompare(b.first)).slice(0, 25).map((s) => ({ ...s, slug: s.pro_player_id ? people.get(s.pro_player_id)?.slug ?? null : null })),
    caps: caps.filter((c) => c.caps != null).slice(0, 25).map((c) => ({ name: c.player_name, caps: c.caps, goals: c.goals, first_year: c.first_year, last_year: c.last_year, slug: c.pro_player_id ? people.get(c.pro_player_id)?.slug ?? null : null, photo: c.pro_player_id ? people.get(c.pro_player_id)?.photo ?? null : null })),
    world_cups: { editions: wcEditions.length, years: wcEditions.sort((a, b) => b - a) },
    elo: eloNow ? { ...eloNow, series } : null,
    credits: usedSources.map((s) => HISTORY_CREDIT[s]).filter((c): c is (typeof HISTORY_CREDIT)[string] => !!c).concat(eloNow ? [HISTORY_CREDIT.elo!] : []),
  };
}

/** Every result between two nations, oldest first, with the record. */
export async function headToHead(db: Db, a: string, b: string, gender: 'm' | 'w') {
  const rows = await results(db, gender, a, b);
  const refs = await nationRefs(db, [a, b], gender);
  return { a: refs.get(a) ?? null, b: refs.get(b) ?? null, gender, record: tallyOf(rows, a), results: (await toResults(db, rows, gender)).reverse() };
}

/** Plaibook Elo rankings: FIFA nations that played in the last four years. */
export async function rankings(db: Db, gender: 'm' | 'w') {
  const rows = await selectAll<{ nation: string; rating: number; rank: number; matches: number; last_match: string; change_1y: number | null; best: number; best_date: string; updated_at: string }>(db, 'intl_elo_current', 'nation,rating,rank,matches,last_match,change_1y,best,best_date,updated_at',
    (q) => q.eq('gender', gender).not('rank', 'is', null).order('rank'));
  const refs = await nationRefs(db, rows.map((r) => r.nation), gender);
  return { gender, updated_at: rows[0]?.updated_at ?? null, credit: HISTORY_CREDIT.elo, rows: rows.map((r) => ({ ...r, rating: Math.round(Number(r.rating)), change_1y: r.change_1y == null ? null : Math.round(Number(r.change_1y)), best: Math.round(Number(r.best)), nation: refs.get(r.nation) ?? { key: r.nation, name: r.nation, slug: r.nation, logo: null, fifa_code: null, confederation: null } })) };
}

/** A player's international career for the International player page: caps by nation (Wikipedia careers) and the
 *  World Cup squads he was named in (Fjelstul). His match lines and season rows come from the Pro player model. */
export async function playerInternational(db: Db, playerId: number) {
  const [caps, squads] = await Promise.all([
    selectAll<{ nation: string; gender: 'm' | 'w'; caps: number | null; goals: number | null; first_year: number | null; last_year: number | null; source: string }>(db, 'intl_caps', 'nation,gender,caps,goals,first_year,last_year,source', (q) => q.eq('pro_player_id', playerId)),
    selectAll<{ nation: string; gender: 'm' | 'w'; year: number; shirt: number | null; position: string | null; tournament: string }>(db, 'intl_squads', 'nation,gender,year,shirt,position,tournament', (q) => q.eq('pro_player_id', playerId).order('year')),
  ]);
  const gender = caps[0]?.gender ?? squads[0]?.gender ?? 'm';
  const refs = await nationRefs(db, [...caps.map((c) => c.nation), ...squads.map((s) => s.nation)], gender);
  return {
    caps: caps.map((c) => ({ ...c, nation: refs.get(c.nation) ?? null })).sort((a, b) => (b.caps ?? 0) - (a.caps ?? 0)),
    world_cups: squads.map((s) => ({ ...s, nation: refs.get(s.nation) ?? null })),
    credits: [...(caps.length ? [HISTORY_CREDIT.wikipedia!] : []), ...(squads.length ? [HISTORY_CREDIT['worldcup-db']!] : [])],
  };
}
