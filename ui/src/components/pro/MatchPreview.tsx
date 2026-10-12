// A pro match before kickoff: form, head to head, the table, each side's last starting XI, top scorers and who is out.
// The match page shows it in place of events and stats until the match starts.
import { Link } from 'react-router-dom';
import { Ambulance } from 'lucide-react';
import { proPath, type ProMatch } from '../../lib/pro';
import { PlayerAvatar, Section, TeamLogo } from '../primitives';
import { LineupList, ProPitch, type ProLine, type ProSideDetail } from './MatchParts';
import { ProMatchRow } from './ProMatchRow';

type Person = { id: number | null; name: string; slug: string | null; photo: string | null; position: string | null };
type Standing = { rank: number | null; points: number | null; played: number | null; win: number | null; draw: number | null; lose: number | null; gf: number | null; ga: number | null; gd: number | null; form: string | null };
export interface PreviewSide {
  form: ProMatch[];
  last_xi: { match: ProMatch; formation: string | null; coach: string | null; starters: ProLine[] } | null;
  scorers: (Person & { apps: number; minutes: number; goals: number; assists: number })[];
  out: (Person & { type: string | null; reason: string | null })[];
}
export interface ProPrediction { home_pct: number | null; draw_pct: number | null; away_pct: number | null; comparison: Record<string, [number | null, number | null]>; fetched_at: string }
export interface ProPreview { home: PreviewSide; away: PreviewSide; table: { group: string | null; teams: number; home: Standing | null; away: Standing | null } | null; prediction?: ProPrediction | null }

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const TONE = { W: 'bg-win/20 text-win', D: 'bg-draw/20 text-draw', L: 'bg-loss/20 text-loss' } as const;

/** One club's result in a match it played: W, D or L, its goals first. */
function resultFor(m: ProMatch, teamId: number) {
  const home = m.home.id === teamId;
  const us = (home ? m.home.score : m.away.score) ?? 0, them = (home ? m.away.score : m.home.score) ?? 0;
  const pens = m.pen[0] != null && m.pen[1] != null ? (home ? (m.pen[0] ?? 0) - (m.pen[1] ?? 0) : (m.pen[1] ?? 0) - (m.pen[0] ?? 0)) : 0;
  const r: 'W' | 'D' | 'L' = us > them || (us === them && pens > 0) ? 'W' : us < them || (us === them && pens < 0) ? 'L' : 'D';
  return { r, us, them, home, opp: home ? m.away : m.home };
}

