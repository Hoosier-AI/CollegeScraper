// Match page pieces for Plaibook Stats Pro: the event timeline, both elevens on a pitch (the provider's formation
// grid), the side-by-side team stats and a lineup list.
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Square } from 'lucide-react';
import { PlayerAvatar } from '../primitives';
import { Goals } from '../icons';
import { proPath } from '../../lib/pro';

export interface ProEvent { seq: number; minute: number | null; extra: number | null; side: 'home' | 'away' | null; player_name: string | null; player_slug: string | null; assist_name: string | null; type: string; detail: string | null; comments: string | null }
export interface ProLine { slot: number; player_id: number | null; name: string; display: string; slug: string | null; photo: string | null; number: number | null; pos: string | null; grid: string | null; starter: boolean; captain: boolean; minutes: number | null; rating: number | null; goals: number | null; assists: number | null; yellow: number | null; red: number | null; saves: number | null; conceded: number | null; shots: number | null; shots_on: number | null; passes: number | null; key_passes: number | null; tackles: number | null }
export interface ProSideDetail { formation: string | null; coach: string | null; starters: ProLine[]; bench: ProLine[]; stats: Record<string, number | null> | null }

const minute = (e: Pick<ProEvent, 'minute' | 'extra'>) => (e.minute == null ? '' : `${e.minute}${e.extra ? `+${e.extra}` : ''}′`);

function EventIcon({ e }: { e: ProEvent }) {
  if (e.type === 'goal') return <span className={e.detail === 'Missed Penalty' ? 'opacity-40' : ''}><Goals n={1} size={14} /></span>;
  if (e.type === 'card') return <Square size={12} aria-hidden className={/red/i.test(e.detail ?? '') ? 'fill-loss text-loss' : 'fill-note text-note'} />;
  if (e.type === 'subst') return <ArrowLeftRight size={13} aria-hidden className="text-chalk-400" />;
  return <span aria-hidden className="rounded bg-field-700 px-1 text-[9px] font-semibold text-chalk-200">VAR</span>;
}

function eventText(e: ProEvent): string {
  if (e.type === 'goal') {
    const kind = e.detail === 'Own Goal' ? ' (own goal)' : e.detail === 'Penalty' ? ' (pen)' : e.detail === 'Missed Penalty' ? ' (missed pen)' : '';
    return `${e.player_name ?? 'Goal'}${kind}${e.assist_name && e.detail !== 'Own Goal' ? `, assist ${e.assist_name}` : ''}`;
  }
  if (e.type === 'card') return `${e.player_name ?? ''}${e.comments ? ` (${e.comments.toLowerCase()})` : ''}`;
  // Substitutions: the provider names the player coming off as `player` and the one coming on as `assist`.
  if (e.type === 'subst') return `${e.assist_name ?? '?'} on, ${e.player_name ?? '?'} off`;
  return `${e.detail ?? 'VAR'}${e.player_name ? `: ${e.player_name}` : ''}`;
}

export function EventTimeline({ events, homeName, awayName }: { events: ProEvent[]; homeName: string; awayName: string }) {
  if (!events.length) return <p className="text-sm text-chalk-400">No events recorded for this match.</p>;
  return (
    <ol className="frame divide-y divide-field-700" aria-label="Match events">
      {events.map((e) => {
        const label = `${minute(e)} ${e.type === 'goal' ? 'Goal' : e.type === 'card' ? e.detail : e.type === 'subst' ? 'Substitution' : 'VAR'}, ${e.side === 'home' ? homeName : e.side === 'away' ? awayName : ''}: ${eventText(e)}`;
        const text = e.player_slug && e.type !== 'subst' ? <Link to={proPath.player(e.player_slug)} className="hover:text-pitch-300">{eventText(e)}</Link> : eventText(e);
        return (
          <li key={e.seq} className={`flex items-center gap-2 px-3 py-2 text-sm ${e.side === 'away' ? 'flex-row-reverse text-right' : ''} ${e.type === 'goal' ? 'text-chalk-100' : 'text-chalk-300'}`} aria-label={label}>
            <span className="w-12 shrink-0 text-center text-xs tnum text-chalk-500">{minute(e)}</span>
            <span className="flex w-5 shrink-0 justify-center"><EventIcon e={e} /></span>
            <span className="min-w-0 truncate">{text}</span>
          </li>
        );
      })}
    </ol>
  );
}

