// The flow of one match for its page (src/match/flow.ts): win probability, attack momentum and, where shots carry
// xG, the xG race. College from the box score's play-by-play; pro from the match events and American Soccer
// Analysis' shots. Pre-match chances from Plaibook Elo (college: each side's rating the day before; pro: the club's
// rating now), else the provider's prediction. Nothing is returned when there is too little to draw.
import { kvGet, selectAll, type Db } from '../db/client.js';
import { COLLEGE_DRAW_KEY, PRO_DRAW_KEY, expected, predict, type DrawModel } from '../sources/intl/elo.js';
import { matchAdvanced } from '../pro/sources.js';
import { memo } from '../pro/memo.js';
import { COLLEGE_WEIGHTS, fitRates, momentum, winProbCurve, xgRace, type Action, type FlowEvent, type Probs } from './flow.js';

const HOME = { college: 60, pro: 70 } as const;
/** A play-by-play name as people write it ("RANGON, Malcolm" -> "Malcolm Rangon"); null for "Team" lines. */
const personName = (raw: string | null): string | null => {
  const s = String(raw ?? '').trim();
  if (!s || /^team$/i.test(s)) return null;
  const flipped = /,/.test(s) ? s.split(',').map((x) => x.trim()).reverse().join(' ') : s;
  return flipped === flipped.toUpperCase() ? flipped.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : flipped;
};
const DEFAULT_DRAW: DrawModel = [0.27, 0.26, 0.24, 0.22, 0.2, 0.17, 0.14, 0.11, 0.08, 0.05];

export interface Flow {
  length: number; until: number; live: boolean;
  pre: Probs | null; basis: 'elo' | 'prediction' | null;
  winprob: { m: number; h: number; d: number; a: number }[] | null;
  momentum: { m: number; v: number }[] | null;
  xg: { m: number; h: number; a: number }[] | null;
  marks: { m: number; side: 'home' | 'away'; type: 'goal' | 'red'; who?: string | null }[];
  source: string;
}

function chances(rh: number, ra: number, neutral: boolean, kind: 'college' | 'pro', model: DrawModel): Probs {
  const p = predict(expected(rh + (neutral ? 0 : HOME[kind]) - ra), model);
  return { h: p.win, d: p.draw, a: p.loss };
}

/** Average goals a game in a college division this season (the model's total), cached for a day. */
const collegeGoals = (db: Db, season: number, gender: string, division: string | null) => memo(`flow-goals:${season}:${gender}:${division}`, async () => {
  const rows = await selectAll<{ home_score: number; away_score: number }>(db, 'college_games', 'home_score,away_score', (q) => { let x = q.eq('season', season).eq('gender', gender).eq('status', 'final').not('home_score', 'is', null); if (division) x = x.eq('division', division); return x.limit(4000); });
  const n = rows.length;
  return n >= 50 ? rows.reduce((s, r) => s + r.home_score + r.away_score, 0) / n : 2.8;
}, { fresh: 24 * 3600_000 });

const proGoals = (db: Db, league: number, season: number) => memo(`flow-pgoals:${league}:${season}`, async () => {
  const rows = await selectAll<{ home_goals: number; away_goals: number }>(db, 'pro_fixtures', 'home_goals,away_goals', (q) => q.eq('league_id', league).eq('season', season).eq('status', 'final').not('home_goals', 'is', null).limit(2000));
  return rows.length >= 20 ? rows.reduce((s, r) => s + r.home_goals + r.away_goals, 0) / rows.length : 2.7;
}, { fresh: 24 * 3600_000 });

