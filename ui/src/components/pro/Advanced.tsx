// Advanced stats from American Soccer Analysis (xG, xA, passing over expected, goals added, shots), shown only where
// the service has checked them against API-Football. Every block carries the credit line.
import { Link } from 'react-router-dom';
import { fmt } from '../../lib/api';
import { proPath, type ProLeagueRef, type ProTeamRef } from '../../lib/pro';
import { DataTable, type Column } from '../DataTable';
import { PlayerAvatar, TeamLogo } from '../primitives';

export interface SourceCredit { name: string; url: string; label: string }
type Gplus = Record<string, { raw: number | null; above_avg: number | null; actions: number | null }>;
export interface AdvPlayerSeason {
  season: number; league: ProLeagueRef | null; team: ProTeamRef | null; position: string | null; minutes: number | null;
  shots: number | null; shots_on: number | null; goals: number | null; xg: number | null; key_passes: number | null; assists: number | null; xa: number | null;
  passes: number | null; pass_pct: number | null; xpass_pct: number | null; passes_over_expected: number | null; g_plus: number | null; g_plus_by_action: Gplus | null;
  keeper: { shots_faced: number | null; goals_conceded: number | null; saves: number | null; xg_faced: number | null; goals_minus_xg: number | null } | null;
}
export interface AdvTeamSeason {
  league: (ProLeagueRef & { priority?: number }) | null; games: number | null; points: number | null; xpoints: number | null; shots_for: number | null; shots_against: number | null;
  xg_for: number | null; xg_against: number | null; pass_pct_for: number | null; xpass_pct_for: number | null; pass_pct_against: number | null; xpass_pct_against: number | null;
  g_plus_for: number | null; g_plus_against: number | null; g_plus_by_action: Record<string, { for: number | null; against: number | null }> | null;
}
export interface AdvShot { side: 'home' | 'away'; minute: number | null; player: string | null; slug: string | null; x: number | null; y: number | null; xg: number | null; goal: boolean; own_goal: boolean; blocked: boolean; head: boolean; pattern: string | null }
export interface AdvMatch { credit: SourceCredit; xg: [number | null, number | null]; attendance: number | null; referee: string | null; ground: { name: string; city: string | null; capacity: number | null } | null; shots: AdvShot[] }
export interface AdvLeaderLine { player: { name: string; slug: string; photo: string | null }; team: ProTeamRef | null; minutes: number | null; goals: number | null; assists: number | null; value: number }

