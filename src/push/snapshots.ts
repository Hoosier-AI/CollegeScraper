// What the crawl jobs hand to observeMatches(): the stored row of each match read back (after the job's own write)
// with the names, the page link and the follow targets an alert needs. Two entry points, one per data set; both
// read directly (no US-only filter) and neither can throw into the job that calls it.
import { selectIn, type Db } from '../db/client.js';
import { log } from '../log.js';
import { observeAndQueue, observePaused, type MatchSnapshot } from './observe.js';

export interface PrevRow { status: string; home: number | null; away: number | null }

const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const warn = (what: string, err: unknown) => log.warn({ err: err instanceof Error ? err.message : String(err) }, `push: ${what} failed`);

/** True when the job's write changed something an alert can come from (not just the clock). */
export function meaningfulChange(prev: PrevRow, next: { status?: string; home_score?: number | null; away_score?: number | null }): boolean {
  if (next.status !== undefined && next.status !== prev.status) return true;
  if ('home_score' in next && (next.home_score ?? 0) !== (prev.home ?? 0)) return true;
  if ('away_score' in next && (next.away_score ?? 0) !== (prev.away ?? 0)) return true;
  return false;
}

export async function collegeSnapshots(db: Db, ids: string[], prev?: Map<string, PrevRow>): Promise<MatchSnapshot[]> {
  const games = await selectIn<any>(db, 'college_games', 'id,slug,season,status,home_score,away_score,start_epoch,live_period,home_program_id,away_program_id,home_name,away_name', 'id', ids);
  if (!games.length) return [];
  const programIds = [...new Set(games.flatMap((g) => [g.home_program_id, g.away_program_id]).filter(Boolean))] as string[];
  const [programs, seasons] = programIds.length ? await Promise.all([
    selectIn<any>(db, 'college_programs', 'id,name', 'id', programIds),
    selectIn<any>(db, 'college_program_seasons', 'program_id,season,conference_id,college_conferences(name,short_name)', 'program_id', programIds, (q) => q.in('season', [...new Set(games.map((g) => g.season))])),
  ]) : [[], []];
  const names = new Map(programs.map((p) => [p.id as string, p.name as string]));
  const conf = new Map(seasons.filter((s) => s.conference_id).map((s) => [`${s.program_id}|${s.season}`, { kind: 'conference', ref: String(s.conference_id), name: s.college_conferences?.short_name ?? s.college_conferences?.name ?? 'Conference' }]));
  return games.map((g): MatchSnapshot => {
    const side = (programId: string | null, fallback: string | null) => ({ kind: 'team', ref: programId ?? '', name: (programId && names.get(programId)) || fallback || 'TBD' });
    const hc = conf.get(`${g.home_program_id}|${g.season}`), ac = conf.get(`${g.away_program_id}|${g.season}`);
    return {
      key: `c:${g.id}`, status: g.status, home: num(g.home_score), away: num(g.away_score), period: g.live_period ?? null,
      kickoff: g.start_epoch ? new Date(Number(g.start_epoch) * 1000).toISOString() : null,
      prev: prev?.get(g.id) ?? null,
      teams: { home: side(g.home_program_id, g.home_name), away: side(g.away_program_id, g.away_name) },
      league: hc ?? ac ?? null,
      refs: hc && ac && ac.ref !== hc.ref ? [ac] : [],
      to: `/matches/${g.slug ?? g.id}`,
    };
  });
}

/** College games the job just wrote. `prev`: what each row said before the write (the live job has it). */
export async function observeCollegeGames(db: Db, ids: string[], prev?: Map<string, PrevRow>): Promise<number> {
  try {
    const uniq = [...new Set(ids)].filter(Boolean);
    if (!uniq.length || observePaused()) return 0;
    return await observeAndQueue(db, await collegeSnapshots(db, uniq, prev));
  } catch (err) { warn('college snapshots', err); return 0; }
}

interface GoalRow { fixture_id: number; seq: number; minute: number | null; team_id: number | null; player_id: number | null; player_name: string | null; detail: string | null; comments: string | null }

/** The newest goal on file, only when the goals on file add up to the score (else the feed is behind: no name). */
export function scorerOf(goals: GoalRow[], home: number | null, away: number | null): MatchSnapshot['scorer'] {
  const counted = goals.filter((e) => !/missed/i.test(e.detail ?? '') && !/shootout/i.test(e.comments ?? '')).sort((x, y) => x.seq - y.seq);
  const last = counted[counted.length - 1];
  if (!last || counted.length !== (home ?? 0) + (away ?? 0)) return null;
  return { name: last.player_name ?? null, player_id: last.player_id ?? null, team_id: last.team_id ?? null, minute: last.minute ?? null, own_goal: /own goal/i.test(last.detail ?? '') };
}

export async function proSnapshots(db: Db, ids: number[]): Promise<MatchSnapshot[]> {
  const fixtures = await selectIn<any>(db, 'pro_fixtures', 'id,slug,league_id,kickoff,status,status_short,elapsed,home_team_id,away_team_id,home_goals,away_goals', 'id', ids);
  if (!fixtures.length) return [];
  const liveIds = fixtures.filter((f) => f.status === 'live' && (num(f.home_goals) ?? 0) + (num(f.away_goals) ?? 0) > 0).map((f) => Number(f.id));
  const [teams, leagues, goals] = await Promise.all([
    selectIn<any>(db, 'pro_teams', 'id,name', 'id', fixtures.flatMap((f) => [Number(f.home_team_id), Number(f.away_team_id)])),
    selectIn<any>(db, 'pro_leagues', 'id,name,scope', 'id', fixtures.map((f) => Number(f.league_id))),
    // The scorer is a nicety: without it the alert still goes, with the score alone.
    liveIds.length ? selectIn<GoalRow>(db, 'pro_fixture_events', 'fixture_id,seq,minute,team_id,player_id,player_name,detail,comments', 'fixture_id', liveIds, (q) => q.eq('type', 'goal')).catch(() => [] as GoalRow[]) : Promise.resolve([] as GoalRow[]),
  ]);
  const teamName = new Map(teams.map((t) => [Number(t.id), t.name as string]));
  const league = new Map(leagues.map((l) => [Number(l.id), l]));
  return fixtures.filter((f) => f.slug).map((f): MatchSnapshot => {
    const l = league.get(Number(f.league_id));
    const side = (id: number) => ({ kind: 'pro-team', ref: String(id), name: teamName.get(Number(id)) ?? 'TBD' });
    const home = num(f.home_goals), away = num(f.away_goals);
    return {
      key: `p:${f.id}`, status: f.status, home, away, period: f.status_short ?? null, kickoff: f.kickoff ?? null,
      elapsed: f.status === 'live' ? num(f.elapsed) : null,
      teams: { home: side(f.home_team_id), away: side(f.away_team_id) },
      league: l ? { kind: 'pro-league', ref: String(l.id), name: l.name } : null,
      to: `/${l?.scope === 'intl' ? 'intl' : 'pro'}/matches/${f.slug}`,
      scorer: f.status === 'live' ? scorerOf(goals.filter((e) => Number(e.fixture_id) === Number(f.id)), home, away) : null,
    };
  });
}

/** Pro and international fixtures the job just stored (they share pro_fixtures). */
export async function observeProFixtures(db: Db, ids: number[]): Promise<number> {
  try {
    const uniq = [...new Set(ids)].filter((id) => Number.isInteger(id));
    if (!uniq.length || observePaused()) return 0;
    return await observeAndQueue(db, await proSnapshots(db, uniq));
  } catch (err) { warn('pro snapshots', err); return 0; }
}
