// Match page pieces for Plaibook Live Pro: the event timeline, both elevens on a pitch (the provider's formation
// grid), the side-by-side team stats and a lineup list.
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Square } from 'lucide-react';
import { PlayerAvatar, RailCard } from '../primitives';
import { RatingBadge } from '../Rating';
import { Goals } from '../icons';
import { proPath } from '../../lib/pro';

export interface ProEvent { seq: number; minute: number | null; extra: number | null; side: 'home' | 'away' | null; player_name: string | null; player_slug: string | null; assist_name: string | null; type: string; detail: string | null; comments: string | null }
export interface ProLine { slot: number; player_id: number | null; name: string; display: string; slug: string | null; photo: string | null; number: number | null; pos: string | null; grid: string | null; starter: boolean; captain: boolean; minutes: number | null; rating: number | null; goals: number | null; assists: number | null; yellow: number | null; red: number | null; saves: number | null; conceded: number | null; shots: number | null; shots_on: number | null; passes: number | null; key_passes: number | null; tackles: number | null }
export interface ProSideDetail { formation: string | null; coach: string | null; starters: ProLine[]; bench: ProLine[]; stats: Record<string, number | null> | null }

const minute = (e: Pick<ProEvent, 'minute' | 'extra'>) => (e.minute == null ? '' : e.minute < 0 ? 'Pre' : `${e.minute}${e.extra ? `+${e.extra}` : ''}′`);

function EventIcon({ e }: { e: ProEvent }) {
  if (e.type === 'goal') return <span className={e.detail === 'Missed Penalty' || e.comments === 'Penalty Shootout' ? 'opacity-40' : ''}><Goals n={1} size={14} /></span>;
  if (e.type === 'card') return <Square size={12} aria-hidden className={/red/i.test(e.detail ?? '') ? 'fill-loss text-loss' : 'fill-note text-note'} />;
  if (e.type === 'subst') return <ArrowLeftRight size={13} aria-hidden className="text-chalk-400" />;
  return <span aria-hidden className="rounded bg-field-700 px-1 text-2xs font-semibold leading-4 text-chalk-200">VAR</span>;
}

/** The event as two lines: who (bold) and what else (the assist, who went off, the card's reason). */
function eventLines(e: ProEvent): [string, string | null] {
  if (e.type === 'goal') {
    // Shootout kicks come as goal events marked 'Penalty Shootout'; they are not goals.
    if (e.comments === 'Penalty Shootout') return [e.player_name ?? 'Kick', `Shootout, ${e.detail === 'Missed Penalty' ? 'missed' : 'scored'}`];
    const kind = e.detail === 'Own Goal' ? ' (own goal)' : e.detail === 'Penalty' ? ' (pen)' : e.detail === 'Missed Penalty' ? ' (missed pen)' : '';
    return [`${e.player_name ?? 'Goal'}${kind}`, e.assist_name && e.detail !== 'Own Goal' ? `Assist ${e.assist_name}` : null];
  }
  if (e.type === 'card') return [e.player_name ?? '', e.comments ? e.comments : null];
  // Substitutions: the provider names the player coming off as `player` and the one coming on as `assist`.
  if (e.type === 'subst') return [`${e.assist_name ?? '?'} on`, `${e.player_name ?? '?'} off`];
  return [e.detail ?? 'VAR', e.player_name];
}

/** Goals, cards, substitutions and VAR in match order. Phones: one column (minute, icon, who and what), the side shown
 *  by a coloured bar and the club's name; wider screens: home events on the left, away on the right. A half-time line
 *  splits the halves. */