const dec = (v: number | null | undefined, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 1000) / 10}%`);
const signed = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);

export function Credit({ credit }: { credit: SourceCredit }) {
  return <p className="text-2xs text-chalk-500">Advanced stats: <a href={credit.url} target="_blank" rel="noopener" className="underline hover:text-pitch-300">{credit.name}</a>, checked against our match data. <Link to="/pro/sources" className="underline hover:text-pitch-300">Sources</Link></p>;
}

/** Goals added (above average) by action: bars either side of zero. */
export function GplusBars({ byAction, caption }: { byAction: Gplus | Record<string, { for: number | null; against: number | null }>; caption: string }) {
  const rows = Object.entries(byAction).map(([action, v]) => ({ action, value: 'above_avg' in v ? v.above_avg ?? 0 : (v.for ?? 0) - (v.against ?? 0) }));
  if (!rows.length) return null;
  const max = Math.max(0.1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <figure className="frame p-3">
      <figcaption className="mb-2 text-xs text-chalk-400">{caption}</figcaption>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.action} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-sm" aria-label={`${r.action}: ${signed(r.value)}`}>
            <span className="truncate text-chalk-300">{r.action}</span>
            <span className="relative h-2 rounded bg-field-700" aria-hidden>
              <span className={`absolute top-0 h-full rounded ${r.value >= 0 ? 'left-1/2 bg-win' : 'right-1/2 bg-loss'}`} style={{ width: `${(Math.abs(r.value) / max) * 50}%` }} />
            </span>
            <span className="text-right text-xs tnum text-chalk-200">{signed(r.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function PlayerAdvancedTable({ seasons }: { seasons: AdvPlayerSeason[] }) {
  const keeper = seasons.some((s) => s.keeper);
  const cols: Column<AdvPlayerSeason>[] = [
    { key: 'season', label: 'Season', value: (r) => r.season },
    { key: 'team', label: 'Club', primary: true, value: (r) => r.team?.name ?? '', render: (r) => r.team ? <span className="flex items-center gap-1.5"><TeamLogo src={r.team.logo} name={r.team.name} size={16} /><span className="truncate">{r.team.name}</span></span> : '–' },
    { key: 'minutes', label: 'Min', num: true, priority: 2, value: (r) => r.minutes },
    { key: 'goals', label: 'G', title: 'Goals', num: true, value: (r) => r.goals },
    { key: 'xg', label: 'xG', title: 'Expected goals', num: true, decimals: 2, value: (r) => dec(r.xg) },
    { key: 'assists', label: 'A', title: 'Assists', num: true, value: (r) => r.assists },
    { key: 'xa', label: 'xA', title: 'Expected assists', num: true, decimals: 2, value: (r) => dec(r.xa) },
    { key: 'shots', label: 'Sh', title: 'Shots (on target)', num: true, priority: 2, value: (r) => r.shots, render: (r) => r.shots == null ? '–' : `${r.shots} (${r.shots_on ?? 0})` },
    { key: 'key_passes', label: 'KP', title: 'Key passes', num: true, priority: 3, value: (r) => r.key_passes },
    { key: 'pass', label: 'Pass %', title: 'Pass completion (expected)', num: true, priority: 3, value: (r) => r.pass_pct, render: (r) => r.pass_pct == null ? '–' : `${pct(r.pass_pct)} (${pct(r.xpass_pct)})` },
    { key: 'g_plus', label: 'g+', title: 'Goals added above average', num: true, decimals: 2, value: (r) => dec(r.g_plus) },
    ...(keeper ? [{ key: 'gk', label: 'GA − xGA', title: 'Goals conceded minus expected (keepers; lower is better)', num: true as const, decimals: 2, value: (r: AdvPlayerSeason) => dec(r.keeper?.goals_minus_xg) }] : []),
  ];
  return <DataTable rows={seasons} columns={cols} rowKey={(r) => `${r.season}-${r.league?.id}-${r.team?.id}`} caption="Advanced stats by season" dense />;
}

export function TeamAdvancedCards({ competitions }: { competitions: AdvTeamSeason[] }) {
  return (
    <div className="space-y-3">
      {competitions.map((c) => (
        <div key={c.league?.id ?? 'x'} className="space-y-3">
          {competitions.length > 1 && c.league && <h3 className="text-sm font-medium text-chalk-200">{c.league.name}</h3>}
          <div className="frame grid grid-cols-2 gap-x-4 gap-y-3 p-3 sm:grid-cols-4">
            {[
              ['xG for', dec(c.xg_for, 1), c.games ? `${dec((c.xg_for ?? 0) / c.games)} a game` : null],
              ['xG against', dec(c.xg_against, 1), c.games ? `${dec((c.xg_against ?? 0) / c.games)} a game` : null],
              ['Points vs expected', c.points != null && c.xpoints != null ? `${c.points} / ${dec(c.xpoints, 1)}` : '–', c.points != null && c.xpoints != null ? signed(c.points - c.xpoints, 1) : null],
              ['Goals added', signed(c.g_plus_for != null && c.g_plus_against != null ? c.g_plus_for - c.g_plus_against : null), 'for minus against'],
              ['Shots', c.shots_for != null ? `${c.shots_for} : ${c.shots_against ?? '–'}` : '–', 'for, against'],
              ['Passing', pct(c.pass_pct_for), c.xpass_pct_for != null ? `expected ${pct(c.xpass_pct_for)}` : null],
              ['Opponents passing', pct(c.pass_pct_against), c.xpass_pct_against != null ? `expected ${pct(c.xpass_pct_against)}` : null],
              ['Matches', c.games ?? '–', null],
            ].map(([label, value, sub]) => (
              <div key={String(label)} className="min-w-0"><div className="display text-xl tnum text-chalk-100">{value}</div><div className="text-xs text-chalk-500">{label}{sub ? <span className="text-chalk-400">, {sub}</span> : null}</div></div>
            ))}
          </div>
          {c.g_plus_by_action && <GplusBars byAction={c.g_plus_by_action} caption="Goals added by action, for minus against" />}
        </div>
      ))}
    </div>
  );
}

/** Both sides' shots on one pitch: home attacks right, away attacks left; size is xG, filled is a goal. */
/**
 * Every shot of a match on one pitch, the home side attacking right. ASA's shot locations are Opta-style: x runs 0-100
 * from the shooter's own goal to the goal attacked (checked against its distance-from-goal: 0.31 yards off on a
 * 115 x 75 yard pitch), y from the attacking side's right touchline (0) to its left (100). So for the home side x maps
 * left to right and y bottom to top (SVG counts y down, hence 100 - y); the away side is the same turned round.
 * Own goals are not shots: when the score has goals the map cannot show, the caption says so.
 */
export function ShotMap({ shots, homeName, awayName, score }: { shots: AdvShot[]; homeName: string; awayName: string; score?: [number | null, number | null] }) {
  if (!shots.length) return null;
  const W = 105, H = 68, GOAL = 7.32;
  const goals = { home: shots.filter((s) => s.side === 'home' && s.goal).length, away: shots.filter((s) => s.side === 'away' && s.goal).length };
  const missing = score ? Math.max(0, (score[0] ?? 0) - goals.home) + Math.max(0, (score[1] ?? 0) - goals.away) : 0;
  return (
    <figure className="frame p-3">
      <svg viewBox={`-3 -2 ${W + 6} ${H + 4}`} className="w-full" role="img" aria-label={`Shot map: ${shots.filter((s) => s.side === 'home').length} shots for ${homeName} attacking right, ${shots.filter((s) => s.side === 'away').length} for ${awayName} attacking left`}>
        <rect x={0} y={0} width={W} height={H} rx={1} className="fill-field-800 stroke-field-600" strokeWidth={0.4} />
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} className="stroke-field-600" strokeWidth={0.4} />
        <circle cx={W / 2} cy={H / 2} r={9.15} className="fill-none stroke-field-600" strokeWidth={0.4} />
        {[0, W - 16.5].map((x) => <rect key={x} x={x} y={(H - 40.3) / 2} width={16.5} height={40.3} className="fill-none stroke-field-600" strokeWidth={0.4} />)}
        {[0, W - 5.5].map((x) => <rect key={`six${x}`} x={x} y={(H - 18.32) / 2} width={5.5} height={18.32} className="fill-none stroke-field-600" strokeWidth={0.4} />)}
        {/* The goals: the home side shoots at the right one. */}
        <rect x={-1.6} y={(H - GOAL) / 2} width={1.6} height={GOAL} className="fill-field-600" />
        <rect x={W} y={(H - GOAL) / 2} width={1.6} height={GOAL} className="fill-chalk-400" />
        {shots.filter((s) => s.x != null && s.y != null).map((s, i) => {
          const home = s.side === 'home';
          const cx = ((home ? s.x! : 100 - s.x!) / 100) * W;
          const cy = ((home ? 100 - s.y! : s.y!) / 100) * H;
          const r = 0.8 + Math.sqrt(s.xg ?? 0.02) * 3.2;
          return (
            <circle key={i} cx={cx} cy={cy} r={r} strokeWidth={0.5} className={`${home ? 'stroke-pitch-300' : 'stroke-note'} ${s.goal ? (home ? 'fill-pitch-400' : 'fill-note') : 'fill-transparent'}`}>
              <title>{`${s.minute ?? '?'}' ${s.player ?? 'Unknown'}: ${s.goal ? 'goal' : s.blocked ? 'blocked' : 'no goal'}, ${dec(s.xg)} xG${s.head ? ', header' : ''}${s.pattern && s.pattern !== 'Regular' ? `, ${s.pattern.toLowerCase()}` : ''}`}</title>
            </circle>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-2xs text-chalk-400">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-pitch-300" />{homeName} attacking right</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-note" />{awayName} attacking left</span>
        <span>Bigger circle, better chance. Filled: goal.</span>
        {missing > 0 && <span>{missing === 1 ? 'One goal was an own goal' : `${missing} goals were own goals`}, so not a shot on the map.</span>}
      </figcaption>
    </figure>
  );
}

