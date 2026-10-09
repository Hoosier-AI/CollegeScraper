// Reads for Plaibook Stats Pro: the site's /api/pro/* routes and the server-rendered /pro pages use the same functions,
// so what a crawler reads and what a visitor sees cannot drift apart. Service-role reads of the pro_* tables.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { SHOW_AT } from '../jobs/pro/collegeMatch.js';
import { leagueAdvancedLeaders, matchAdvanced, playerAdvanced, teamAdvanced } from './sources.js';

// ---------- shapes ----------
export interface ProLeagueRef { id: number; name: string; slug: string; logo: string | null; country: string | null; country_flag?: string | null; gender: 'm' | 'w'; type?: 'league' | 'cup' }
export interface ProTeamRef { id: number; name: string; slug: string; logo: string | null; country?: string | null; gender?: 'm' | 'w' | null; national?: boolean }
export interface ProMatchSide extends ProTeamRef { score: number | null }
export interface ProMatchRow {
  id: number; slug: string; kickoff: string; status: string; status_short: string | null; elapsed: number | null; elapsed_extra: number | null; round: string | null; season: number;
  league: ProLeagueRef; home: ProMatchSide; away: ProMatchSide;
  ht: [number | null, number | null]; et: [number | null, number | null]; pen: [number | null, number | null]; winner: 'home' | 'away' | 'draw' | null;
  venue: string | null; detail: boolean;
}
export interface ProLeaderRow { player: { id: number; name: string; slug: string; photo: string | null }; team: ProTeamRef | null; apps: number; minutes: number; goals: number; assists: number; rating: number | null }
export interface ProStandingRow { rank: number | null; team: ProTeamRef; played: number | null; win: number | null; draw: number | null; lose: number | null; gf: number | null; ga: number | null; gd: number | null; points: number | null; form: string | null; description: string | null }
export interface ProStandingGroup { name: string; rows: ProStandingRow[] }

const TEAM_COLS = 'id,display_name,slug,logo,country,gender,national';
const LEAGUE_COLS = 'id,name,slug,logo,country,country_flag,gender,type';
export const FIXTURE_SELECT = `id,slug,kickoff,status,status_short,elapsed,elapsed_extra,round,season,home_goals,away_goals,ht_home,ht_away,et_home,et_away,pen_home,pen_away,winner,venue_name,venue_city,detail_fetched_at,
league:pro_leagues!pro_fixtures_league_id_fkey(${LEAGUE_COLS}),
home:pro_teams!pro_fixtures_home_team_id_fkey(${TEAM_COLS}),
away:pro_teams!pro_fixtures_away_team_id_fkey(${TEAM_COLS})`;

const teamRef = (t: any): ProTeamRef => ({ id: t?.id, name: t?.display_name ?? 'TBD', slug: t?.slug ?? '', logo: t?.logo ?? null, country: t?.country ?? null, gender: t?.gender ?? null, national: !!t?.national });
const leagueRef = (l: any): ProLeagueRef => ({ id: l?.id, name: l?.name ?? '', slug: l?.slug ?? '', logo: l?.logo ?? null, country: l?.country ?? null, country_flag: l?.country_flag ?? null, gender: l?.gender ?? 'm', type: l?.type });

export function toMatchRow(r: any): ProMatchRow {
  return {
    id: Number(r.id), slug: r.slug, kickoff: r.kickoff, status: r.status, status_short: r.status_short ?? null, elapsed: r.elapsed ?? null, elapsed_extra: r.elapsed_extra ?? null, round: r.round ?? null, season: r.season,
    league: leagueRef(r.league), home: { ...teamRef(r.home), score: r.home_goals ?? null }, away: { ...teamRef(r.away), score: r.away_goals ?? null },
    ht: [r.ht_home ?? null, r.ht_away ?? null], et: [r.et_home ?? null, r.et_away ?? null], pen: [r.pen_home ?? null, r.pen_away ?? null], winner: r.winner ?? null,
    venue: [r.venue_name, r.venue_city].filter(Boolean).join(', ') || null, detail: !!r.detail_fetched_at,
  };
}

/** Live first, then by kickoff; within a kickoff, the more important competition first. */
export function sortMatches(rows: ProMatchRow[], priority: Map<number, number> = new Map()): ProMatchRow[] {
  const rank = (s: string) => (s === 'live' ? 0 : 1);
  return [...rows].sort((a, b) => rank(a.status) - rank(b.status) || (priority.get(a.league.id) ?? 999) - (priority.get(b.league.id) ?? 999) || a.kickoff.localeCompare(b.kickoff) || a.id - b.id);
}

/** UTC bounds of an America/New_York calendar day (the site's day, like the college scoreboard). */
export function easternDayRange(date: string): { from: string; to: string } {
  const offsetAt = (iso: string) => {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(d);
    const m = /GMT([+-]\d+)/.exec(parts.find((p) => p.type === 'timeZoneName')?.value ?? '');
    return m ? Number(m[1]) : -5;
  };
  const start = new Date(`${date}T00:00:00Z`).getTime() - offsetAt(`${date}T12:00:00Z`) * 3600_000;
  const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const nextIso = next.toISOString().slice(0, 10);
  const end = next.getTime() - offsetAt(`${nextIso}T12:00:00Z`) * 3600_000;
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

async function priorities(db: Db): Promise<Map<number, number>> {
  const rows = await selectAll<{ id: number; priority: number }>(db, 'pro_leagues', 'id,priority', (q) => q.eq('enabled', true));
  return new Map(rows.map((r) => [r.id, r.priority]));
}

// ---------- matches ----------
export async function matchesByDate(db: Db, o: { date: string; league?: number | null; status?: string | null; featured?: boolean }) {
  const { from, to } = easternDayRange(o.date);
  const prio = await priorities(db);
  let rows = (await selectAll<any>(db, 'pro_fixtures', FIXTURE_SELECT, (q) => {
    q = q.gte('kickoff', from).lt('kickoff', to).order('kickoff');
    if (o.league) q = q.eq('league_id', o.league);
    if (o.status) q = q.eq('status', o.status);
    return q;
  })).map(toMatchRow).filter((m) => prio.has(m.league.id));
  if (o.featured) rows = rows.filter((m) => (prio.get(m.league.id) ?? 999) < 100);
  const sorted = sortMatches(rows, prio);
  // Grouped by competition for the scoreboard, in priority order.
  const groups = new Map<number, { league: ProLeagueRef; priority: number; matches: ProMatchRow[] }>();
  for (const m of sorted) {
    const g = groups.get(m.league.id) ?? { league: m.league, priority: prio.get(m.league.id) ?? 999, matches: [] };
    g.matches.push(m); groups.set(m.league.id, g);
  }
  const list = [...groups.values()].sort((a, b) => a.priority - b.priority || a.league.name.localeCompare(b.league.name));
  for (const g of list) g.matches.sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id - b.id);
  return { date: o.date, total: sorted.length, live: sorted.filter((m) => m.status === 'live').length, groups: list };
}