// ---------- college ----------
export async function collegeFlow(db: Db, id: string): Promise<Flow | null> {
  const { data: g } = await db.from('college_v_schedule').select('id,season,gender,division,status,game_date,home_program_id,away_program_id,home_score,away_score,neutral_site,source_of_truth,live_period,live_clock').eq('id', id).maybeSingle();
  const game = g as any;
  if (!game || (game.status !== 'final' && game.status !== 'live') || !game.home_program_id || !game.away_program_id) return null;
  const live = game.status === 'live';
  return memo(`flow-c:${id}:${game.status}`, async () => {
    const evs = await selectAll<{ source: string; period: number; clock_seconds: number | null; program_id: string | null; event_type: string; player_name_raw: string | null }>(db, 'college_game_events', 'source,period,clock_seconds,program_id,event_type,player_name_raw',
      (q) => q.eq('game_id', id).in('event_type', ['shot', 'goal', 'pk', 'corner', 'save', 'red']));
    // The play-by-play of the box score we trust, else the other one if it has more.
    const by = (s: string) => evs.filter((e) => e.source === s && e.clock_seconds != null && e.program_id);
    const truth = by(game.source_of_truth ?? 'site'), other = by(game.source_of_truth === 'ncaa' ? 'site' : 'ncaa');
    const pick = truth.filter((e) => e.event_type === 'shot').length >= other.filter((e) => e.event_type === 'shot').length ? truth : other;
    const side = (pid: string | null): 'home' | 'away' | null => (pid === game.home_program_id ? 'home' : pid === game.away_program_id ? 'away' : null);
    const minute = (cs: number) => Math.floor(cs / 60) + 1;
    const actions: Action[] = [];
    const marks: Flow['marks'] = [];
    for (const e of pick) {
      const s = side(e.program_id); if (!s) continue;
      const m = minute(e.clock_seconds!);
      if (e.event_type === 'save') actions.push({ m, side: s === 'home' ? 'away' : 'home', w: 0.5 });
      else if (e.event_type === 'red') marks.push({ m, side: s, type: 'red', who: personName(e.player_name_raw) });
      else { actions.push({ m, side: s, w: COLLEGE_WEIGHTS[e.event_type] ?? 0 }); if (e.event_type === 'goal') marks.push({ m, side: s, type: 'goal', who: personName(e.player_name_raw) }); }
    }
    const lastEvent = Math.max(0, ...pick.map((e) => minute(e.clock_seconds!)));
    const until = live ? Math.max(lastEvent, liveMinute(game.live_period, game.live_clock) ?? 0) : Math.max(90, lastEvent);
    const shots = actions.filter((a) => a.w >= 1).length;
    // Win probability only when the play-by-play's goals give the score (a feed missing a goal would draw a wrong line).
    const goals = (s: 'home' | 'away') => marks.filter((x) => x.type === 'goal' && x.side === s).length;
    const scoreOk = goals('home') === (game.home_score ?? -1) && goals('away') === (game.away_score ?? -1);
    let pre: Probs | null = null;
    if (scoreOk) {
      const [hist, model, total] = await Promise.all([
        selectAll<{ program_id: string; day: string; rating: number }>(db, 'college_elo_history', 'program_id,day,rating', (q) => q.in('program_id', [game.home_program_id, game.away_program_id]).lt('day', game.game_date).order('day', { ascending: false }).limit(60)),
        kvGet<DrawModel>(db, COLLEGE_DRAW_KEY(game.gender)),
        collegeGoals(db, game.season, game.gender, game.division),
      ]);
      const rating = (pid: string) => hist.find((h) => h.program_id === pid)?.rating;
      const rh = rating(game.home_program_id), ra = rating(game.away_program_id);
      if (rh != null && ra != null) {
        pre = chances(Number(rh), Number(ra), !!game.neutral_site, 'college', model ?? DEFAULT_DRAW);
        const { lh, la } = fitRates(pre, total);
        return out({ length: 90, until, live, pre, basis: 'elo', lh, la, actions, marks, shots, source: pick[0]?.source ?? 'site' });
      }
    }
    return out({ length: 90, until, live, pre: null, basis: null, lh: 0, la: 0, actions, marks, shots, source: pick[0]?.source ?? 'site' });
  }, { fresh: live ? 30_000 : 6 * 3600_000 });
}

/** The minute a live college game is in, from the scoreboard's period and clock ("2nd", "61:12" or "28:48" left). */
function liveMinute(period: string | null, clock: string | null): number | null {
  const m = String(clock ?? '').match(/^(\d+):(\d\d)/);
  if (!m) return null;
  const n = Number(m[1]);
  const p = /2|second/i.test(String(period ?? '')) ? 2 : /ot|3|4/i.test(String(period ?? '')) ? 3 : 1;
  // Clocks counting down show what is left in the half; counting up, the game minute.
  if (n <= 45 && p === 2) return 90 - n;
  return n + 1;
}

function out(o: { length: number; until: number; live: boolean; pre: Probs | null; basis: Flow['basis']; lh: number; la: number; actions: Action[]; marks: Flow['marks']; shots: number; source: string; xg?: Flow['xg'] }): Flow | null {
  const winprob = o.pre ? winProbCurve({ lh: o.lh, la: o.la, length: o.length, events: o.marks as FlowEvent[], until: o.until }) : null;
  const mom = o.shots >= 4 ? momentum(o.actions, o.until) : null;
  if (!winprob && !mom && !o.xg) return null;
  return { length: o.length, until: o.until, live: o.live, pre: o.pre, basis: o.basis, winprob, momentum: mom, xg: o.xg ?? null, marks: o.marks, source: o.source };
}