const BAND_ROW: Record<string, number> = { G: 1, D: 2, M: 3, F: 4 };
/** "row:col" from the provider, or (when any player lacks one) rows by position group, spread evenly. */
function grids(lines: ProLine[]): ({ line: ProLine; row: number; col: number } | null)[] {
  const given = lines.map((l) => { const m = /^(\d+):(\d+)$/.exec(l.grid ?? ''); return m ? { line: l, row: Number(m[1]), col: Number(m[2]) } : null; });
  if (given.every(Boolean)) return given;
  const rows = new Map<number, ProLine[]>();
  for (const l of lines) { const r = BAND_ROW[(l.pos ?? '').toUpperCase()]; if (r) rows.set(r, [...(rows.get(r) ?? []), l]); }
  if ([...rows.values()].reduce((n, r) => n + r.length, 0) < lines.length) return [];
  return [...rows.entries()].flatMap(([row, ls]) => ls.map((line, i) => ({ line, row, col: i + 1 })));
}

/** Starters placed by the provider's "row:col" grid: row 1 is the keeper, the last row the forwards. */
function place(lines: ProLine[]): { line: ProLine; x: number; y: number }[] {
  const parsed = grids(lines);
  if (!parsed.length || parsed.some((p) => !p)) return [];
  const rows = Math.max(...parsed.map((p) => p!.row));
  const perRow = new Map<number, number>();
  for (const p of parsed) perRow.set(p!.row, Math.max(perRow.get(p!.row) ?? 0, p!.col));
  return parsed.map((p) => ({ line: p!.line, x: 1 - p!.col / ((perRow.get(p!.row) ?? 1) + 1), y: rows === 1 ? 0.5 : 0.08 + (0.84 * (p!.row - 1)) / (rows - 1) }));
}

function Token({ line, x, y, top }: { line: ProLine; x: number; y: number; top: boolean }) {
  const last = line.display.split(/\s+/).slice(-1)[0] ?? line.display;
  const style = { left: `${(top ? 1 - x : x) * 100}%`, top: `${(top ? y / 2 : 1 - y / 2) * 100}%` };
  const body = (
    <>
      <span className="relative block">
        <PlayerAvatar src={line.photo} name={line.display} size={36} />
        <span className="absolute -bottom-1 -right-1 rounded bg-field-950 px-1 text-[10px] font-semibold text-chalk-100 tnum shadow" aria-hidden>{line.number ?? ''}</span>
        {(line.goals ?? 0) > 0 && <span className="absolute -right-2 -top-1 flex items-center rounded-full bg-white px-0.5 text-field-950 shadow" aria-hidden><Goals n={line.goals!} size={11} /></span>}
        {(line.red ?? 0) > 0 ? <span aria-hidden className="absolute -left-1 -top-1 h-3 w-2 rounded-sm bg-loss" /> : (line.yellow ?? 0) > 0 ? <span aria-hidden className="absolute -left-1 -top-1 h-3 w-2 rounded-sm bg-note" /> : null}
      </span>
      <span className="mt-1 block max-w-[72px] truncate text-center text-[11px] font-medium text-white drop-shadow">{last}</span>
      {line.rating != null && line.rating > 0 && <span className="text-[10px] tnum text-chalk-200">{line.rating.toFixed(1)}</span>}
    </>
  );
  const cls = 'absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center rounded focus-visible:outline-2';
  const label = `${line.number ?? ''} ${line.display}${line.goals ? `, ${line.goals} goal${line.goals > 1 ? 's' : ''}` : ''}${line.rating != null ? `, rating ${line.rating}` : ''}`;
  return line.slug ? <Link to={proPath.player(line.slug)} className={cls} style={style} aria-label={label}>{body}</Link> : <span className={cls} style={style} aria-label={label}>{body}</span>;
}

export function ProPitch({ home, away, homeName, awayName }: { home: ProSideDetail; away: ProSideDetail; homeName: string; awayName: string }) {
  const hs = place(home.starters), as = place(away.starters);
  if (!hs.length && !as.length) return null;
  return (
    <figure className="mx-auto w-full max-w-md">
      <div className="relative w-full overflow-hidden rounded-xl border border-field-700" style={{ aspectRatio: '68 / 105', background: '#123b26' }} role="img" aria-label={`${awayName} (${away.formation ?? 'no formation'}) at the top, ${homeName} (${home.formation ?? 'no formation'}) at the bottom`}>
        <svg viewBox="0 0 68 105" className="absolute inset-0 h-full w-full" aria-hidden>
          <g fill="none" stroke="#2c6b46" strokeWidth="0.6">
            <rect x="1" y="1" width="66" height="103" /><line x1="1" y1="52.5" x2="67" y2="52.5" /><circle cx="34" cy="52.5" r="9.15" />
            <rect x="13.84" y="1" width="40.32" height="16.5" /><rect x="24.84" y="1" width="18.32" height="5.5" />
            <rect x="13.84" y="87.5" width="40.32" height="16.5" /><rect x="24.84" y="98.5" width="18.32" height="5.5" />
          </g>
        </svg>
        <span className="absolute left-2 top-2 rounded bg-field-950/70 px-1.5 py-0.5 text-[10px] font-medium text-chalk-200">{awayName}{away.formation ? ` · ${away.formation}` : ''}</span>
        <span className="absolute bottom-2 left-2 rounded bg-field-950/70 px-1.5 py-0.5 text-[10px] font-medium text-chalk-200">{homeName}{home.formation ? ` · ${home.formation}` : ''}</span>
        {as.map((p) => <Token key={`a-${p.line.slot}`} line={p.line} x={p.x} y={p.y} top />)}
        {hs.map((p) => <Token key={`h-${p.line.slot}`} line={p.line} x={p.x} y={p.y} top={false} />)}
      </div>
    </figure>
  );
}