/** What the source adds to the match header: the attendance, and the ground or referee only when the header has none. */
export function MatchAdvancedFacts({ a, hasVenue = false, hasReferee = false }: { a: AdvMatch; hasVenue?: boolean; hasReferee?: boolean }) {
  const facts = [a.attendance ? `Attendance ${fmt.num(a.attendance)}` : null, a.ground && !hasVenue ? `${a.ground.name}${a.ground.city ? `, ${a.ground.city}` : ''}` : null, a.referee && !hasReferee ? `Referee ${a.referee}` : null].filter(Boolean);
  return facts.length ? <p className="text-xs text-chalk-400">{facts.join(' · ')}</p> : null;
}

export interface ExpectedLine { team: ProTeamRef | null; games: number | null; points: number | null; xpoints: number | null; xg_for: number | null; xg_against: number | null; g_plus: number | null }

/** Clubs by expected points: what their chances were worth against what they got. */
export function ExpectedTable({ rows, season }: { rows: ExpectedLine[]; season: number | null }) {
  const cols: Column<ExpectedLine>[] = [
    { key: 'rank', label: '#', num: true, sortable: false, value: (r) => rows.indexOf(r) + 1 },
    { key: 'team', label: 'Club', primary: true, value: (r) => r.team?.name ?? '', render: (r) => r.team ? <Link to={proPath.team(r.team.slug, season)} className="flex items-center gap-1.5 hover:text-pitch-300"><TeamLogo src={r.team.logo} name={r.team.name} size={18} /><span className="truncate">{r.team.name}</span></Link> : '–' },
    { key: 'games', label: 'P', title: 'Matches', num: true, priority: 2, value: (r) => r.games },
    { key: 'xpoints', label: 'xPts', title: 'Expected points', num: true, decimals: 1, value: (r) => r.xpoints },
    { key: 'points', label: 'Pts', title: 'Points', num: true, value: (r) => r.points },
    { key: 'diff', label: '+/-', title: 'Points above (or below) expected', num: true, decimals: 1, value: (r) => (r.points != null && r.xpoints != null ? Math.round((r.points - r.xpoints) * 10) / 10 : null),
      render: (r) => { const d = r.points != null && r.xpoints != null ? r.points - r.xpoints : null; return d == null ? '–' : <span className={d >= 0 ? 'text-win' : 'text-loss'}>{d > 0 ? '+' : ''}{d.toFixed(1)}</span>; } },
    { key: 'xg_for', label: 'xGF', title: 'Expected goals for', num: true, decimals: 1, priority: 2, value: (r) => r.xg_for },
    { key: 'xg_against', label: 'xGA', title: 'Expected goals against', num: true, decimals: 1, priority: 2, value: (r) => r.xg_against },
    { key: 'g_plus', label: 'g+', title: 'Goals added, for minus against', num: true, decimals: 1, priority: 3, value: (r) => r.g_plus },
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(r) => String(r.team?.id)} caption={`Expected table ${season ?? ''}`} dense defaultSort={{ key: 'xpoints', dir: 'desc' }} />;
}