export async function home(db: Db, date: string) {
  const [day, featured, counts] = await Promise.all([
    matchesByDate(db, { date }),
    db.from('pro_leagues').select(LEAGUE_COLS + ',priority,current_season').eq('enabled', true).lt('priority', 100).order('priority').limit(40),
    Promise.all(['pro_leagues', 'pro_teams', 'pro_players', 'pro_fixtures'].map((t) => {
      const q = db.from(t).select('id', { count: 'estimated', head: true });
      return (t === 'pro_leagues' ? q.eq('enabled', true) : q).then((r) => r.count ?? 0);
    })),
  ]);
  return {
    date, matches: day, featured: ((featured.data ?? []) as any[]).map((l) => ({ ...leagueRef(l), current_season: l.current_season })),
    counts: { leagues: counts[0], teams: counts[1], players: counts[2], matches: counts[3] },
  };
}

// ---------- leagues ----------
export async function leagues(db: Db) {
  const rows = await selectAll<any>(db, 'pro_leagues', LEAGUE_COLS + ',priority,current_season', (q) => q.eq('enabled', true).order('priority').order('name'));
  return rows.map((l) => ({ ...leagueRef(l), priority: l.priority, current_season: l.current_season }));
}

async function standingsFor(db: Db, league: number, season: number): Promise<ProStandingGroup[]> {
  const rows = await selectAll<any>(db, 'pro_standings', `group_name,rank,points,played,win,draw,lose,gf,ga,gd,form,description,team:pro_teams(${TEAM_COLS})`, (q) => q.eq('league_id', league).eq('season', season).order('group_name').order('rank'));
  const groups = new Map<string, ProStandingRow[]>();
  for (const r of rows) groups.set(r.group_name, [...(groups.get(r.group_name) ?? []), { rank: r.rank, team: teamRef(r.team), played: r.played, win: r.win, draw: r.draw, lose: r.lose, gf: r.gf, ga: r.ga, gd: r.gd, points: r.points, form: r.form, description: r.description }]);
  return [...groups.entries()].map(([name, rows]) => ({ name, rows }));
}

async function leadersFor(db: Db, league: number, season: number, stat: 'goals' | 'assists', limit = 15): Promise<ProLeaderRow[]> {
  const { data, error } = await db.from('pro_player_season_stats').select(`player_id,team_id,apps,minutes,goals,assists,rating,player:pro_players(id,display_name,slug,photo,noindex)`)
    .eq('league_id', league).eq('season', season).gt(stat, 0).order(stat, { ascending: false }).order('minutes', { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const teams = await teamsById(db, rows.map((r) => r.team_id));
  return rows.map((r) => ({ player: { id: r.player?.id, name: r.player?.display_name, slug: r.player?.slug, photo: r.player?.photo ?? null }, team: teams.get(r.team_id) ?? null, apps: r.apps, minutes: r.minutes, goals: r.goals, assists: r.assists, rating: r.rating == null ? null : Number(r.rating) }));
}

const HISTORY_CREDIT: Record<string, { name: string; url: string; license: string }> = {
  openfootball: { name: 'openfootball', url: 'https://github.com/openfootball/world', license: 'public domain (CC0)' },
  wikipedia: { name: 'Wikipedia', url: 'https://en.wikipedia.org', license: 'CC BY-SA 4.0' },
  asa: { name: 'American Soccer Analysis', url: 'https://www.americansocceranalysis.com', license: 'credited' },
};
/** Credits for a history season: the results' source, and Wikipedia when its table replaced one worked out from them. */
function historyCredits(source: string | null, hasResults: boolean) {
  if (!source) return null;
  const out = [{ what: hasResults ? 'Results' : 'Table', ...HISTORY_CREDIT[source]! }];
  if (source !== 'wikipedia') out.push({ what: 'Table', ...HISTORY_CREDIT.wikipedia! });
  return out;
}

export async function teamsById(db: Db, ids: number[]): Promise<Map<number, ProTeamRef>> {
  const uniq = [...new Set(ids.filter((n) => Number.isFinite(n)))];
  if (!uniq.length) return new Map();
  const rows = await selectAll<any>(db, 'pro_teams', TEAM_COLS, (q) => q.in('id', uniq));
  return new Map(rows.map((t) => [t.id, teamRef(t)]));
}

export async function leaguesById(db: Db, ids: number[]): Promise<Map<number, ProLeagueRef & { priority: number }>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const rows = await selectAll<any>(db, 'pro_leagues', LEAGUE_COLS + ',priority', (q) => q.in('id', uniq));
  return new Map(rows.map((l) => [l.id, { ...leagueRef(l), priority: l.priority }]));
}

export async function league(db: Db, slug: string, season?: number | null) {
  const { data: l, error } = await db.from('pro_leagues').select(LEAGUE_COLS + ',priority,current_season,enabled,kind').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!l) return null;
  const lg = l as any;
  const seasons = (await selectAll<{ season: number; starts_on: string | null; ends_on: string | null; backfilled_at: string | null; fixtures_synced_at: string | null; coverage: { source?: string } | null }>(db, 'pro_seasons', 'season,starts_on,ends_on,backfilled_at,fixtures_synced_at,coverage', (q) => q.eq('league_id', lg.id).order('season', { ascending: false })));
  const s = season ?? lg.current_season ?? seasons[0]?.season ?? null;
  if (s == null) return { league: { ...leagueRef(lg), enabled: lg.enabled as boolean, current_season: (lg.current_season ?? null) as number | null }, season: null, seasons: [] as number[], standings: [] as ProStandingGroup[], results: [] as ProMatchRow[], fixtures: [] as ProMatchRow[], scorers: [] as ProLeaderRow[], assists: [] as ProLeaderRow[], teams: 0, champions: [] as { season: number; teams: { team: ProTeamRef; group: string; points: number | null }[] }[], team_table: [] as any[] };
  const now = new Date().toISOString();
  const [standings, results, fixtures, scorers, assisters, teamCount] = await Promise.all([
    standingsFor(db, lg.id, s),
    db.from('pro_fixtures').select(FIXTURE_SELECT).eq('league_id', lg.id).eq('season', s).in('status', ['final', 'live']).order('kickoff', { ascending: false }).limit(30),
    db.from('pro_fixtures').select(FIXTURE_SELECT).eq('league_id', lg.id).eq('season', s).eq('status', 'scheduled').gte('kickoff', now).order('kickoff').limit(30),
    leadersFor(db, lg.id, s, 'goals'),
    leadersFor(db, lg.id, s, 'assists'),
    db.from('pro_team_season_stats').select('team_id', { count: 'exact', head: true }).eq('league_id', lg.id).eq('season', s),
  ]);
  const [champRows, teamRows] = await Promise.all([
    selectAll<any>(db, 'pro_standings', `season,group_name,points,team:pro_teams(${TEAM_COLS})`, (q) => q.eq('league_id', lg.id).eq('rank', 1).lt('season', lg.current_season ?? 9999).order('season', { ascending: false })),
    selectAll<any>(db, 'pro_team_season_stats', `played,w,d,l,gf,ga,clean_sheets,shots,shots_on,corners,fouls,yellow,red,possession,team:pro_teams(${TEAM_COLS})`, (q) => q.eq('league_id', lg.id).eq('season', s)),
  ]);
  // A league with several groups (conferences) has several rank-1 rows a season: shown as one season with each group.
  const champions = new Map<number, { season: number; teams: { team: ProTeamRef; group: string; points: number | null }[] }>();
  for (const r of champRows) { if (!r.team) continue; const c = champions.get(r.season) ?? { season: r.season, teams: [] as { team: ProTeamRef; group: string; points: number | null }[] }; c.teams.push({ team: teamRef(r.team), group: r.group_name, points: r.points }); champions.set(r.season, c); }
  const teamTable = teamRows.filter((r) => r.team).map((r) => ({ team: teamRef(r.team), played: r.played, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, clean_sheets: r.clean_sheets, shots: r.shots, shots_on: r.shots_on, corners: r.corners, fouls: r.fouls, yellow: r.yellow, red: r.red, possession: r.possession == null ? null : Number(r.possession) }))
    .sort((a, b) => b.gf / Math.max(1, b.played) - a.gf / Math.max(1, a.played));
  return {
    league: { ...leagueRef(lg), enabled: lg.enabled as boolean, current_season: (lg.current_season ?? null) as number | null }, season: s as number | null,
    seasons: seasons.filter((x) => x.fixtures_synced_at || x.season === lg.current_season).map((x) => x.season),
    standings, results: ((results.data ?? []) as any[]).map(toMatchRow), fixtures: ((fixtures.data ?? []) as any[]).map(toMatchRow),
    scorers, assists: assisters, teams: teamCount.count ?? 0,
    champions: [...champions.values()].slice(0, 15), team_table: teamTable,
    advanced_leaders: await leagueAdvancedLeaders(db, lg.id, s ?? null),
    // A season API-Football does not have: where its results and table came from (credited on the page).
    history_sources: historyCredits(seasons.find((x) => x.season === s)?.coverage?.source ?? null, ((results.data ?? []) as any[]).length > 0),
  };
}