export function EventTimeline({ events, homeName, awayName, ht }: { events: ProEvent[]; homeName: string; awayName: string; ht?: [number | null, number | null] }) {
  if (!events.length) return <p className="text-sm text-chalk-400">No events recorded for this match.</p>;
  // In match order: the feed lists late cards and stoppage-time events out of turn (90+9 before 90+6, a 90th-minute goal last).
  const sorted = [...events].sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999) || (a.extra ?? 0) - (b.extra ?? 0) || a.seq - b.seq);
  const htAt = sorted.findIndex((e) => (e.minute ?? 0) > 45);
  return (
    <ol className="card divide-y divide-field-700/70 overflow-hidden" aria-label="Match events">
      {sorted.map((e, i) => {
        const [main, more] = eventLines(e);
        const label = `${minute(e)} ${e.type === 'goal' ? 'Goal' : e.type === 'card' ? e.detail : e.type === 'subst' ? 'Substitution' : 'VAR'}, ${e.side === 'home' ? homeName : e.side === 'away' ? awayName : ''}: ${main}${more ? `, ${more}` : ''}`;
        const who = e.player_slug && e.type !== 'subst' ? <Link to={proPath.player(e.player_slug)} className="hover:text-pitch-300">{main}</Link> : main;
        const goal = e.type === 'goal';
        const text = (align: 'left' | 'right') => (
          <span className={`min-w-0 ${align === 'right' ? 'text-right' : ''}`}>
            <span className={`block text-sm ${goal ? 'font-semibold text-chalk-100' : 'font-medium text-chalk-200'}`}>{who}</span>
            {more && <span className="block text-xs text-chalk-400">{more}</span>}
          </span>
        );
        const away = e.side === 'away';
        return (
          <li key={e.seq} aria-label={label} className={goal ? 'bg-pitch-400/[0.04]' : ''}>
            {i === htAt && htAt > 0 && <div className="border-b border-field-700/70 bg-field-950/40 px-4 py-1.5 text-center text-2xs font-medium text-chalk-400">Half time{ht && ht[0] != null ? ` ${ht[0]}–${ht[1]}` : ''}</div>}
            {/* Phones */}
            <div className={`flex items-start gap-3 border-l-[3px] py-2.5 pl-3 pr-4 sm:hidden ${away ? 'border-away' : e.side === 'home' ? 'border-pitch-400' : 'border-transparent'}`}>
              <span className="w-10 shrink-0 pt-0.5 text-xs font-medium tnum text-chalk-400">{minute(e)}</span>
              <span className="flex w-5 shrink-0 justify-center pt-0.5"><EventIcon e={e} /></span>
              <span className="min-w-0 flex-1">{text('left')}</span>
              <span className="max-w-[30%] shrink-0 truncate pt-0.5 text-2xs text-chalk-500">{away ? awayName : e.side === 'home' ? homeName : ''}</span>
            </div>
            {/* Wider screens */}
            <div className="hidden grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)] items-center gap-3 px-4 py-2 sm:grid">
              <span className="flex min-w-0 items-center justify-end gap-2.5">{!away && <>{text('right')}<span className="flex w-5 shrink-0 justify-center"><EventIcon e={e} /></span></>}</span>
              <span className="rounded bg-field-950/50 py-0.5 text-center text-xs font-medium tnum text-chalk-300">{minute(e)}</span>
              <span className="flex min-w-0 items-center gap-2.5">{away && <><span className="flex w-5 shrink-0 justify-center"><EventIcon e={e} /></span>{text('left')}</>}</span>
            </div>
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
  return parsed.map((p) => ({ line: p!.line, x: 1 - p!.col / ((perRow.get(p!.row) ?? 1) + 1), y: rows === 1 ? 0.5 : 0.15 + (0.71 * (p!.row - 1)) / (rows - 1) }));
}

function Token({ line, x, y, top, full, crest, to }: { line: ProLine; x: number; y: number; top: boolean; full?: boolean; crest?: string | null; to?: string | null }) {
  const last = line.display.split(/\s+/).slice(-1)[0] ?? line.display;
  const style = { left: `${(top ? 1 - x : x) * 100}%`, top: `${(full ? 1 - (0.06 + y * 0.88) : top ? y / 2 : 1 - y / 2) * 100}%` };
  const body = (
    <>
      <span className="relative block">
        <PlayerAvatar src={line.photo} name={line.display} size={36} crest={crest} />
        <span className="absolute -bottom-1 -right-1 rounded bg-field-950 px-1 text-2xs font-semibold leading-4 text-chalk-100 tnum shadow" aria-hidden>{line.number ?? ''}</span>
        {(line.goals ?? 0) > 0 && <span className="absolute -right-2 -top-1 flex items-center rounded-full bg-white px-0.5 text-field-950 shadow" aria-hidden><Goals n={line.goals!} size={11} /></span>}
        {(line.red ?? 0) > 0 ? <span aria-hidden className="absolute -left-1 -top-1 h-3 w-2 rounded-sm bg-loss" /> : (line.yellow ?? 0) > 0 ? <span aria-hidden className="absolute -left-1 -top-1 h-3 w-2 rounded-sm bg-note" /> : null}
      </span>
      <span className="mt-1 block max-w-[84px] truncate text-center text-2xs font-medium text-white drop-shadow">{last}</span>
      {line.rating != null && line.rating > 0 && <RatingBadge v={line.rating} size="xs" className="mt-0.5" />}
    </>
  );
  const cls = 'absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center rounded focus-visible:outline-2';
  const label = `${line.number ?? ''} ${line.display}${line.goals ? `, ${line.goals} goal${line.goals > 1 ? 's' : ''}` : ''}${line.rating != null ? `, rating ${line.rating}` : ''}`;
  const href = to !== undefined ? to : line.slug ? proPath.player(line.slug) : null;
  return href ? <Link to={href} className={cls} style={style} aria-label={label}>{body}</Link> : <span className={cls} style={style} aria-label={label}>{body}</span>;
}

export function ProPitch({ home, away, homeName, awayName }: { home: ProSideDetail; away: ProSideDetail; homeName: string; awayName: string }) {
  const hs = place(home.starters), as = place(away.starters);
  if (!hs.length && !as.length) return null;
  return (
    <figure className="mx-auto w-full max-w-md">
      <div className="relative w-full overflow-hidden rounded-xl border border-field-700 bg-turf-900" style={{ aspectRatio: '68 / 105' }} role="img" aria-label={`${awayName} (${away.formation ?? 'no formation'}) at the top, ${homeName} (${home.formation ?? 'no formation'}) at the bottom`}>
        <svg viewBox="0 0 68 105" className="absolute inset-0 h-full w-full" aria-hidden>
          <g fill="none" className="stroke-turf-600" strokeWidth="0.6">
            <rect x="1" y="1" width="66" height="103" /><line x1="1" y1="52.5" x2="67" y2="52.5" /><circle cx="34" cy="52.5" r="9.15" />
            <rect x="13.84" y="1" width="40.32" height="16.5" /><rect x="24.84" y="1" width="18.32" height="5.5" />
            <rect x="13.84" y="87.5" width="40.32" height="16.5" /><rect x="24.84" y="98.5" width="18.32" height="5.5" />
          </g>
        </svg>
        <span className="absolute left-2 top-2 rounded bg-field-950/70 px-1.5 py-0.5 text-2xs font-medium text-chalk-200">{awayName}{away.formation ? ` · ${away.formation}` : ''}</span>
        <span className="absolute bottom-2 left-2 rounded bg-field-950/70 px-1.5 py-0.5 text-2xs font-medium text-chalk-200">{homeName}{home.formation ? ` · ${home.formation}` : ''}</span>
        {as.map((p) => <Token key={`a-${p.line.slot}`} line={p.line} x={p.x} y={p.y} top />)}
        {hs.map((p) => <Token key={`h-${p.line.slot}`} line={p.line} x={p.x} y={p.y} top={false} />)}
      </div>
    </figure>
  );
}

/** One XI on a whole pitch (Team of the week): the keeper at the bottom, each player with their club's crest. */
export function XIPitch({ lines, label, crests, linkOf }: { lines: ProLine[]; label: string; crests?: Map<number, string | null>; linkOf?: (l: ProLine) => string | null }) {
  const ps = place(lines);
  if (!ps.length) return null;
  return (
    <figure className="mx-auto w-full max-w-md">
      <div className="relative w-full overflow-hidden rounded-xl border border-field-700 bg-turf-900" style={{ aspectRatio: '68 / 90' }} role="img" aria-label={label}>
        <svg viewBox="0 0 68 90" className="absolute inset-0 h-full w-full" aria-hidden>
          <g fill="none" className="stroke-turf-600" strokeWidth="0.6">
            <rect x="1" y="1" width="66" height="88" /><circle cx="34" cy="1" r="9.15" /><rect x="13.84" y="72.5" width="40.32" height="16.5" /><rect x="24.84" y="83.5" width="18.32" height="5.5" />
          </g>
        </svg>
        {ps.map((p) => <Token key={p.line.slot} line={p.line} x={p.x} y={p.y} top={false} full crest={crests?.get(p.line.slot) ?? null} to={linkOf ? linkOf(p.line) : undefined} />)}
      </div>
    </figure>
  );
}

const STAT_ROWS: [string, string, (v: number | null) => string][] = [
  ['possession', 'Possession', (v) => (v == null ? '–' : `${Math.round(v)}%`)],
  ['xg', 'Expected goals (xG)', (v) => (v == null ? '–' : v.toFixed(2))],
  ['shots', 'Shots', (v) => (v == null ? '–' : String(v))],
  ['shots_on', 'Shots on target', (v) => (v == null ? '–' : String(v))],
  ['shots_off', 'Shots off target', (v) => (v == null ? '–' : String(v))],
  ['shots_blocked', 'Blocked shots', (v) => (v == null ? '–' : String(v))],
  ['shots_inside', 'Shots inside the box', (v) => (v == null ? '–' : String(v))],
  ['shots_outside', 'Shots outside the box', (v) => (v == null ? '–' : String(v))],
  ['corners', 'Corners', (v) => (v == null ? '–' : String(v))],
  ['fouls', 'Fouls', (v) => (v == null ? '–' : String(v))],
  ['offsides', 'Offsides', (v) => (v == null ? '–' : String(v))],
  ['saves', 'Saves', (v) => (v == null ? '–' : String(v))],
  ['passes', 'Passes', (v) => (v == null ? '–' : String(v))],
  ['passes_accurate', 'Accurate passes', (v) => (v == null ? '–' : String(v))],
  ['pass_pct', 'Pass accuracy', (v) => (v == null ? '–' : `${Math.round(v)}%`)],
  ['yellow', 'Yellow cards', (v) => (v == null ? '–' : String(v))],
  ['red', 'Red cards', (v) => (v == null ? '–' : String(v))],
];

export function TeamStatsCompare({ home, away, homeName, awayName }: { home: ProSideDetail['stats']; away: ProSideDetail['stats']; homeName: string; awayName: string }) {
  if (!home && !away) return null;
  const rows = STAT_ROWS.filter(([k]) => home?.[k] != null || away?.[k] != null);
  return (
    <div className="card py-2">
      <div className="flex justify-between gap-4 px-4 pb-2 pt-1 text-xs font-semibold"><span className="flex min-w-0 items-center gap-1.5 text-pitch-300"><span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-pitch-400" /><span className="truncate">{homeName}</span></span><span className="flex min-w-0 items-center gap-1.5 text-away"><span className="truncate">{awayName}</span><span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-away" /></span></div>
      {/* One line a stat: value, a bar growing toward the label from each side, value. The larger value reads brighter. */}
      {rows.map(([k, label, f]) => {
        const h = home?.[k] ?? null, a = away?.[k] ?? null; const total = (h ?? 0) + (a ?? 0);
        const hs = total > 0 ? (h ?? 0) / total : 0, as = total > 0 ? (a ?? 0) / total : 0;
        // Lower is better for these: the pill goes to the smaller number.
        const low = k === 'fouls' || k === 'yellow' || k === 'red' || k === 'offsides';
        const wins = (mine: number | null, theirs: number | null) => mine != null && theirs != null && mine !== theirs && (low ? mine < theirs : mine > theirs);
        const val = (mine: number | null, theirs: number | null, cls: string) => <span className={`inline-block min-w-[2.25rem] rounded px-1.5 py-0.5 text-center ${wins(mine, theirs) ? `font-semibold ${cls}` : 'text-chalk-300'}`}>{f(mine)}</span>;
        return (
          <div key={k} className="px-4 py-2">
            <div className="flex items-center justify-between gap-2 text-sm tnum">
              {val(h, a, 'bg-pitch-400 text-field-950')}
              <span className="truncate text-center text-xs text-chalk-400">{label}</span>
              {val(a, h, 'bg-away text-field-950')}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5" aria-hidden>
              <span className="flex h-1.5 justify-end overflow-hidden rounded-full bg-field-800"><span className={`rounded-full bg-pitch-400 ${wins(a, h) ? 'opacity-50' : ''}`} style={{ width: `${hs * 100}%` }} /></span>
              <span className="flex h-1.5 overflow-hidden rounded-full bg-field-800"><span className={`rounded-full bg-away ${wins(h, a) ? 'opacity-50' : ''}`} style={{ width: `${as * 100}%` }} /></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LineupList({ side, title }: { side: ProSideDetail; title: string }) {
  const row = (l: ProLine) => (
    <li key={l.slot} className="flex items-center gap-2 px-4 py-2 text-sm coarse:min-h-11">
      <span className="w-6 shrink-0 text-right text-xs tnum text-chalk-500">{l.number ?? ''}</span>
      {l.slug ? <Link to={proPath.player(l.slug)} className="min-w-0 truncate text-chalk-100 hover:text-pitch-300">{l.display}</Link> : <span className="min-w-0 truncate text-chalk-200">{l.display}</span>}
      {l.captain && <span className="text-2xs text-chalk-500" title="Captain">(c)</span>}
      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs tnum text-chalk-400">
        {(l.goals ?? 0) > 0 && <Goals n={l.goals!} size={12} />}
        {(l.minutes ?? 0) > 0 && <span title="Minutes">{l.minutes}′</span>}
        {l.rating != null && l.rating > 0 && <RatingBadge v={l.rating} label="Match rating" />}
      </span>
    </li>
  );
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-chalk-100"><span>{title}</span><span className="text-xs font-normal text-chalk-400">{side.formation ?? ''}{side.coach ? ` · Coach ${side.coach}` : ''}</span></div>
      <ul className="divide-y divide-field-700 border-t border-field-700">{side.starters.map(row)}</ul>
      {side.bench.length > 0 && <><div className="border-t border-field-700 bg-field-950/40 px-4 py-1.5 text-2xs font-medium text-chalk-500">Bench</div><ul className="divide-y divide-field-700">{side.bench.map(row)}</ul></>}
    </div>
  );
}

/** Player of the match: the best rating among those who played 45 minutes or more (else anyone rated), with the next
 *  two; while the match is played, "top rated so far". Nothing when the match has no ratings. */
export function PlayerOfMatch({ home, away, homeName, awayName, homeLogo, awayLogo, live }: { home: ProSideDetail; away: ProSideDetail; homeName: string; awayName: string; homeLogo?: string | null; awayLogo?: string | null; live: boolean }) {
  const all = [...home.starters, ...home.bench].map((l) => ({ l, team: homeName, logo: homeLogo })).concat([...away.starters, ...away.bench].map((l) => ({ l, team: awayName, logo: awayLogo })))
    .filter((x) => x.l.rating != null && x.l.rating > 0);
  if (!all.length) return null;
  const long = all.filter((x) => (x.l.minutes ?? 0) >= 45);
  const pool = (long.length ? long : all).sort((a, b) => b.l.rating! - a.l.rating! || (b.l.goals ?? 0) + (b.l.assists ?? 0) - (a.l.goals ?? 0) - (a.l.assists ?? 0));
  const [best, ...next] = pool;
  const line = (x: (typeof all)[number]) => [x.team, x.l.goals ? `${x.l.goals} goal${x.l.goals > 1 ? 's' : ''}` : null, x.l.assists ? `${x.l.assists} assist${x.l.assists > 1 ? 's' : ''}` : null, x.l.minutes != null ? `${x.l.minutes} min` : null].filter(Boolean).join(', ');
  const name = (x: (typeof all)[number]) => (x.l.slug ? <Link to={proPath.player(x.l.slug)} className="hover:text-pitch-300">{x.l.display}</Link> : x.l.display);
  return (
    <RailCard title={live ? 'Top rated so far' : 'Player of the match'}>
      <div className="flex items-center gap-3">
        <PlayerAvatar src={best!.l.photo} name={best!.l.display} size={48} crest={best!.logo ?? null} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-chalk-100">{name(best!)}</p>
          <p className="truncate text-xs text-chalk-400">{line(best!)}</p>
        </div>
        <RatingBadge v={best!.l.rating!} size="lg" />
      </div>
      {next.length > 0 && (
        <ol className="mt-2 space-y-1 border-t border-field-700 pt-2 text-sm">
          {next.slice(0, 2).map((x) => (
            <li key={`${x.team}-${x.l.slot}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-chalk-200">{name(x)} <span className="text-xs text-chalk-500">{x.team}</span></span>
              <RatingBadge v={x.l.rating!} />
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-2xs text-chalk-500">From the match data's player ratings{long.length ? ', 45 minutes or more' : ''}.</p>
    </RailCard>
  );
}