// ---------- pro ----------
export async function proFlow(db: Db, fixtureId: number): Promise<Flow | null> {
  const { data: f } = await db.from('pro_fixtures').select('id,league_id,season,status,status_short,elapsed,elapsed_extra,home_team_id,away_team_id,home_goals,away_goals,pro_leagues(gender)').eq('id', fixtureId).maybeSingle();
  const fx = f as any;
  if (!fx || (fx.status !== 'final' && fx.status !== 'live')) return null;
  const live = fx.status === 'live';
  return memo(`flow-p:${fixtureId}:${fx.status}:${live ? fx.elapsed : ''}`, async () => {
    const gender: 'm' | 'w' = fx.pro_leagues?.gender === 'w' ? 'w' : 'm';
    const [events, adv] = await Promise.all([
      selectAll<{ minute: number | null; extra: number | null; team_id: number; type: string; detail: string | null; comments: string | null; player_name: string | null }>(db, 'pro_fixture_events', 'minute,extra,team_id,type,detail,comments,player_name', (q) => q.eq('fixture_id', fixtureId).in('type', ['goal', 'card'])),
      matchAdvanced(db, fixtureId, fx.home_team_id).catch(() => null),
    ]);
    const side = (t: number): 'home' | 'away' => (t === fx.home_team_id ? 'home' : 'away');
    const mOf = (e: { minute: number | null; extra: number | null }) => (e.minute ?? 0) + (e.extra ?? 0);
    const goalsEv = events.filter((e) => e.type === 'goal' && e.detail !== 'Missed Penalty' && !/shootout/i.test(e.comments ?? '') && e.minute != null);
    const build = (flipOwn: boolean) => goalsEv.map((e) => ({ m: mOf(e), side: (e.detail === 'Own Goal' && flipOwn ? (side(e.team_id) === 'home' ? 'away' : 'home') : side(e.team_id)) as 'home' | 'away', type: 'goal' as const,
      who: e.player_name ? `${e.player_name}${e.detail === 'Own Goal' ? ' (own goal)' : e.detail === 'Penalty' ? ' (pen)' : ''}` : null }));
    const fits = (gs: { side: string }[]) => gs.filter((g) => g.side === 'home').length === (fx.home_goals ?? -1) && gs.filter((g) => g.side === 'away').length === (fx.away_goals ?? -1);
    // The provider files an own goal under one side or the other: whichever reading gives the score.
    let goals = build(false);
    if (!fits(goals)) goals = build(true);
    const scoreOk = fits(goals);
    const reds = events.filter((e) => e.type === 'card' && /red|second yellow/i.test(e.detail ?? '') && e.minute != null).map((e) => ({ m: mOf(e), side: side(e.team_id), type: 'red' as const, who: e.player_name ?? null }));
    const marks = [...goals, ...reds].sort((a, b) => a.m - b.m);
    const extraTime = ['AET', 'PEN'].includes(fx.status_short) || (live && ['ET', 'BT', 'P'].includes(fx.status_short));
    const length = extraTime ? 120 : 90;
    const last = Math.max(0, ...marks.map((x) => x.m), ...(adv?.shots ?? []).map((s: any) => Number(s.minute) || 0));
    const until = live ? Math.max(last, (fx.elapsed ?? 0) + (fx.elapsed_extra ?? 0)) : Math.max(length, last);
    const shots = (adv?.shots ?? []).filter((s: any) => s.minute != null);
    const actions: Action[] = shots.map((s: any) => ({ m: Number(s.minute), side: s.side, w: 0.4 + 3 * (Number(s.xg) || 0) + (s.goal ? 1 : 0) }));
    const xg = shots.length && shots.some((s: any) => s.xg != null) ? xgRace(shots.map((s: any) => ({ m: Number(s.minute), side: s.side, xg: Number(s.xg) || 0 })), until) : null;
    let pre: Probs | null = null, basis: Flow['basis'] = null;
    if (scoreOk) {
      const [elo, model, total, pred] = await Promise.all([
        selectAll<{ team_id: number; rating: number; games: number }>(db, 'pro_elo', 'team_id,rating,games', (q) => q.in('team_id', [fx.home_team_id, fx.away_team_id])),
        kvGet<DrawModel>(db, PRO_DRAW_KEY(gender)),
        proGoals(db, fx.league_id, fx.season),
        db.from('pro_fixture_predictions').select('home_pct,draw_pct,away_pct').eq('fixture_id', fixtureId).maybeSingle().then((r) => r.data as any),
      ]);
      const h = elo.find((e) => e.team_id === fx.home_team_id), a = elo.find((e) => e.team_id === fx.away_team_id);
      if (h && a && h.games >= 5 && a.games >= 5) { pre = chances(Number(h.rating), Number(a.rating), false, 'pro', model ?? DEFAULT_DRAW); basis = 'elo'; }
      else if (pred?.home_pct != null && pred?.away_pct != null) { const t = (pred.home_pct + (pred.draw_pct ?? 0) + pred.away_pct) || 100; pre = { h: pred.home_pct / t, d: (pred.draw_pct ?? 0) / t, a: pred.away_pct / t }; basis = 'prediction'; }
      if (pre) { const { lh, la } = fitRates(pre, total * (length / 90)); return out({ length, until, live, pre, basis, lh, la, actions, marks, shots: shots.length, source: 'pro', xg }); }
    }
    return out({ length, until, live, pre: null, basis: null, lh: 0, la: 0, actions, marks, shots: shots.length, source: 'pro', xg });
  }, { fresh: live ? 30_000 : 6 * 3600_000 });
}