// ---------- teams ----------
export async function team(db: Db, slug: string, season?: number | null) {
  const { data: t, error } = await db.from('pro_teams').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!t) return null;
  const tm = t as any;
  // The seasons and competitions this club appears in, from its matches.
  const all = await selectAll<{ league_id: number; season: number }>(db, 'pro_team_season_stats', 'league_id,season', (q) => q.eq('team_id', tm.id));
  const fixturesSeasons = (await db.from('pro_fixtures').select('season').or(`home_team_id.eq.${tm.id},away_team_id.eq.${tm.id}`).order('kickoff', { ascending: false }).limit(1)).data as { season: number }[] | null;
  const seasons = [...new Set([...all.map((r) => r.season), ...(fixturesSeasons ?? []).map((r) => r.season)])].sort((a, b) => b - a);
  const s = season ?? seasons[0] ?? null;
  const games = s == null ? [] : (await selectAll<any>(db, 'pro_fixtures', FIXTURE_SELECT, (q) => q.or(`home_team_id.eq.${tm.id},away_team_id.eq.${tm.id}`).eq('season', s).order('kickoff'))).map(toMatchRow);
  const today = new Date().toISOString().slice(0, 10);
  const [squadRows, totals, standingRows, listed, coachRows, moves, hurt, ground, detailRows] = await Promise.all([
    s == null ? [] : selectAll<any>(db, 'pro_player_season_stats', 'player_id,league_id,apps,starts,minutes,goals,assists,yellow,red,saves,conceded,clean_sheets,rating,position,number,player:pro_players(id,display_name,slug,photo,position,nationality,birth_date)', (q) => q.eq('team_id', tm.id).eq('season', s)),
    s == null ? [] : selectAll<any>(db, 'pro_team_season_stats', '*', (q) => q.eq('team_id', tm.id).eq('season', s)),
    s == null ? [] : selectAll<any>(db, 'pro_standings', 'league_id,group_name,rank,points,played,win,draw,lose,gf,ga,gd,form', (q) => q.eq('team_id', tm.id).eq('season', s)),
    // The current squad (players/squads), only shown for the latest season.
    s === seasons[0] || s == null ? selectAll<any>(db, 'pro_squads', 'player_id,number,position,player:pro_players(id,display_name,slug,photo,position,nationality,birth_date)', (q) => q.eq('team_id', tm.id)) : Promise.resolve([] as any[]),
    selectAll<any>(db, 'pro_coach_career', 'start,end,coach:pro_coaches(id,display_name,photo,nationality,birth_date)', (q) => q.eq('team_id', tm.id).order('start', { ascending: false })),
    db.from('pro_transfers').select('player_id,date,type,player_name,from_team_id,from_name,from_logo,to_team_id,to_name,to_logo').or(`to_team_id.eq.${tm.id},from_team_id.eq.${tm.id}`).lte('date', today).order('date', { ascending: false }).limit(60),
    db.from('pro_injuries').select('player_id,type,reason,date').eq('team_id', tm.id).gte('date', new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10)).order('date', { ascending: false }).limit(60),
    tm.venue_id ? db.from('pro_venues').select('name,address,city,capacity,surface,image').eq('id', tm.venue_id).maybeSingle() : Promise.resolve({ data: null }),
    // The provider's season stats per competition (teams/statistics): formations, biggest results, streaks ...
    s == null ? [] : selectAll<any>(db, 'pro_team_season_detail', '*', (q) => q.eq('team_id', tm.id).eq('season', s)),
  ]);
  const lgs = await leaguesById(db, [...totals.map((x) => x.league_id), ...games.map((g) => g.league.id), ...standingRows.map((x) => x.league_id), ...detailRows.map((x) => x.league_id)]);
  // One squad line per player: the listed squad first, plus anyone who played for the club this season.
  const squad = new Map<number, any>();
  const blank = (pl: any, number: number | null, pos: string | null) => ({ player: { id: pl?.id, name: pl?.display_name, slug: pl?.slug, photo: pl?.photo ?? null, position: pos ?? pl?.position ?? null, nationality: pl?.nationality ?? null, birth_date: pl?.birth_date ?? null }, number, listed: false, apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, saves: null as number | null, conceded: null as number | null, clean_sheets: null as number | null, rating: null as number | null, _rw: 0 });
  for (const r of listed) { if (!r.player) continue; const b = blank(r.player, r.number ?? null, r.position ?? null); b.listed = true; squad.set(r.player_id, b); }
  for (const r of squadRows) {
    if (!r.player) continue;
    const row = squad.get(r.player_id) ?? blank(r.player, r.number ?? null, r.position ?? null);
    const add = (a: number | null | undefined, b: number | null | undefined) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
    for (const k of ['apps', 'starts', 'minutes', 'goals', 'assists', 'yellow', 'red'] as const) row[k] = (row[k] ?? 0) + (r[k] ?? 0);
    for (const k of ['saves', 'conceded', 'clean_sheets'] as const) row[k] = add(row[k], r[k]);
    row._rw += (Number(r.rating) || 0) * r.apps;
    row.rating = row.apps && row._rw ? Math.round((row._rw / row.apps) * 100) / 100 : null;
    if (row.number == null && r.number != null) row.number = r.number;
    squad.set(r.player_id, row);
  }
  const order = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'];
  const posRank = (pos: string | null) => { const i = order.indexOf(pos ?? ''); return i < 0 ? order.length : i; };
  const finals = games.filter((g) => g.status === 'final');
  // Goals for and against by 15-minute period, from the stored events of this season's finals.
  const periods = ['1-15', '16-30', '31-45', '46-60', '61-75', '76-90', 'ET'];
  const byPeriod = periods.map((p) => ({ period: p, for: 0, against: 0 }));
  const finalIds = finals.map((g) => g.id);
  for (const ids of chunkIds(finalIds, 150)) {
    const goals = await selectAll<any>(db, 'pro_fixture_events', 'team_id,minute,detail', (q) => q.in('fixture_id', ids).eq('type', 'goal').neq('detail', 'Missed Penalty'));
    for (const e of goals) {
      const m = Number(e.minute) || 0;
      // Stoppage time keeps its half's minute (45+2 is 45, 90+3 is 90); extra time runs 91 to 120.
      const i = m > 90 ? 6 : m <= 15 ? 0 : m <= 30 ? 1 : m <= 45 ? 2 : m <= 60 ? 3 : m <= 75 ? 4 : 5;
      // An own goal is recorded against the scorer's club: it counts for the other side.
      const ours = e.detail === 'Own Goal' ? e.team_id !== tm.id : e.team_id === tm.id;
      if (ours) byPeriod[i]!.for += 1; else byPeriod[i]!.against += 1;
    }
  }
  // The provider's goals by minute, when it has them, replace ours (it counts every competition's matches, ours only
  // those with stored events).
  if (detailRows.length) {
    const PROVIDER: Record<string, number> = { '0-15': 0, '16-30': 1, '31-45': 2, '46-60': 3, '61-75': 4, '76-90': 5, '91-105': 6, '106-120': 6 };
    for (const r of byPeriod) { r.for = 0; r.against = 0; }
    for (const d of detailRows) for (const side of ['for', 'against'] as const) {
      for (const [k, n] of Object.entries((d.goals?.[side]?.minute ?? {}) as Record<string, number | null>)) {
        const i = PROVIDER[k];
        if (i != null && n) byPeriod[i]![side] += n;
      }
    }
    byPeriod[6]!.period = '90+';
  }
  const coachIds = [...new Set(coachRows.map((c) => c.coach?.id).filter(Boolean))].slice(0, 12) as number[];
  const coachHonours = coachIds.length ? await selectAll<{ subject_id: number; place: string }>(db, 'pro_trophies', 'subject_id,place', (q) => q.eq('subject', 'coach').in('subject_id', coachIds)) : [];
  const honoursOf = (id: number) => { const all = coachHonours.filter((h) => h.subject_id === id); return { trophies: all.filter((h) => /winner/i.test(h.place)).length, finals: all.length }; };
  const split = (home: boolean) => {
    const g = finals.filter((x) => (x.home.id === tm.id) === home);
    const us = (x: ProMatchRow) => (home ? x.home.score : x.away.score) ?? 0, them = (x: ProMatchRow) => (home ? x.away.score : x.home.score) ?? 0;
    return { played: g.length, w: g.filter((x) => us(x) > them(x)).length, d: g.filter((x) => us(x) === them(x)).length, l: g.filter((x) => us(x) < them(x)).length, gf: g.reduce((n, x) => n + us(x), 0), ga: g.reduce((n, x) => n + them(x), 0) };
  };
  const hurtIds = [...new Set(((hurt.data ?? []) as any[]).map((h) => h.player_id))];
  const moveIds = [...new Set(((moves.data ?? []) as any[]).map((m) => m.player_id))];
  const people = new Map((hurtIds.length + moveIds.length ? await selectAll<any>(db, 'pro_players', 'id,display_name,slug', (q) => q.in('id', [...hurtIds, ...moveIds])) : []).map((p) => [p.id, p]));
  const hurtPlayers = people;
  const clubSlugs = await teamsById(db, ((moves.data ?? []) as any[]).flatMap((m) => [m.from_team_id, m.to_team_id]).filter((x) => x > 0));
  const coachSeen = new Set<number>();
  return {
    team: { ...teamRef(tm), founded: tm.founded, national: tm.national,
      venue: ground.data ? { name: (ground.data as any).name, city: (ground.data as any).city, capacity: (ground.data as any).capacity, address: (ground.data as any).address ?? null, surface: (ground.data as any).surface ?? null, image: (ground.data as any).image ?? null }
        : tm.venue_name ? { name: tm.venue_name, city: tm.venue_city, capacity: tm.venue_capacity, address: null, surface: null, image: null } : null },
    season: s, seasons,
    competitions: totals.map((x) => ({ league: lgs.get(x.league_id) ?? null, played: x.played, w: x.w, d: x.d, l: x.l, gf: x.gf, ga: x.ga, clean_sheets: x.clean_sheets, possession: x.possession == null ? null : Number(x.possession) }))
      .sort((a, b) => (a.league?.priority ?? 999) - (b.league?.priority ?? 999)),
    standings: standingRows.map((x) => ({ league: lgs.get(x.league_id) ?? null, group: x.group_name, rank: x.rank, points: x.points, played: x.played, win: x.win, draw: x.draw, lose: x.lose, gf: x.gf, ga: x.ga, gd: x.gd, form: x.form })),
    squad: [...squad.values()].map(({ _rw, ...r }) => r).sort((a, b) => posRank(a.player.position) - posRank(b.player.position) || b.minutes - a.minutes || (a.number ?? 99) - (b.number ?? 99)),
    coaches: coachRows.filter((c) => c.coach && !coachSeen.has(c.coach.id) && coachSeen.add(c.coach.id)).slice(0, 8)
      .map((c) => ({ id: c.coach.id, name: c.coach.display_name, photo: c.coach.photo ?? null, nationality: c.coach.nationality ?? null, birth_date: c.coach.birth_date ?? null, start: c.start === '1900-01-01' ? null : c.start, end: c.end ?? null, current: !c.end, ...honoursOf(c.coach.id) })),
    transfers: ((moves.data ?? []) as any[]).map((t) => ({ ...t, direction: t.to_team_id === tm.id ? 'in' : 'out',
      player: { name: people.get(t.player_id)?.display_name ?? t.player_name ?? 'Unknown', slug: people.get(t.player_id)?.slug ?? null },
      from_slug: clubSlugs.get(t.from_team_id)?.slug ?? null, to_slug: clubSlugs.get(t.to_team_id)?.slug ?? null })),
    injuries: ((hurt.data ?? []) as any[]).filter((h, i, all) => all.findIndex((x) => x.player_id === h.player_id) === i)
      .map((h) => ({ player: hurtPlayers.get(h.player_id) ? { name: hurtPlayers.get(h.player_id).display_name, slug: hurtPlayers.get(h.player_id).slug } : null, type: h.type, reason: h.reason, date: h.date })),
    goals_by_period: byPeriod,
    goals_by_period_source: detailRows.length ? 'provider' : 'events',
    season_detail: detailRows.map((x) => ({ league: lgs.get(x.league_id) ?? null, form: x.form, fixtures: x.fixtures, goals: x.goals, biggest: x.biggest, clean_sheet: x.clean_sheet, failed_to_score: x.failed_to_score, penalty: x.penalty, lineups: x.lineups ?? [], cards: x.cards }))
      .sort((a, b) => (a.league?.priority ?? 999) - (b.league?.priority ?? 999)),
    splits: { home: split(true), away: split(false) },
    results: games.filter((g) => g.status === 'final' || g.status === 'live').reverse(),
    fixtures: games.filter((g) => g.status === 'scheduled' && g.kickoff >= new Date().toISOString()),
    advanced: await teamAdvanced(db, tm.id, s),
  };
}

