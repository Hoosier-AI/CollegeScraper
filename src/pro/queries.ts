// Reads for Plaibook Stats Pro: the site's /api/pro/* routes and the server-rendered /pro pages use the same functions,
// so what a crawler reads and what a visitor sees cannot drift apart. Service-role reads of the pro_* tables.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { SHOW_AT } from '../jobs/pro/collegeMatch.js';

// ---------- shapes ----------
export interface ProLeagueRef { id: number; name: string; slug: string; logo: string | null; country: string | null; country_flag?: string | null; gender: 'm' | 'w'; type?: 'league' | 'cup' }
export interface ProTeamRef { id: number; name: string; slug: string; logo: string | null; country?: string | null; gender?: 'm' | 'w' | null }
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

const TEAM_COLS = 'id,display_name,slug,logo,country,gender';
const LEAGUE_COLS = 'id,name,slug,logo,country,country_flag,gender,type';
export const FIXTURE_SELECT = `id,slug,kickoff,status,status_short,elapsed,elapsed_extra,round,season,home_goals,away_goals,ht_home,ht_away,et_home,et_away,pen_home,pen_away,winner,venue_name,venue_city,detail_fetched_at,
league:pro_leagues!pro_fixtures_league_id_fkey(${LEAGUE_COLS}),
home:pro_teams!pro_fixtures_home_team_id_fkey(${TEAM_COLS}),
away:pro_teams!pro_fixtures_away_team_id_fkey(${TEAM_COLS})`;

const teamRef = (t: any): ProTeamRef => ({ id: t?.id, name: t?.display_name ?? 'TBD', slug: t?.slug ?? '', logo: t?.logo ?? null, country: t?.country ?? null, gender: t?.gender ?? null });
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

async function teamsById(db: Db, ids: number[]): Promise<Map<number, ProTeamRef>> {
  const uniq = [...new Set(ids.filter((n) => Number.isFinite(n)))];
  if (!uniq.length) return new Map();
  const rows = await selectAll<any>(db, 'pro_teams', TEAM_COLS, (q) => q.in('id', uniq));
  return new Map(rows.map((t) => [t.id, teamRef(t)]));
}