/** The last five results, oldest on the left: the opponent's crest over the score, coloured by the result. */
function FormRow({ team, form }: { team: ProMatch['home']; form: ProMatch[] }) {
  const list = [...form].reverse();
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <Link to={proPath.team(team.slug)} className="flex min-w-0 shrink-0 items-center gap-2 sm:w-36 text-sm font-medium text-chalk-100 hover:text-pitch-300">
        <TeamLogo src={team.logo} name={team.name} size={20} /><span className="truncate">{team.name}</span>
      </Link>
      {list.length ? (
        <ol className="flex min-w-0 gap-1.5" aria-label={`${team.name}, last ${list.length} results, oldest first`}>
          {list.map((m) => {
            const x = resultFor(m, team.id);
            return (
              <li key={m.id}>
                <Link to={proPath.match(m.slug)} className="flex w-12 flex-col items-center gap-1 rounded-md py-1 hover:bg-field-800 coarse:py-1.5"
                  title={`${shortDate(m.kickoff)}: ${m.home.name} ${m.home.score}–${m.away.score} ${m.away.name} (${m.league.name})`}
                  aria-label={`${x.r === 'W' ? 'Won' : x.r === 'L' ? 'Lost' : 'Drew'} ${x.us}–${x.them} ${x.home ? 'v' : 'at'} ${x.opp.name}`}>
                  <TeamLogo src={x.opp.logo} name={x.opp.name} size={18} />
                  <span className={`w-full rounded px-1 text-center text-xs font-semibold tnum ${TONE[x.r]}`}>{x.us}–{x.them}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : <span className="text-sm text-chalk-500">No results yet</span>}
    </div>
  );
}

/** Head to head from the home side's view: wins, draws, wins as one bar, goals beside, then the meetings. */
function HeadToHead({ m, h2h }: { m: ProMatch; h2h: ProMatch[] }) {
  if (!h2h.length) return <p className="text-sm text-chalk-400">These two have not met in the matches we hold.</p>;
  let hw = 0, d = 0, aw = 0, hg = 0, ag = 0;
  for (const x of h2h) { const r = resultFor(x, m.home.id); hg += r.us; ag += r.them; if (r.r === 'W') hw++; else if (r.r === 'L') aw++; else d++; }
  const n = h2h.length;
  const seg = (v: number, cls: string, label: string) => (v ? <span className={`${cls} flex items-center justify-center text-xs font-semibold text-field-950`} style={{ width: `${(v / n) * 100}%` }} title={label}>{v}</span> : null);
  return (
    <div className="space-y-3">
      <div className="frame space-y-2 p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-medium text-chalk-100"><TeamLogo src={m.home.logo} name={m.home.name} size={18} />{hw} {hw === 1 ? 'win' : 'wins'}</span>
          <span className="text-chalk-400">{d} {d === 1 ? 'draw' : 'draws'}</span>
          <span className="flex items-center gap-2 font-medium text-chalk-100">{aw} {aw === 1 ? 'win' : 'wins'}<TeamLogo src={m.away.logo} name={m.away.name} size={18} /></span>
        </div>
        <div className="flex h-5 overflow-hidden rounded" role="img" aria-label={`Last ${n} meetings: ${m.home.name} ${hw} wins, ${d} draws, ${m.away.name} ${aw} wins`}>
          {seg(hw, 'bg-pitch-400', `${m.home.name} wins`)}{seg(d, 'bg-chalk-500', 'Draws')}{seg(aw, 'bg-sky-400', `${m.away.name} wins`)}
        </div>
        <p className="text-center text-xs text-chalk-400 tnum">Goals {hg}–{ag} in the last {n} {n === 1 ? 'meeting' : 'meetings'}</p>
      </div>
      <div className="frame divide-y divide-field-700 overflow-hidden">{h2h.map((x) => <ProMatchRow key={x.id} m={x} showDate compact />)}</div>
    </div>
  );
}

/** Both clubs' rows of the competition's table. */
function TableRows({ m, table }: { m: ProMatch; table: NonNullable<ProPreview['table']> }) {
  const row = (t: ProMatch['home'], s: Standing | null) => (
    <tr key={t.id}>
      <td className="td w-8 text-center text-chalk-400">{s?.rank ?? '–'}</td>
      <td className="td"><span className="flex items-center gap-2"><TeamLogo src={t.logo} name={t.name} size={18} /><span className="truncate text-chalk-100">{t.name}</span></span></td>
      <td className="td num">{s?.played ?? '–'}</td>
      <td className="td num">{s ? `${s.win ?? 0}-${s.draw ?? 0}-${s.lose ?? 0}` : '–'}</td>
      <td className="td num">{s?.gd != null ? (s.gd > 0 ? `+${s.gd}` : s.gd) : '–'}</td>
      <td className="td num font-semibold text-chalk-100">{s?.points ?? '–'}</td>
    </tr>
  );
  return (
    <div className="space-y-1">
      <div className="frame overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{m.league.name} table, both clubs</caption>
          <thead><tr><th scope="col" className="th text-center">#</th><th scope="col" className="th">Club</th><th scope="col" className="th text-right">P</th><th scope="col" className="th text-right">W-D-L</th><th scope="col" className="th text-right">GD</th><th scope="col" className="th text-right">Pts</th></tr></thead>
          <tbody>{row(m.home, table.home)}{row(m.away, table.away)}</tbody>
        </table>
      </div>
      <p className="text-2xs text-chalk-500">{table.group && table.group !== m.league.name ? `${table.group}, ` : ''}{table.teams} clubs. <Link to={proPath.league(m.league.slug)} className="text-pitch-300 hover:text-pitch-200">Full table</Link></p>
    </div>
  );
}

const COMPARE: [string, string][] = [['form', 'Form'], ['att', 'Attack'], ['def', 'Defence'], ['h2h', 'Head to head'], ['goals', 'Goals'], ['poisson_distribution', 'Goal model'], ['total', 'Overall']];

/** API-Football's chances of each result, and its comparison of the two sides (each row adds up to 100). */
function Chances({ m, p }: { m: ProMatch; p: ProPrediction }) {
  const parts: [string, number | null, string][] = [[m.home.name, p.home_pct, 'bg-pitch-400'], ['Draw', p.draw_pct, 'bg-chalk-500'], [m.away.name, p.away_pct, 'bg-sky-400']];
  const sum = parts.reduce((n, [, v]) => n + (v ?? 0), 0) || 1;
  const rows = COMPARE.filter(([k]) => p.comparison?.[k]);
  return (
    <div className="frame space-y-3 p-3">
      {sum > 1 && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-3 text-sm">
            {parts.map(([label, v], i) => (
              <span key={label} className={`min-w-0 ${i === 0 ? 'text-left' : i === 1 ? 'text-center' : 'text-right'}`}>
                <b className="display text-xl tnum text-chalk-100">{v ?? '–'}%</b><span className="block truncate text-2xs text-chalk-400">{i === 1 ? 'Draw' : `${label} win`}</span>
              </span>
            ))}
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-field-800" role="img" aria-label={`Chances: ${m.home.name} win ${p.home_pct ?? '?'}%, draw ${p.draw_pct ?? '?'}%, ${m.away.name} win ${p.away_pct ?? '?'}%`}>
            {parts.map(([label, v, cls]) => (v ? <span key={label} className={cls} style={{ width: `${(v / sum) * 100}%` }} /> : null))}
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="space-y-1 border-t border-field-700 pt-2">
          {rows.map(([k, label]) => {
            const [h, a] = p.comparison[k]!; const t = (h ?? 0) + (a ?? 0) || 1;
            return (
              <div key={k} className="grid grid-cols-[2.25rem_minmax(0,1fr)_6.5rem_minmax(0,1fr)_2.25rem] items-center gap-2 text-xs tnum">
                <span className={(h ?? 0) > (a ?? 0) ? 'font-semibold text-chalk-100' : 'text-chalk-400'}>{h ?? '–'}%</span>
                <span className="flex h-1.5 justify-end overflow-hidden rounded-full bg-field-800" aria-hidden><span className="rounded-full bg-pitch-400" style={{ width: `${((h ?? 0) / t) * 100}%` }} /></span>
                <span className="truncate text-center text-chalk-400">{label}</span>
                <span className="flex h-1.5 overflow-hidden rounded-full bg-field-800" aria-hidden><span className="rounded-full bg-sky-400/80" style={{ width: `${((a ?? 0) / t) * 100}%` }} /></span>
                <span className={`text-right ${(a ?? 0) > (h ?? 0) ? 'font-semibold text-chalk-100' : 'text-chalk-400'}`}>{a ?? '–'}%</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-2xs text-chalk-500">API-Football's prediction, updated {new Date(p.fetched_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</p>
    </div>
  );
}

const asSide = (x: PreviewSide['last_xi']): ProSideDetail => ({ formation: x?.formation ?? null, coach: x?.coach ?? null, starters: x?.starters ?? [], bench: [], stats: null });

/** Each side's latest starting XI we hold, on one pitch (a list when the provider gave no positions). */
function LastXIs({ m, p }: { m: ProMatch; p: ProPreview }) {
  const h = p.home.last_xi, a = p.away.last_xi;
  if (!h && !a) return <p className="text-sm text-chalk-400">No recent lineups for either club yet.</p>;
  const note = (team: ProMatch['home'], x: PreviewSide['last_xi']) => x
    ? <li key={team.id}><span className="font-medium text-chalk-200">{team.name}</span>{x.formation ? ` ${x.formation}` : ''}, <Link to={proPath.match(x.match.slug)} className="text-pitch-300 hover:text-pitch-200">{x.match.home.id === team.id ? 'v' : 'at'} {x.match.home.id === team.id ? x.match.away.name : x.match.home.name}, {shortDate(x.match.kickoff)}</Link>{x.coach ? `. Coach ${x.coach}` : ''}</li>
    : <li key={team.id}><span className="font-medium text-chalk-200">{team.name}</span>: no recent lineup</li>;
  const placed = [h, a].some((x) => x?.starters.some((s) => s.grid));
  return (
    <div className="space-y-2">
      {placed ? <ProPitch home={asSide(h)} away={asSide(a)} homeName={m.home.name} awayName={m.away.name} /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {h && <LineupList side={asSide(h)} title={m.home.name} />}
          {a && <LineupList side={asSide(a)} title={m.away.name} />}
        </div>
      )}
      <ul className="space-y-0.5 text-xs text-chalk-400">{note(m.home, h)}{note(m.away, a)}</ul>
      <p className="text-2xs text-chalk-500">The clubs' last starting elevens, not announced lineups: those arrive about an hour before kickoff.</p>
    </div>
  );
}

function PeopleList({ team, side }: { team: ProMatch['home']; side: PreviewSide }) {
  return (
    <div className="frame overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-chalk-100"><TeamLogo src={team.logo} name={team.name} size={18} />{team.name}</div>
      <ul className="divide-y divide-field-700 border-t border-field-700 text-sm">
        {side.scorers.map((s) => (
          <li key={`s-${s.id}`} className="flex items-center gap-2 px-3 py-1.5">
            <PlayerAvatar src={s.photo} name={s.name} size={24} />
            {s.slug ? <Link to={proPath.player(s.slug)} className="min-w-0 truncate text-chalk-100 hover:text-pitch-300">{s.name}</Link> : <span className="min-w-0 truncate text-chalk-100">{s.name}</span>}
            <span className="ml-auto shrink-0 text-xs text-chalk-400 tnum"><b className="font-semibold text-chalk-100">{s.goals}</b> G, {s.assists} A in {s.apps}</span>
          </li>
        ))}
        {!side.scorers.length && <li className="px-3 py-2 text-xs text-chalk-500">No goals or assists in this competition yet.</li>}
        {side.out.map((o) => (
          <li key={`o-${o.id}-${o.name}`} className="flex items-center gap-2 px-3 py-1.5">
            <Ambulance size={14} aria-hidden className={/question|doubt/i.test(o.type ?? '') ? 'shrink-0 text-note' : 'shrink-0 text-loss'} />
            {o.slug ? <Link to={proPath.player(o.slug)} className="min-w-0 truncate text-chalk-200 hover:text-pitch-300">{o.name}</Link> : <span className="min-w-0 truncate text-chalk-200">{o.name}</span>}
            <span className="ml-auto shrink-0 text-xs text-chalk-400">{/question|doubt/i.test(o.type ?? '') ? 'Doubtful' : 'Out'}{o.reason ? `: ${o.reason}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MatchPreview({ m, p, h2h }: { m: ProMatch; p: ProPreview; h2h: ProMatch[] }) {
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        {p.prediction && (p.prediction.home_pct != null || Object.keys(p.prediction.comparison ?? {}).length > 0) && <Section title="Chances"><Chances m={m} p={p.prediction} /></Section>}
        <Section title="Form">
          <div className="frame space-y-2 p-3">
            <FormRow team={m.home} form={p.home.form} />
            <FormRow team={m.away} form={p.away.form} />
            <p className="text-2xs text-chalk-500">Last five results in any competition, oldest first.</p>
          </div>
        </Section>
        {p.table && (p.table.home || p.table.away) && <Section title="In the table"><TableRows m={m} table={p.table} /></Section>}
        <Section title="Head to head"><HeadToHead m={m} h2h={h2h} /></Section>
      </div>
      <div className="space-y-5">
        <Section title="Last starting elevens"><LastXIs m={m} p={p} /></Section>
        <Section title={`Top scorers and absences, ${m.league.name}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PeopleList team={m.home} side={p.home} />
            <PeopleList team={m.away} side={p.away} />
          </div>
        </Section>
      </div>
    </div>
  );
}
