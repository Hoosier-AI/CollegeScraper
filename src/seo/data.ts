// SeoData over the Supabase database: small, purpose-built reads (lighter than the viewer's /api queries, which
// carry admin fields and raw payloads). Suppressed players never reach a page model: rosters drop them, box
// scores and events withhold their names, their profiles are 404. Needs migration 129 (slugs, noindex).
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { firstLast, goalMinute, kickoffTbd } from '../ui/queries.js';
import type { BoxLine, ConferencePage, ConferenceRef, EntityKind, Gender, HomePage, MatchEvent, MatchPage, PlayerPage, Poll, RankingsPage, SeoData, SitemapEntry, StandingRow, TeamLine, TeamPage, TeamRef, TeamsIndexPage } from './types.js';
import { classLabel, conferencePath, displayName, playerPath, matchPath, teamPath } from './util.js';

/** Fall season in progress: July starts the next one (same rule as /api/meta). */
export function seasonFor(now = new Date()): number {
  return now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const teamRef = (p: any): TeamRef | null => (p?.school_seo ? { name: p.name, school_seo: p.school_seo, gender: p.gender === 'w' ? 'w' : 'm' } : null);
const confRef = (c: any): ConferenceRef | null => (c?.ncaa_seo ? { name: c.name, seo: c.ncaa_seo, short_name: c.short_name ?? null, division: c.division ?? null } : null);
const one = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T | null> => {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
const chunks = <T>(xs: T[], n = 100): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

async function selectIn<T>(db: Db, table: string, cols: string, column: string, ids: string[], apply?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (const c of chunks([...new Set(ids)])) out.push(...await selectAll<T>(db, table, cols, (q) => { q = q.in(column, c); return apply ? apply(q) : q; }));
  return out;
}

/** A slice [offset, offset + limit) of an ordered query, paged 1000 rows at a time (PostgREST's cap). */
async function selectRange<T>(build: () => any, offset: number, limit: number, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = offset; from < offset + limit; from += 1000) {
    const to = Math.min(from + 999, offset + limit - 1);
    const { data, error } = await build().range(from, to);
    if (error) throw new Error(`${what}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < to - from + 1) break;
  }
  return out;
}

export class DbSeoData implements SeoData {
  constructor(private db: Db, private now: () => Date = () => new Date()) {}

  currentSeason(): number { return seasonFor(this.now()); }

  // ---------- team ----------
  async team(school: string, gender: Gender, season: number | null): Promise<TeamPage | null> {
    const db = this.db;
    const p = await one<any>(db.from('college_programs').select('id,name,gender,school_seo,updated_at,college_schools(name,long_name,logo_svg_url,athletics_url)').eq('school_seo', school).eq('gender', gender).maybeSingle(), 'program');
    if (!p) return null;
    const seasonRows = await selectAll<any>(db, 'college_program_seasons', 'season,division,ncaa_member,conference_id,college_conferences(name,ncaa_seo,short_name,division)', (q) => q.eq('program_id', p.id).order('season', { ascending: false }));
    const current = this.currentSeason();
    const s = season ?? (seasonRows.some((r) => r.season === current) || !seasonRows.length ? current : seasonRows[0].season);
    const ps = seasonRows.find((r) => r.season === s) ?? null;
    const [coaches, tss, standing, polls, rosterRows, games] = await Promise.all([
      selectAll<any>(db, 'college_coach_seasons', 'title,is_head,college_coaches(name)', (q) => q.eq('program_id', p.id).eq('season', s)),
      one<any>(db.from('college_team_season_stats').select('w,l,t,gf,ga,conf_w,conf_l,conf_t,computed_at').eq('program_id', p.id).eq('season', s).maybeSingle(), 'team stats'),
      one<any>(db.from('college_standings').select('rank,pod,conf_pts').eq('program_id', p.id).eq('season', s).maybeSingle(), 'standing'),
      db.from('college_rankings').select('rank,label,week_of').eq('program_id', p.id).eq('season', s).eq('poll', 'usc').order('week_of', { ascending: false }).limit(10),
      selectAll<any>(db, 'college_player_seasons', 'id,jersey,position,class_raw,class_year,is_redshirt,college_players!inner(display_name,slug,suppress)', (q) => q.eq('program_id', p.id).eq('season', s).eq('college_players.suppress', false)),
      selectAll<any>(db, 'college_games', 'id,slug,game_date,status,home_program_id,away_program_id,home_name,away_name,home_score,away_score,neutral_site,overtime', (q) => q.eq('season', s).or(`home_program_id.eq.${p.id},away_program_id.eq.${p.id}`).order('game_date')),
    ]);
    const stats = new Map((await selectIn<any>(db, 'college_player_season_stats', 'player_season_id,gp,gs,minutes,goals,assists,points,saves,ga,shutouts', 'player_season_id', rosterRows.map((r) => r.id))).map((x) => [x.player_season_id, x]));
    const oppIds = games.flatMap((g) => [g.home_program_id, g.away_program_id]).filter((x) => x && x !== p.id);
    const opps = new Map((await selectIn<any>(db, 'college_programs', 'id,name,gender,school_seo', 'id', oppIds)).map((x) => [x.id, x]));
    const poll = ((polls as any).data ?? []).find((r: any) => !String(r.label ?? '').includes('(RV)')) ?? null;
    return {
      id: p.id, name: p.name, school_name: p.college_schools?.name ?? null, school_long_name: p.college_schools?.long_name ?? null, school_seo: p.school_seo, gender: p.gender,
      season: s, seasons: seasonRows.map((r) => r.season), member: ps ? ps.ncaa_member !== false : false,
      division: ps?.division ?? null, conference: confRef(ps?.college_conferences),
      logo: p.college_schools?.logo_svg_url ?? null, athletics_url: p.college_schools?.athletics_url ?? null,
      coaches: coaches.filter((c) => c.college_coaches?.name).map((c) => ({ name: c.college_coaches.name, title: c.title ?? null, is_head: !!c.is_head })).sort((a, b) => Number(b.is_head) - Number(a.is_head)),
      record: tss ? { w: tss.w ?? 0, l: tss.l ?? 0, t: tss.t ?? 0, gf: num(tss.gf), ga: num(tss.ga), conf: ps?.conference_id ? { w: tss.conf_w ?? 0, l: tss.conf_l ?? 0, t: tss.conf_t ?? 0 } : null } : null,
      standing: standing ? { rank: num(standing.rank), pod: standing.pod ?? null, conf_pts: num(standing.conf_pts) } : null,
      poll: poll ? { rank: poll.rank, label: poll.label ?? null } : null,
      roster: rosterRows.map((r) => {
        const st = stats.get(r.id);
        return { name: displayName(r.college_players.display_name), slug: r.college_players.slug ?? null, jersey: num(r.jersey), position: r.position ?? null, class_label: classLabel(r.class_raw, r.class_year, r.is_redshirt),
          gp: num(st?.gp), gs: num(st?.gs), minutes: num(st?.minutes), goals: num(st?.goals), assists: num(st?.assists), points: num(st?.points), saves: num(st?.saves), ga: num(st?.ga), shutouts: num(st?.shutouts) };
      }).sort((a, b) => (a.jersey ?? 999) - (b.jersey ?? 999) || a.name.localeCompare(b.name)),
      games: games.map((g) => {
        const home = g.home_program_id === p.id;
        const oppId = home ? g.away_program_id : g.home_program_id;
        const opp = oppId ? opps.get(oppId) : null;
        return { slug: g.slug ?? null, date: g.game_date, status: g.status, home, neutral: !!g.neutral_site, overtime: !!g.overtime,
          opponent: opp?.name ?? (home ? g.away_name : g.home_name) ?? 'TBD', opponent_team: teamRef(opp),
          score_for: num(home ? g.home_score : g.away_score), score_against: num(home ? g.away_score : g.home_score) };
      }),
      updated_at: tss?.computed_at ?? p.updated_at ?? null,
    };
  }

  async teamKeyById(id: string) {
    const p = await one<any>(this.db.from('college_programs').select('school_seo,gender').eq('id', id).maybeSingle(), 'program');
    return p ? { school_seo: p.school_seo as string, gender: (p.gender === 'w' ? 'w' : 'm') as Gender } : null;
  }

  // ---------- player ----------
  async player(slug: string): Promise<PlayerPage | null> {
    const db = this.db;
    const p = await one<any>(db.from('college_players').select('id,slug,display_name,noindex,suppress,headshot_url,hometown_city,hometown_region,hometown_country,high_school,updated_at').eq('slug', slug).maybeSingle(), 'player');
    if (!p || p.suppress) return null;
    const seasons = await selectAll<any>(db, 'college_player_seasons', 'id,season,jersey,position,class_raw,class_year,is_redshirt,hometown_raw,high_school,college_programs(name,gender,school_seo)', (q) => q.eq('player_id', p.id).order('season', { ascending: false }));
    const ids = seasons.map((s) => s.id);
    const [stats, honors] = await Promise.all([
      selectIn<any>(db, 'college_player_season_stats', 'player_season_id,gp,gs,minutes,goals,assists,points,shots,sog,saves,ga,gaa,save_pct,shutouts', 'player_season_id', ids),
      selectIn<any>(db, 'college_player_honors', 'player_season_id,text', 'player_season_id', ids),
    ]);
    const st = new Map(stats.map((x) => [x.player_season_id, x]));
    const order = new Map(ids.map((id, i) => [id, i]));
    const seen = new Set<string>();
    const honorList = honors.sort((a, b) => (order.get(a.player_season_id) ?? 0) - (order.get(b.player_season_id) ?? 0))
      .map((h) => String(h.text)).filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    const latest = seasons[0];
    const hometown = latest?.hometown_raw || [p.hometown_city, p.hometown_region, p.hometown_country].filter(Boolean).join(', ') || null;
    return {
      id: p.id, slug: p.slug, name: displayName(p.display_name), noindex: !!p.noindex,
      headshot_url: p.headshot_url ?? null, hometown, high_school: latest?.high_school ?? p.high_school ?? null,
      seasons: seasons.filter((s) => teamRef(s.college_programs)).map((s) => {
        const x = st.get(s.id);
        return { season: s.season, team: teamRef(s.college_programs)!, jersey: num(s.jersey), position: s.position ?? null, class_label: classLabel(s.class_raw, s.class_year, s.is_redshirt),
          gp: num(x?.gp), gs: num(x?.gs), minutes: num(x?.minutes), goals: num(x?.goals), assists: num(x?.assists), points: num(x?.points), shots: num(x?.shots), sog: num(x?.sog),
          saves: num(x?.saves), ga: num(x?.ga), gaa: num(x?.gaa), save_pct: num(x?.save_pct), shutouts: num(x?.shutouts) };
      }),
      honors: honorList, updated_at: p.updated_at ?? null,
    };
  }

  async playerSlugById(id: string) {
    const p = await one<any>(this.db.from('college_players').select('slug,suppress').eq('id', id).maybeSingle(), 'player');
    return p && !p.suppress && p.slug ? (p.slug as string) : null;
  }

  // ---------- match ----------
  async match(slug: string): Promise<MatchPage | null> {
    const db = this.db;
    const g = await one<any>(db.from('college_games').select('id,slug,season,game_date,start_epoch,gender,division,status,home_program_id,away_program_id,home_name,away_name,home_score,away_score,overtime,shootout,neutral_site,conference_game,postseason,tournament,venue_name,venue_city,attendance,source_of_truth,updated_at').eq('slug', slug).maybeSingle(), 'game');
    if (!g) return null;
    const sideIds = [g.home_program_id, g.away_program_id].filter(Boolean) as string[];
    const [programs, confs, team, lines, events] = await Promise.all([
      sideIds.length ? selectIn<any>(db, 'college_programs', 'id,name,gender,school_seo', 'id', sideIds) : [],
      sideIds.length ? selectAll<any>(db, 'college_program_seasons', 'program_id,college_conferences(name)', (q) => q.eq('season', g.season).in('program_id', sideIds)) : [],
      selectAll<any>(db, 'college_game_team_stats', 'program_id,source,is_home,shots,shots_on_goal,corners,fouls,saves,yellow_cards,red_cards', (q) => q.eq('game_id', g.id)),
      selectAll<any>(db, 'college_game_player_stats', 'program_id,source,player_season_id,first_name,last_name,jersey,position,starter,participated,minutes,goals,assists,shots,saves,is_goalie,college_player_seasons(college_players(slug,suppress))', (q) => q.eq('game_id', g.id)),
      selectAll<any>(db, 'college_game_events', 'source,period,clock,seq,event_type,program_id,player_season_id,player_name_raw,assist_player_season_id,assist_name_raw', (q) => q.eq('game_id', g.id).in('event_type', ['goal', 'yellow', 'red']).order('period').order('seq')),
    ]);
    const prog = new Map(programs.map((x) => [x.id, x]));
    const confOf = new Map(confs.map((x) => [x.program_id, x.college_conferences?.name ?? null]));
    const src: string = g.source_of_truth ?? (lines.some((l) => l.source === 'site') ? 'site' : 'ncaa');
    const hidden = new Set(lines.filter((l) => l.college_player_seasons?.college_players?.suppress && l.player_season_id).map((l) => l.player_season_id));
    const side = (home: boolean) => {
      const id = home ? g.home_program_id : g.away_program_id;
      const p = id ? prog.get(id) : null;
      return { name: p?.name ?? (home ? g.home_name : g.away_name) ?? 'TBD', team: teamRef(p), score: num(home ? g.home_score : g.away_score), conference: id ? confOf.get(id) ?? null : null };
    };
    const teamLine = (home: boolean): TeamLine | null => {
      const t = team.find((x) => x.source === src && x.is_home === home) ?? null;
      return t ? { shots: num(t.shots), sog: num(t.shots_on_goal), corners: num(t.corners), fouls: num(t.fouls), saves: num(t.saves), yc: num(t.yellow_cards), rc: num(t.red_cards) } : null;
    };
    const box = (pid: string | null): BoxLine[] => (pid ? lines.filter((l) => l.source === src && l.program_id === pid && l.participated !== false) : [])
      .map((l) => {
        const withheld = !!l.college_player_seasons?.college_players?.suppress;
        return { name: withheld ? 'Name withheld' : displayName(`${l.first_name ?? ''} ${l.last_name ?? ''}`) || 'Unknown', slug: withheld ? null : l.college_player_seasons?.college_players?.slug ?? null,
          jersey: num(l.jersey), position: l.position ?? null, starter: !!l.starter, minutes: num(l.minutes), goals: num(l.goals), assists: num(l.assists), shots: num(l.shots), saves: num(l.saves), is_goalie: !!l.is_goalie };
      })
      .sort((a, b) => Number(b.starter) - Number(a.starter) || (a.jersey ?? 999) - (b.jersey ?? 999));
    const evSrc = events.some((e) => e.source === src) ? src : events[0]?.source;
    const evs: MatchEvent[] = events.filter((e) => e.source === evSrc).map((e) => ({
      minute: goalMinute(e.clock, e.period),
      side: e.program_id ? (e.program_id === g.home_program_id ? 'home' : e.program_id === g.away_program_id ? 'away' : null) : null,
      type: e.event_type,
      player: e.player_season_id && hidden.has(e.player_season_id) ? 'Name withheld' : (firstLast(e.player_name_raw) && displayName(firstLast(e.player_name_raw))),
      assist: e.assist_player_season_id && hidden.has(e.assist_player_season_id) ? 'Name withheld' : (firstLast(e.assist_name_raw) && displayName(firstLast(e.assist_name_raw))),
    }));
    return {
      id: g.id, slug: g.slug, season: g.season, date: g.game_date, start_epoch: num(g.start_epoch), kickoff_tbd: kickoffTbd(g.start_epoch),
      gender: g.gender === 'w' ? 'w' : 'm', division: g.division ?? null, status: g.status,
      home: side(true), away: side(false),
      overtime: !!g.overtime, shootout: !!g.shootout, neutral_site: !!g.neutral_site, conference_game: !!g.conference_game, postseason: !!g.postseason, tournament: g.tournament ?? null,
      venue_name: g.venue_name ?? null, venue_city: g.venue_city ?? null, attendance: num(g.attendance),
      events: evs, team_stats: { home: teamLine(true), away: teamLine(false) },
      players: { home: box(g.home_program_id), away: box(g.away_program_id) },
      updated_at: g.updated_at ?? null,
    };
  }

  async matchSlugById(id: string) {
    const g = await one<any>(this.db.from('college_games').select('slug').eq('id', id).maybeSingle(), 'game');
    return g?.slug ?? null;
  }

  async renamedSlug(kind: 'player' | 'game', slug: string) {
    const r = await one<any>(this.db.from('college_slug_redirects').select('target_id').eq('kind', kind).eq('slug', slug).maybeSingle(), 'slug redirect');
    if (!r) return null;
    return kind === 'player' ? this.playerSlugById(r.target_id) : this.matchSlugById(r.target_id);
  }

  // ---------- conference ----------
  async conference(seo: string, season: number): Promise<ConferencePage | null> {
    const db = this.db;
    const c = await one<any>(db.from('college_conferences').select('id,ncaa_seo,name,short_name,division').eq('ncaa_seo', seo).maybeSingle(), 'conference');
    if (!c) return null;
    const [rows, members] = await Promise.all([
      selectAll<any>(db, 'college_standings', 'rank,pod,source,conf_w,conf_l,conf_t,conf_pts,overall_w,overall_l,overall_t,gf,ga,college_programs!inner(name,gender,school_seo)', (q) => q.eq('season', season).eq('conference_id', c.id)),
      selectAll<any>(db, 'college_program_seasons', 'college_programs!inner(name,gender,school_seo)', (q) => q.eq('season', season).eq('conference_id', c.id).eq('ncaa_member', true)),
    ]);
    const tables = (['m', 'w'] as const).map((gender) => {
      const mine = rows.filter((r) => r.college_programs?.gender === gender);
      const standing: StandingRow[] = mine.map((r) => ({
        rank: num(r.rank), pod: r.pod ?? null, team: teamRef(r.college_programs)!, conf: { w: r.conf_w ?? 0, l: r.conf_l ?? 0, t: r.conf_t ?? 0 }, conf_pts: num(r.conf_pts),
        overall: r.overall_w != null ? { w: r.overall_w, l: r.overall_l ?? 0, t: r.overall_t ?? 0 } : null, gf: num(r.gf), ga: num(r.ga),
      })).sort((a, b) => (a.pod ?? '').localeCompare(b.pod ?? '') || (a.rank ?? 99) - (b.rank ?? 99));
      const mem = members.map((m) => teamRef(m.college_programs)).filter((t): t is TeamRef => !!t && t.gender === gender).sort((a, b) => a.name.localeCompare(b.name));
      return { gender, source: mine.some((r) => r.source === 'conference') ? 'conference' : mine.length ? 'computed' : 'none', rows: standing, members: mem };
    }).filter((t) => t.rows.length || t.members.length);
    return { id: c.id, seo: c.ncaa_seo, name: c.name, short_name: c.short_name ?? null, division: c.division ?? null, season, tables };
  }

  async conferenceSeoById(id: string) {
    const c = await one<any>(this.db.from('college_conferences').select('ncaa_seo').eq('id', id).maybeSingle(), 'conference');
    return c?.ncaa_seo ?? null;
  }

  // ---------- index pages ----------
  async rankings(season: number): Promise<RankingsPage> {
    const db = this.db;
    const firsts = await selectAll<any>(db, 'college_rankings', 'gender,division,week_of,label', (q) => q.eq('season', season).eq('poll', 'usc').eq('rank', 1));
    const latest = new Map<string, { week_of: string; label: string | null }>();
    for (const r of firsts) {
      const k = `${r.gender}|${r.division}`;
      if (!latest.has(k) || latest.get(k)!.week_of < r.week_of) latest.set(k, { week_of: r.week_of, label: r.label ?? null });
    }
    const order = (k: string) => { const [g, d] = k.split('|'); return ['d1', 'd2', 'd3'].indexOf(d ?? '') * 2 + (g === 'w' ? 1 : 0); };
    const polls: Poll[] = [];
    for (const k of [...latest.keys()].sort((a, b) => order(a) - order(b))) {
      const [gender, division] = k.split('|') as [Gender, string];
      const w = latest.get(k)!;
      const rows = await selectAll<any>(db, 'college_rankings', 'rank,previous_rank,first_place_votes,value,record,label,subject_name,college_programs(name,gender,school_seo)', (q) => q.eq('season', season).eq('poll', 'usc').eq('gender', gender).eq('division', division).eq('week_of', w.week_of).order('rank'));
      polls.push({ gender, division, week_of: w.week_of, label: String(w.label ?? '').replace(/ \(RV\)$/, '') || null,
        rows: rows.filter((r) => !String(r.label ?? '').includes('(RV)')).map((r) => ({ rank: r.rank, name: r.college_programs?.name ?? r.subject_name ?? 'Unknown', team: teamRef(r.college_programs), points: num(r.value), record: r.record ?? null, previous_rank: num(r.previous_rank), first_place_votes: num(r.first_place_votes) })) });
    }
    return { season, polls };
  }

  async teams(season: number): Promise<TeamsIndexPage> {
    const rows = await selectAll<any>(this.db, 'college_program_seasons', 'division,college_conferences(name,ncaa_seo,short_name,division),college_programs!inner(name,gender,school_seo)', (q) => q.eq('season', season).eq('ncaa_member', true));
    return { season, teams: rows.filter((r) => teamRef(r.college_programs)).map((r) => ({ team: teamRef(r.college_programs)!, division: r.division ?? null, conference: confRef(r.college_conferences) })) };
  }

  async home(season: number): Promise<HomePage> {
    const [t, r] = await Promise.all([this.teams(season), this.rankings(season)]);
    const confs = new Map<string, ConferenceRef>();
    for (const x of t.teams) if (x.conference && !confs.has(x.conference.seo)) confs.set(x.conference.seo, { ...x.conference, division: x.conference.division ?? x.division });
    return { season, teams: t.teams.length, conferences: [...confs.values()].sort((a, b) => a.name.localeCompare(b.name)), polls: r.polls.map((p) => ({ ...p, rows: p.rows.slice(0, 10) })) };
  }

  async resolve(kind: EntityKind, key: string): Promise<string | null> {
    const db = this.db;
    if (kind === 'team') {
      const [school, gender] = key.split('/');
      const p = await one<any>(db.from('college_programs').select('id').eq('school_seo', school).eq('gender', gender).maybeSingle(), 'program');
      return p?.id ?? null;
    }
    if (kind === 'conference') return (await one<any>(db.from('college_conferences').select('id').eq('ncaa_seo', key).maybeSingle(), 'conference'))?.id ?? null;
    if (kind === 'player') {
      const p = await one<any>(db.from('college_players').select('id,suppress').eq('slug', key).maybeSingle(), 'player');
      if (p) return p.suppress ? null : p.id;
    } else {
      const g = await one<any>(db.from('college_games').select('id').eq('slug', key).maybeSingle(), 'game');
      if (g) return g.id;
    }
    const r = await one<any>(db.from('college_slug_redirects').select('target_id').eq('kind', kind === 'player' ? 'player' : 'game').eq('slug', key).maybeSingle(), 'slug redirect');
    return r?.target_id ?? null;
  }

  // ---------- sitemaps ----------
  async sitemapSeasons(): Promise<number[]> {
    const rows = await selectAll<any>(this.db, 'college_seasons', 'season', (q) => q.order('season', { ascending: false }));
    const cur = this.currentSeason();
    return rows.map((r) => r.season as number).filter((s) => s <= cur);
  }

  async sitemapTeams(): Promise<SitemapEntry[]> {
    const cur = this.currentSeason();
    const [rows, stats] = await Promise.all([
      selectAll<any>(this.db, 'college_program_seasons', 'program_id,college_programs!inner(school_seo,gender,updated_at)', (q) => q.eq('ncaa_member', true).order('program_id')),
      selectAll<any>(this.db, 'college_team_season_stats', 'program_id,computed_at', (q) => q.eq('season', cur)),
    ]);
    const computed = new Map(stats.map((s) => [s.program_id, s.computed_at]));
    const seen = new Map<string, SitemapEntry>();
    for (const r of rows) {
      const t = r.college_programs; if (!t?.school_seo || seen.has(r.program_id)) continue;
      const a = computed.get(r.program_id), b = t.updated_at;
      seen.set(r.program_id, { path: teamPath({ school_seo: t.school_seo, gender: t.gender === 'w' ? 'w' : 'm' }), lastmod: a && (!b || a > b) ? a : b ?? null });
    }
    return [...seen.values()].sort((x, y) => x.path.localeCompare(y.path));
  }

  async sitemapConferences(): Promise<SitemapEntry[]> {
    const t = await this.teams(this.currentSeason());
    const seos = [...new Set(t.teams.map((x) => x.conference?.seo).filter((s): s is string => !!s))].sort();
    return seos.map((s) => ({ path: conferencePath(s) }));
  }

  private gamesQuery(season: number, head = false) {
    return this.db.from('college_games').select('slug,updated_at', head ? { count: 'exact', head: true } : undefined)
      .eq('season', season).not('slug', 'is', null).in('status', ['final', 'live']); // unplayed games are noindex (head.ts isUnplayed)
  }
  async countMatches(season: number): Promise<number> {
    const { count, error } = await this.gamesQuery(season, true);
    if (error) throw new Error(`count games: ${error.message}`);
    return count ?? 0;
  }
  async matches(season: number, offset: number, limit: number): Promise<SitemapEntry[]> {
    const rows = await selectRange<any>(() => this.gamesQuery(season).order('id'), offset, limit, 'sitemap games');
    return rows.map((r) => ({ path: matchPath(r.slug), lastmod: r.updated_at ?? null }));
  }

  // Players with at least one appearance that season, never suppressed or noindex ones.
  private playersQuery(season: number, head = false) {
    return this.db.from('college_player_seasons').select('id,updated_at,college_players!inner(slug,updated_at),college_player_season_stats!inner(gp)', head ? { count: 'exact', head: true } : undefined)
      .eq('season', season).gt('college_player_season_stats.gp', 0).eq('college_players.suppress', false).eq('college_players.noindex', false).not('college_players.slug', 'is', null);
  }
  async countPlayers(season: number): Promise<number> {
    const { count, error } = await this.playersQuery(season, true);
    if (error) throw new Error(`count players: ${error.message}`);
    return count ?? 0;
  }
  async players(season: number, offset: number, limit: number): Promise<SitemapEntry[]> {
    const rows = await selectRange<any>(() => this.playersQuery(season).order('id'), offset, limit, 'sitemap players');
    return rows.map((r) => {
      const a = r.updated_at, b = r.college_players?.updated_at;
      return { path: playerPath(r.college_players.slug), lastmod: a && (!b || a > b) ? a : b ?? null };
    });
  }
}