async function leaguesById(db: Db, ids: number[]): Promise<Map<number, ProLeagueRef & { priority: number }>> {
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
  const seasons = (await selectAll<{ season: number; starts_on: string | null; ends_on: string | null; backfilled_at: string | null; fixtures_synced_at: string | null }>(db, 'pro_seasons', 'season,starts_on,ends_on,backfilled_at,fixtures_synced_at', (q) => q.eq('league_id', lg.id).order('season', { ascending: false })));
  const s = season ?? lg.current_season ?? seasons[0]?.season ?? null;
  if (s == null) return { league: { ...leagueRef(lg), enabled: lg.enabled as boolean, current_season: (lg.current_season ?? null) as number | null }, season: null, seasons: [] as number[], standings: [] as ProStandingGroup[], results: [] as ProMatchRow[], fixtures: [] as ProMatchRow[], scorers: [] as ProLeaderRow[], assists: [] as ProLeaderRow[], teams: 0 };
  const now = new Date().toISOString();
  const [standings, results, fixtures, scorers, assisters, teamCount] = await Promise.all([
    standingsFor(db, lg.id, s),
    db.from('pro_fixtures').select(FIXTURE_SELECT).eq('league_id', lg.id).eq('season', s).in('status', ['final', 'live']).order('kickoff', { ascending: false }).limit(30),
    db.from('pro_fixtures').select(FIXTURE_SELECT).eq('league_id', lg.id).eq('season', s).eq('status', 'scheduled').gte('kickoff', now).order('kickoff').limit(30),
    leadersFor(db, lg.id, s, 'goals'),
    leadersFor(db, lg.id, s, 'assists'),
    db.from('pro_team_season_stats').select('team_id', { count: 'exact', head: true }).eq('league_id', lg.id).eq('season', s),
  ]);
  return {
    league: { ...leagueRef(lg), enabled: lg.enabled as boolean, current_season: (lg.current_season ?? null) as number | null }, season: s as number | null,
    seasons: seasons.filter((x) => x.fixtures_synced_at || x.season === lg.current_season).map((x) => x.season),
    standings, results: ((results.data ?? []) as any[]).map(toMatchRow), fixtures: ((fixtures.data ?? []) as any[]).map(toMatchRow),
    scorers, assists: assisters, teams: teamCount.count ?? 0,
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
  const [squadRows, totals, standingRows] = await Promise.all([
    s == null ? [] : selectAll<any>(db, 'pro_player_season_stats', 'player_id,league_id,apps,starts,minutes,goals,assists,yellow,red,saves,conceded,clean_sheets,rating,player:pro_players(id,display_name,slug,photo,position,nationality,birth_date)', (q) => q.eq('team_id', tm.id).eq('season', s)),
    s == null ? [] : selectAll<any>(db, 'pro_team_season_stats', '*', (q) => q.eq('team_id', tm.id).eq('season', s)),
    s == null ? [] : selectAll<any>(db, 'pro_standings', 'league_id,group_name,rank,points,played,win,draw,lose,gf,ga,gd,form', (q) => q.eq('team_id', tm.id).eq('season', s)),
  ]);
  const lgs = await leaguesById(db, [...totals.map((x) => x.league_id), ...games.map((g) => g.league.id), ...standingRows.map((x) => x.league_id)]);
  // One squad line per player across this season's competitions.
  const squad = new Map<number, any>();
  for (const r of squadRows) {
    const prev = squad.get(r.player_id);
    const add = (a: number | null | undefined, b: number | null | undefined) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
    if (!prev) { squad.set(r.player_id, { player: { id: r.player?.id, name: r.player?.display_name, slug: r.player?.slug, photo: r.player?.photo ?? null, position: r.player?.position ?? null, nationality: r.player?.nationality ?? null, birth_date: r.player?.birth_date ?? null }, apps: r.apps, starts: r.starts, minutes: r.minutes, goals: r.goals, assists: r.assists, yellow: r.yellow, red: r.red, saves: r.saves, conceded: r.conceded, clean_sheets: r.clean_sheets, rating: r.rating == null ? null : Number(r.rating), _rw: (Number(r.rating) || 0) * r.apps }); continue; }
    for (const k of ['apps', 'starts', 'minutes', 'goals', 'assists', 'yellow', 'red']) prev[k] = (prev[k] ?? 0) + (r[k] ?? 0);
    for (const k of ['saves', 'conceded', 'clean_sheets']) prev[k] = add(prev[k], r[k]);
    prev._rw += (Number(r.rating) || 0) * r.apps;
    prev.rating = prev.apps ? Math.round((prev._rw / prev.apps) * 100) / 100 : null;
  }
  const order = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'];
  const posRank = (pos: string | null) => { const i = order.indexOf(pos ?? ''); return i < 0 ? order.length : i; };
  return {
    team: { ...teamRef(tm), founded: tm.founded, national: tm.national, venue: tm.venue_name ? { name: tm.venue_name, city: tm.venue_city, capacity: tm.venue_capacity } : null },
    season: s, seasons,
    competitions: totals.map((x) => ({ league: lgs.get(x.league_id) ?? null, played: x.played, w: x.w, d: x.d, l: x.l, gf: x.gf, ga: x.ga, clean_sheets: x.clean_sheets, possession: x.possession == null ? null : Number(x.possession) }))
      .sort((a, b) => (a.league?.priority ?? 999) - (b.league?.priority ?? 999)),
    standings: standingRows.map((x) => ({ league: lgs.get(x.league_id) ?? null, group: x.group_name, rank: x.rank, points: x.points, played: x.played, win: x.win, draw: x.draw, lose: x.lose, gf: x.gf, ga: x.ga, gd: x.gd, form: x.form })),
    squad: [...squad.values()].map(({ _rw, ...r }) => r).sort((a, b) => posRank(a.player.position) - posRank(b.player.position) || b.minutes - a.minutes),
    results: games.filter((g) => g.status === 'final' || g.status === 'live').reverse(),
    fixtures: games.filter((g) => g.status === 'scheduled' && g.kickoff >= new Date().toISOString()),
  };
}

// ---------- players ----------
export async function player(db: Db, slug: string) {
  const { data: p, error } = await db.from('pro_players').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return null;
  const pl = p as any;
  const [seasons, recent, links] = await Promise.all([
    selectAll<any>(db, 'pro_player_season_stats', '*', (q) => q.eq('player_id', pl.id).order('season', { ascending: false })),
    db.from('pro_fixture_players').select(`fixture_id,team_id,starter,minutes,goals,assists,yellow,red,rating,saves,pos,fixture:pro_fixtures(${FIXTURE_SELECT})`).eq('player_id', pl.id).order('fixture_id', { ascending: false }).limit(25),
    db.from('pro_college_links').select('college_name,school_seo,college_player_id,first_season,last_season,confidence,verified,rejected,method,college:college_players(slug,display_name)').eq('pro_player_id', pl.id).eq('rejected', false),
  ]);
  const lgs = await leaguesById(db, seasons.map((s) => s.league_id));
  const teams = await teamsById(db, seasons.map((s) => s.team_id));
  const shown = ((links.data ?? []) as any[]).filter((l) => l.verified || Number(l.confidence) >= SHOW_AT);
  const matches = ((recent.data ?? []) as any[]).filter((r) => r.fixture).map((r) => ({ match: toMatchRow(r.fixture), team_id: r.team_id, starter: r.starter, minutes: r.minutes, goals: r.goals, assists: r.assists, yellow: r.yellow, red: r.red, rating: r.rating == null ? null : Number(r.rating), saves: r.saves, pos: r.pos }))
    .sort((a, b) => b.match.kickoff.localeCompare(a.match.kickoff));
  const latestTeam = matches[0] ? (matches[0].team_id === matches[0].match.home.id ? matches[0].match.home : matches[0].match.away) : (seasons[0] ? teams.get(seasons[0].team_id) ?? null : null);
  return {
    player: { id: pl.id, name: pl.display_name, slug: pl.slug, short_name: pl.name, first_name: pl.first_name, last_name: pl.last_name, birth_date: pl.birth_date, birth_place: pl.birth_place, birth_country: pl.birth_country, nationality: pl.nationality, height_cm: pl.height_cm, weight_kg: pl.weight_kg, position: pl.position, photo: pl.photo, gender: pl.gender, noindex: pl.noindex },
    team: latestTeam ? { id: latestTeam.id, name: latestTeam.name, slug: latestTeam.slug, logo: latestTeam.logo } : null,
    seasons: seasons.map((s) => ({ season: s.season, league: lgs.get(s.league_id) ?? null, team: teams.get(s.team_id) ?? null, apps: s.apps, starts: s.starts, minutes: s.minutes, goals: s.goals, assists: s.assists, shots: s.shots, shots_on: s.shots_on, key_passes: s.key_passes, tackles: s.tackles, yellow: s.yellow, red: s.red, saves: s.saves, conceded: s.conceded, clean_sheets: s.clean_sheets, rating: s.rating == null ? null : Number(s.rating) })),
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