function chunkIds<T>(ids: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n)); return out; }

// ---------- players ----------
export async function player(db: Db, slug: string) {
  const { data: p, error } = await db.from('pro_players').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return null;
  const pl = p as any;
  const recentInjury = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  const [seasons, recent, links, moves, trophies, hurt, spells, missed] = await Promise.all([
    selectAll<any>(db, 'pro_player_season_stats', '*', (q) => q.eq('player_id', pl.id).order('season', { ascending: false })),
    db.from('pro_fixture_players').select(`fixture_id,team_id,starter,minutes,goals,assists,yellow,red,rating,saves,pos,fixture:pro_fixtures(${FIXTURE_SELECT})`).eq('player_id', pl.id).order('fixture_id', { ascending: false }).limit(120),
    db.from('pro_college_links').select('college_name,school_seo,college_player_id,first_season,last_season,confidence,verified,rejected,method,college:college_players(slug,display_name)').eq('pro_player_id', pl.id).eq('rejected', false),
    db.from('pro_transfers').select('date,type,from_team_id,from_name,from_logo,to_team_id,to_name,to_logo').eq('player_id', pl.id).order('date', { ascending: false }).limit(40),
    db.from('pro_trophies').select('league,country,season,place').eq('subject', 'player').eq('subject_id', pl.id).limit(200),
    db.from('pro_injuries').select('type,reason,date,team_id').eq('player_id', pl.id).gte('date', recentInjury).order('date', { ascending: false }).limit(1),
    db.from('pro_sidelined').select('type,start,end').eq('player_id', pl.id).order('start', { ascending: false }).limit(80),
    db.from('pro_injuries').select('date').eq('player_id', pl.id).eq('type', 'Missing Fixture').limit(1000),
  ]);
  // Matches missed in a spell: the provider's per-fixture absences that fall inside it (known for covered leagues).
  const missedDates = ((missed.data ?? []) as { date: string | null }[]).map((m) => m.date).filter(Boolean) as string[];
  const todayIso = new Date().toISOString().slice(0, 10);
  const injuryHistory = ((spells.data ?? []) as { type: string; start: string; end: string | null }[]).map((x) => {
    const n = missedDates.filter((d) => d >= x.start && d <= (x.end ?? todayIso)).length;
    return { type: x.type, start: x.start, end: x.end, days: Math.max(1, Math.round((Date.parse(x.end ?? todayIso) - Date.parse(x.start)) / 86400_000)), matches_missed: n || null };
  });
  const lgs = await leaguesById(db, seasons.map((s) => s.league_id));
  const teamIds = [...seasons.map((s) => s.team_id), ...(pl.current_team_id ? [pl.current_team_id] : [])];
  const teams = await teamsById(db, teamIds);
  const shown = ((links.data ?? []) as any[]).filter((l) => l.verified || Number(l.confidence) >= SHOW_AT);
  const matches = ((recent.data ?? []) as any[]).filter((r) => r.fixture).map((r) => ({ match: toMatchRow(r.fixture), team_id: r.team_id, starter: r.starter, minutes: r.minutes, goals: r.goals, assists: r.assists, yellow: r.yellow, red: r.red, rating: r.rating == null ? null : Number(r.rating), saves: r.saves, pos: r.pos }))
    // Fixture ids are not in date order: take a wide slice, then the latest by kickoff.
    .sort((a, b) => b.match.kickoff.localeCompare(a.match.kickoff)).slice(0, 25);
  const lastPlayed = matches[0] ? (matches[0].team_id === matches[0].match.home.id ? matches[0].match.home : matches[0].match.away) : null;
  const club = pl.current_team_id ? teams.get(pl.current_team_id) ?? null : lastPlayed ?? (seasons[0] ? teams.get(seasons[0].team_id) ?? null : null);
  // Percentiles for the latest club season with real minutes in a competition (not national-team games).
  const ranked = seasons.filter((s) => s.minutes >= 450 && !teams.get(s.team_id)?.national).sort((a, b) => b.season - a.season || b.minutes - a.minutes)[0];
  let percentiles: { stat: string; value: number; pct: number; peers: number }[] = [];
  if (ranked) {
    const { data } = await db.rpc('pro_player_percentiles', { p_player: pl.id, p_league: ranked.league_id, p_season: ranked.season });
    percentiles = ((data ?? []) as any[]).map((r) => ({ stat: r.stat, value: Number(r.value), pct: Number(r.pct), peers: Number(r.peers) }));
  }
  const injury = ((hurt.data ?? []) as any[])[0] ?? null;
  const moveClubs = await teamsById(db, ((moves.data ?? []) as any[]).flatMap((m) => [m.from_team_id, m.to_team_id]).filter((x) => x > 0));
  return {
    player: { id: pl.id, name: pl.display_name, slug: pl.slug, short_name: pl.name, first_name: pl.first_name, last_name: pl.last_name, birth_date: pl.birth_date, birth_place: pl.birth_place, birth_country: pl.birth_country, nationality: pl.nationality, height_cm: pl.height_cm, weight_kg: pl.weight_kg, position: pl.position, photo: pl.photo, gender: pl.gender, noindex: pl.noindex, number: pl.number ?? null, indexable: !!pl.indexable },
    team: club ? { id: club.id, name: club.name, slug: club.slug, logo: club.logo } : null,
    seasons: seasons.map((s) => ({ season: s.season, league: lgs.get(s.league_id) ?? null, team: teams.get(s.team_id) ?? null, source: s.source, position: s.position ?? null,
      apps: s.apps, starts: s.starts, minutes: s.minutes, goals: s.goals, assists: s.assists, shots: s.shots, shots_on: s.shots_on, key_passes: s.key_passes, passes: s.passes, pass_accuracy: s.pass_accuracy,
      tackles: s.tackles, interceptions: s.interceptions, duels_won: s.duels_won, dribbles_won: s.dribbles_won, yellow: s.yellow, red: s.red, saves: s.saves, conceded: s.conceded, clean_sheets: s.clean_sheets,
      rating: s.rating == null ? null : Number(s.rating) }))
      .sort((a, b) => b.season - a.season || (a.team?.national ? 1 : 0) - (b.team?.national ? 1 : 0) || (a.league?.priority ?? 999) - (b.league?.priority ?? 999)),
    percentiles: ranked ? { league: lgs.get(ranked.league_id) ?? null, season: ranked.season, rows: percentiles } : null,
    transfers: ((moves.data ?? []) as any[]).map((m) => ({ ...m, from_slug: moveClubs.get(m.from_team_id)?.slug ?? null, to_slug: moveClubs.get(m.to_team_id)?.slug ?? null })),
    trophies: ((trophies.data ?? []) as any[]).sort((a, b) => String(b.season).localeCompare(String(a.season))),
    injury: injury ? { type: injury.type, reason: injury.reason, date: injury.date } : null,
    injury_history: injuryHistory,
    advanced: await playerAdvanced(db, pl.id),
    matches,
    college: shown.map((l) => ({ college_name: l.college_name, school_seo: l.school_seo, first_season: l.first_season, last_season: l.last_season, college_player_slug: l.college?.slug ?? null, verified: l.verified })),
  };
}