export function AdvancedLeaders({ data, season }: { data: { xg: AdvLeaderLine[]; xa: AdvLeaderLine[]; g_plus: AdvLeaderLine[] }; season: number | null }) {
  const list = (title: string, rows: AdvLeaderLine[], d = 1) => (
    <div className="min-w-0">
      <h3 className="mb-1.5 text-sm font-medium text-chalk-200">{title}</h3>
      <ol className="frame divide-y divide-field-700 text-sm">
        {rows.map((r, i) => (
          <li key={r.player.slug} className="flex items-center gap-2 px-3 py-1.5">
            <span className="w-4 text-right text-2xs tnum text-chalk-500">{i + 1}</span>
            <PlayerAvatar src={r.player.photo} name={r.player.name} size={20} />
            <Link to={proPath.player(r.player.slug)} className="min-w-0 flex-1 truncate text-chalk-100 hover:text-pitch-300">{r.player.name}</Link>
            {r.team && <TeamLogo src={r.team.logo} name={r.team.name} size={16} />}
            <span className="w-12 text-right tnum font-semibold text-chalk-100">{r.value.toFixed(d)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <div className="grid gap-4 md:grid-cols-3" aria-label={`Advanced leaders ${season ?? ''}`}>
      {list('Expected goals (xG)', data.xg)}
      {list('Expected assists (xA)', data.xa)}
      {list('Goals added (g+)', data.g_plus, 2)}
    </div>
  );
}