const STAT_ROWS: [string, string, (v: number | null) => string][] = [
  ['possession', 'Possession', (v) => (v == null ? '–' : `${Math.round(v)}%`)],
  ['xg', 'Expected goals (xG)', (v) => (v == null ? '–' : v.toFixed(2))],
  ['shots', 'Shots', (v) => (v == null ? '–' : String(v))],
  ['shots_on', 'Shots on target', (v) => (v == null ? '–' : String(v))],
  ['corners', 'Corners', (v) => (v == null ? '–' : String(v))],
  ['fouls', 'Fouls', (v) => (v == null ? '–' : String(v))],
  ['offsides', 'Offsides', (v) => (v == null ? '–' : String(v))],
  ['saves', 'Saves', (v) => (v == null ? '–' : String(v))],
  ['passes', 'Passes', (v) => (v == null ? '–' : String(v))],
  ['pass_pct', 'Pass accuracy', (v) => (v == null ? '–' : `${Math.round(v)}%`)],
  ['yellow', 'Yellow cards', (v) => (v == null ? '–' : String(v))],
  ['red', 'Red cards', (v) => (v == null ? '–' : String(v))],
];

export function TeamStatsCompare({ home, away, homeName, awayName }: { home: ProSideDetail['stats']; away: ProSideDetail['stats']; homeName: string; awayName: string }) {
  if (!home && !away) return null;
  const rows = STAT_ROWS.filter(([k]) => home?.[k] != null || away?.[k] != null);
  return (
    <div className="frame divide-y divide-field-700">
      <div className="flex justify-between px-3 py-1.5 text-2xs font-medium text-chalk-500"><span>{homeName}</span><span>{awayName}</span></div>
      {rows.map(([k, label, f]) => {
        const h = home?.[k] ?? null, a = away?.[k] ?? null; const total = (h ?? 0) + (a ?? 0);
        const share = total > 0 ? (h ?? 0) / total : 0.5;
        return (
          <div key={k} className="px-3 py-2 text-sm">
            <div className="flex items-center justify-between tnum"><span className="font-medium text-chalk-100">{f(h)}</span><span className="text-xs text-chalk-400">{label}</span><span className="font-medium text-chalk-100">{f(a)}</span></div>
            <div className="mt-1 flex h-1.5 overflow-hidden rounded bg-field-700" aria-hidden><span className="bg-pitch-400" style={{ width: `${share * 100}%` }} /><span className="flex-1 bg-sky-400/70" /></div>
          </div>
        );
      })}
    </div>
  );
}

export function LineupList({ side, title }: { side: ProSideDetail; title: string }) {
  const row = (l: ProLine) => (
    <li key={l.slot} className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <span className="w-6 shrink-0 text-right text-xs tnum text-chalk-500">{l.number ?? ''}</span>
      {l.slug ? <Link to={proPath.player(l.slug)} className="min-w-0 truncate text-chalk-100 hover:text-pitch-300">{l.display}</Link> : <span className="min-w-0 truncate text-chalk-200">{l.display}</span>}
      {l.captain && <span className="text-2xs text-chalk-500" title="Captain">(c)</span>}
      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs tnum text-chalk-400">
        {(l.goals ?? 0) > 0 && <Goals n={l.goals!} size={12} />}
        {(l.minutes ?? 0) > 0 && <span title="Minutes">{l.minutes}′</span>}
        {l.rating != null && l.rating > 0 && <span className={`rounded px-1 font-semibold ${l.rating >= 7.5 ? 'bg-win/20 text-win' : l.rating < 6.3 ? 'bg-loss/15 text-loss' : 'bg-field-700 text-chalk-200'}`} title="Match rating">{l.rating.toFixed(1)}</span>}
      </span>
    </li>
  );
  return (
    <div className="frame">
      <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold text-chalk-100"><span>{title}</span><span className="text-xs font-normal text-chalk-400">{side.formation ?? ''}{side.coach ? ` · Coach ${side.coach}` : ''}</span></div>
      <ul className="divide-y divide-field-700 border-t border-field-700">{side.starters.map(row)}</ul>
      {side.bench.length > 0 && <><div className="border-t border-field-700 px-3 py-1.5 text-2xs font-medium text-chalk-500">Bench</div><ul className="divide-y divide-field-700">{side.bench.map(row)}</ul></>}
    </div>
  );
}