/** For the college player page: "now plays for ...". */
export async function proCareerOfCollegePlayer(db: Db, collegePlayerId: string) {
  const { data } = await db.from('pro_college_links').select('confidence,verified,pro:pro_players(display_name,slug)').eq('college_player_id', collegePlayerId).eq('rejected', false);
  const link = ((data ?? []) as any[]).find((l) => l.verified || Number(l.confidence) >= SHOW_AT);
  if (!link?.pro) return null;
  return { name: link.pro.display_name as string, slug: link.pro.slug as string };
}

// ---------- matches ----------
export async function match(db: Db, slug: string) {
  const { data: f, error } = await db.from('pro_fixtures').select(FIXTURE_SELECT + ',referee,home_team_id,away_team_id,league_id').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!f) return null;
  const fx = f as any;
  const m = toMatchRow(fx);
  const [events, lineups, players, stats, h2h] = await Promise.all([
    selectAll<any>(db, 'pro_fixture_events', 'seq,minute,extra,team_id,player_id,player_name,assist_id,assist_name,type,detail,comments', (q) => q.eq('fixture_id', fx.id).order('seq')),
    selectAll<any>(db, 'pro_fixture_lineups', 'team_id,formation,coach_name', (q) => q.eq('fixture_id', fx.id)),
    selectAll<any>(db, 'pro_fixture_players', '*', (q) => q.eq('fixture_id', fx.id).order('slot')),
    selectAll<any>(db, 'pro_fixture_team_stats', '*', (q) => q.eq('fixture_id', fx.id)),
    db.from('pro_fixtures').select(FIXTURE_SELECT).eq('status', 'final').neq('id', fx.id)
      .or(`and(home_team_id.eq.${fx.home_team_id},away_team_id.eq.${fx.away_team_id}),and(home_team_id.eq.${fx.away_team_id},away_team_id.eq.${fx.home_team_id})`)
      .order('kickoff', { ascending: false }).limit(6),
  ]);
  const ids = [...new Set(players.map((p) => p.player_id).filter((x) => x != null))];
  const slugs = new Map((ids.length ? await selectAll<any>(db, 'pro_players', 'id,slug,display_name,photo,noindex', (q) => q.in('id', ids)) : []).map((p) => [p.id, p]));
  const side = (teamId: number) => {
    const lineup = lineups.find((l) => l.team_id === teamId) ?? null;
    const lines = players.filter((p) => p.team_id === teamId).map((p) => ({ ...p, rating: p.rating == null ? null : Number(p.rating), slug: p.player_id != null ? slugs.get(p.player_id)?.slug ?? null : null, display: p.player_id != null ? slugs.get(p.player_id)?.display_name ?? p.name : p.name, photo: p.player_id != null ? slugs.get(p.player_id)?.photo ?? null : null }));
    const st = stats.find((s) => s.team_id === teamId) ?? null;
    return { formation: lineup?.formation ?? null, coach: lineup?.coach_name ?? null, starters: lines.filter((l) => l.starter), bench: lines.filter((l) => !l.starter), stats: st ? { ...st, possession: st.possession == null ? null : Number(st.possession), pass_pct: st.pass_pct == null ? null : Number(st.pass_pct), xg: st.xg == null ? null : Number(st.xg) } : null };
  };
  return {
    match: { ...m, referee: fx.referee ?? null },
    events: events.map((e) => ({ ...e, side: e.team_id === fx.home_team_id ? 'home' : e.team_id === fx.away_team_id ? 'away' : null, player_slug: e.player_id != null ? slugs.get(e.player_id)?.slug ?? null : null })),
    home: side(fx.home_team_id), away: side(fx.away_team_id),
    h2h: ((h2h.data ?? []) as any[]).map(toMatchRow),
    advanced: await matchAdvanced(db, fx.id, fx.home_team_id),
  };
}

// ---------- search and slugs ----------
export async function search(db: Db, q: string, limit = 8) {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return { leagues: [], teams: [], players: [] };
  const { data, error } = await db.rpc('pro_search', { p_q: term, p_limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { kind: string; id: number; name: string; slug: string; sub: string | null; logo: string | null }[];
  const pick = (k: string) => rows.filter((r) => r.kind === k).map(({ kind: _k, ...r }) => r);
  return { leagues: pick('league'), teams: pick('team'), players: pick('player') };
}

export type ProKind = 'league' | 'team' | 'player' | 'match';
const TABLE: Record<ProKind, string> = { league: 'pro_leagues', team: 'pro_teams', player: 'pro_players', match: 'pro_fixtures' };

/** The current slug for an old one (pro_slug_redirects), or null. */
export async function renamedSlug(db: Db, kind: ProKind, slug: string): Promise<string | null> {
  const { data } = await db.from('pro_slug_redirects').select('target_id').eq('kind', kind).eq('slug', slug).maybeSingle();
  if (!data) return null;
  const { data: row } = await db.from(TABLE[kind]).select('slug').eq('id', (data as any).target_id).maybeSingle();
  return ((row as any)?.slug as string | undefined) ?? null;
}

// ---------- v2: leaders, directory, countries, compare, transfers, College to Pro ----------
export const LEADER_STATS = ['goals', 'assists', 'apps', 'minutes', 'starts', 'shots', 'shots_on', 'key_passes', 'passes', 'tackles', 'interceptions', 'duels_won', 'dribbles_won', 'blocks', 'fouls_drawn', 'saves', 'clean_sheets', 'yellow', 'red', 'rating', 'pen_scored'] as const;
export const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'] as const;

export interface LeadersFilter { stat?: string; league?: number | null; season?: number | null; position?: string | null; nationality?: string | null; min_age?: number | null; max_age?: number | null; min_minutes?: number | null; per90?: boolean; gender?: 'm' | 'w' | null; abroad?: string | null; limit?: number; offset?: number }

/** Leaders and the player directory (pro_leaders): one row per player, competition season and club. */
export async function leaders(db: Db, f: LeadersFilter) {
  const stat = (LEADER_STATS as readonly string[]).includes(f.stat ?? '') ? f.stat! : 'goals';
  const limit = Math.min(100, Math.max(1, f.limit ?? 50)), offset = Math.max(0, f.offset ?? 0);
  // Rates and ratings mean little on a handful of minutes: a floor unless one was asked for.
  const minMinutes = f.min_minutes ?? (f.per90 || stat === 'rating' ? 450 : 0);
  const { data, error } = await db.rpc('pro_leaders', {
    p_stat: stat, p_league: f.league ?? null, p_season: f.season ?? null, p_position: f.position ?? null, p_nationality: f.nationality ?? null,
    p_min_age: f.min_age ?? null, p_max_age: f.max_age ?? null, p_min_minutes: minMinutes, p_per90: !!f.per90, p_gender: f.gender ?? null, p_abroad: f.abroad ?? null,
    p_limit: limit, p_offset: offset,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const [teams, lgs] = await Promise.all([teamsById(db, rows.map((r) => r.team_id)), leaguesById(db, rows.map((r) => r.league_id))]);
  return {
    stat, per90: !!f.per90, min_minutes: minMinutes, total: rows.length ? Number(rows[0].total) : 0, limit, offset,
    rows: rows.map((r, i) => ({ rank: offset + i + 1, player: { id: r.player_id, name: r.name, slug: r.slug, photo: r.photo ?? null, nationality: r.nationality ?? null, birth_date: r.birth_date ?? null, position: r.pos ?? null },
      team: teams.get(r.team_id) ?? null, league: lgs.get(r.league_id) ?? null, season: r.season, apps: r.apps, minutes: r.minutes, goals: r.goals, assists: r.assists, rating: r.rating == null ? null : Number(r.rating), value: r.value == null ? null : Number(r.value) })),
  };
}

export async function countries(db: Db) {
  const [list, ls] = await Promise.all([
    selectAll<{ name: string; code: string | null; flag: string | null; slug: string }>(db, 'pro_countries', 'name,code,flag,slug', (q) => q.order('name')),
    selectAll<{ country: string | null }>(db, 'pro_leagues', 'country', (q) => q.eq('enabled', true)),
  ]);
  const counts = new Map<string, number>();
  for (const l of ls) if (l.country) counts.set(l.country, (counts.get(l.country) ?? 0) + 1);
  return list.map((c) => ({ ...c, leagues: counts.get(c.name) ?? 0 }));
}

export async function country(db: Db, slug: string) {
  const { data: c } = await db.from('pro_countries').select('name,code,flag,slug').eq('slug', slug).maybeSingle();
  if (!c) return null;
  const name = (c as any).name as string;
  const [leagueRows, clubs, home, abroad] = await Promise.all([
    selectAll<any>(db, 'pro_leagues', LEAGUE_COLS + ',priority,current_season', (q) => q.eq('enabled', true).eq('country', name).order('priority').order('name')),
    // Clubs that play in a competition we follow; a country's full club list (967 in the USA) is mostly amateur sides.
    selectAll<any>(db, 'pro_teams', TEAM_COLS + ',founded,venue_name,venue_city', (q) => q.eq('country', name).eq('national', false).not('profile_synced_at', 'is', null).order('display_name')),
    leaders(db, { stat: 'minutes', nationality: name, limit: 30 }),
    leaders(db, { stat: 'minutes', nationality: name, abroad: name, limit: 30 }),
  ]);
  const active = new Set((await selectAll<{ team_id: number }>(db, 'pro_league_teams', 'team_id', (q) => q.in('league_id', leagueRows.map((l) => l.id).concat([-1])))).map((r) => r.team_id));
  return {
    country: c as { name: string; code: string | null; flag: string | null; slug: string },
    leagues: leagueRows.map((l) => ({ ...leagueRef(l), priority: l.priority, current_season: l.current_season })),
    clubs: clubs.filter((t) => active.has(t.id)).map((t) => ({ ...teamRef(t), founded: t.founded ?? null, venue: t.venue_name ?? null })),
    players: home.rows, abroad: abroad.rows,
  };
}

export async function compare(db: Db, a: string, b: string) {
  const [pa, pb] = await Promise.all([player(db, a), player(db, b)]);
  return pa && pb ? { a: pa, b: pb } : null;
}

export async function transfersFeed(db: Db, o: { limit?: number; offset?: number; team?: number | null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const limit = Math.min(100, o.limit ?? 50), offset = o.offset ?? 0;
  let q = db.from('pro_transfers').select('player_id,player_name,date,type,from_team_id,from_name,from_logo,to_team_id,to_name,to_logo').lte('date', today);
  if (o.team) q = q.or(`to_team_id.eq.${o.team},from_team_id.eq.${o.team}`);
  const { data, error } = await q.order('date', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const ids = [...new Set(rows.map((r) => r.player_id))];
  const ppl = new Map((ids.length ? await selectAll<any>(db, 'pro_players', 'id,display_name,slug,photo,nationality,position', (q2) => q2.in('id', ids)) : []).map((p) => [p.id, p]));
  const teamSlugs = new Map((await teamsById(db, rows.flatMap((r) => [r.from_team_id, r.to_team_id]).filter((x) => x > 0))).entries());
  return rows.map((r) => {
    const p = ppl.get(r.player_id);
    return { date: r.date, type: r.type, player: { id: r.player_id, name: p?.display_name ?? r.player_name, slug: p?.slug ?? null, photo: p?.photo ?? null, nationality: p?.nationality ?? null, position: p?.position ?? null },
      from: { id: r.from_team_id, name: r.from_name, logo: r.from_logo, slug: teamSlugs.get(r.from_team_id)?.slug ?? null }, to: { id: r.to_team_id, name: r.to_name, logo: r.to_logo, slug: teamSlugs.get(r.to_team_id)?.slug ?? null } };
  });
}

/** College to Pro: every confident link, by school. */
export async function collegeHub(db: Db, o: { gender?: 'm' | 'w' | null } = {}) {
  const links = await selectAll<any>(db, 'pro_college_links', 'pro_player_id,college_name,school_seo,first_season,last_season,confidence,verified', (q) => q.eq('rejected', false));
  const shown = links.filter((l) => l.verified || Number(l.confidence) >= SHOW_AT);
  const ids = [...new Set(shown.map((l) => l.pro_player_id))];
  const ppl = new Map((ids.length ? await selectAll<any>(db, 'pro_players', 'id,display_name,slug,photo,nationality,position,gender,current_team_id,minutes_recent,birth_date', (q) => q.in('id', ids)) : []).map((p) => [p.id, p]));
  const teams = await teamsById(db, [...ppl.values()].map((p) => p.current_team_id).filter(Boolean));
  const schools = new Map((await selectAll<any>(db, 'college_schools', 'seo,name,logo_svg_url', (q) => q.in('seo', [...new Set(shown.map((l) => l.school_seo).filter(Boolean))].concat(['-'])))).map((s) => [s.seo, s]));
  const bySchool = new Map<string, { school: { seo: string | null; name: string; logo: string | null }; players: any[] }>();
  for (const l of shown) {
    const p = ppl.get(l.pro_player_id);
    if (!p || (o.gender && p.gender && p.gender !== o.gender)) continue;
    const key = l.school_seo ?? l.college_name;
    const sc = l.school_seo ? schools.get(l.school_seo) : null;
    const g = bySchool.get(key) ?? { school: { seo: l.school_seo ?? null, name: sc?.name ?? l.college_name, logo: sc?.logo_svg_url ?? null }, players: [] as any[] };
    g.players.push({ id: p.id, name: p.display_name, slug: p.slug, photo: p.photo ?? null, nationality: p.nationality ?? null, position: p.position ?? null, gender: p.gender ?? null, birth_date: p.birth_date ?? null, minutes_recent: p.minutes_recent ?? 0,
      team: p.current_team_id ? teams.get(p.current_team_id) ?? null : null, college_years: [l.first_season, l.last_season].filter(Boolean) });
    bySchool.set(key, g);
  }
  const groups = [...bySchool.values()].map((g) => ({ ...g, players: g.players.sort((a, b) => b.minutes_recent - a.minutes_recent) })).sort((a, b) => b.players.length - a.players.length || a.school.name.localeCompare(b.school.name));
  return { total: groups.reduce((n, g) => n + g.players.length, 0), schools: groups.length, groups };
}

/** A college team page's pro alumni (by school, the gender of the program). */
export async function collegeAlumni(db: Db, schoolSeo: string, gender: 'm' | 'w') {
  const hub = await collegeHub(db, { gender });
  return hub.groups.find((g) => g.school.seo === schoolSeo)?.players ?? [];
}
