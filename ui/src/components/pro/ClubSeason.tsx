// A club's season from the provider's own season stats (teams/statistics): clean sheets, biggest results, streaks,
// penalties, formations used, goals by line and cards by minute; and the club's ground.
import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { fmt } from '../../lib/api';
import type { ProLeagueRef } from '../../lib/pro';
import { Figure, SegmentedControl } from '../primitives';

type Split = { home: number | null; away: number | null; total: number | null };
export interface ClubSeasonRow {
  league: ProLeagueRef | null;
  form: string | null;
  fixtures: Record<string, Split> | null;
  goals: Record<'for' | 'against', { total: Split; average: Record<string, number | null>; minute: Record<string, number | null>; under_over: Record<string, { over: number | null; under: number | null }> }> | null;
  biggest: { streak: Record<string, number | null>; wins: Record<string, string | null>; loses: Record<string, string | null> } | null;
  clean_sheet: Split | null; failed_to_score: Split | null;
  penalty: { scored: number | null; missed: number | null; total: number | null } | null;
  lineups: { formation: string; played: number }[];
  cards: Record<string, Record<string, number | null>> | null;
}
export interface Ground { name: string; city: string | null; capacity: number | null; address: string | null; surface: string | null; image: string | null }

const n = (v: number | null | undefined) => (v == null ? '–' : fmt.num(v));
/** "at home", "away", or "at home; away 0-4" when both exist (scores read home side first). */
const where = (x: Record<string, string | null> | undefined) => (!x ? undefined : x.home && x.away ? `at home; away ${x.away}` : x.home ? 'at home' : x.away ? 'away' : undefined);
const homeAway = (s: Split | null | undefined) => (s ? `home ${n(s.home)}, away ${n(s.away)}` : undefined);

export function ClubSeasonDetail({ rows }: { rows: ClubSeasonRow[] }) {
  const [pick, setPick] = useState(0);
  const r = rows[Math.min(pick, rows.length - 1)];
  if (!r) return null;
  const played = r.fixtures?.played?.total ?? 0;
  const formations = r.lineups.slice(0, 6);
  const maxF = Math.max(1, ...formations.map((f) => f.played));
  const lines = Object.keys(r.goals?.for.under_over ?? {}).sort((a, b) => Number(a) - Number(b));
  // Extra-time windows only when something happened in them.
  const periods = Object.keys(r.cards?.yellow ?? {}).filter((p) => !['91-105', '106-120'].includes(p) || (r.cards?.yellow?.[p] ?? 0) + (r.cards?.red?.[p] ?? 0) > 0);
  const streak = r.biggest?.streak ?? {};
  return (
    <div className="space-y-4">
      {rows.length > 1 && (
        <SegmentedControl label="Competition" size="sm" value={String(pick)} onChange={(v) => setPick(Number(v))}
          options={rows.map((x, i) => ({ value: String(i), label: x.league?.name ?? 'Competition' }))} />
      )}
      <div className="frame grid grid-cols-2 gap-x-4 gap-y-3 p-3 sm:grid-cols-4">
        <Figure label="Clean sheets" value={n(r.clean_sheet?.total)} sub={homeAway(r.clean_sheet)} />
        <Figure label="Failed to score" value={n(r.failed_to_score?.total)} sub={homeAway(r.failed_to_score)} />
        <Figure label="Penalties scored" value={r.penalty?.total ? `${n(r.penalty.scored)}/${n(r.penalty.total)}` : '–'} sub={r.penalty?.missed ? `${r.penalty.missed} missed` : undefined} />
        <Figure label="Goals a game" value={r.goals ? `${r.goals.for.average.total ?? '–'} : ${r.goals.against.average.total ?? '–'}` : '–'} sub="for, against" />
        <Figure label="Biggest win" value={r.biggest?.wins.home ?? r.biggest?.wins.away ?? '–'} sub={where(r.biggest?.wins)} />
        <Figure label="Heaviest loss" value={r.biggest?.loses.home ?? r.biggest?.loses.away ?? '–'} sub={where(r.biggest?.loses)} />
        <Figure label="Longest runs" value={`${n(streak.wins)}W · ${n(streak.draws)}D · ${n(streak.loses)}L`} sub="in a row" />
        <Figure label="Matches" value={n(played)} sub={r.fixtures ? `${n(r.fixtures.wins?.total)}-${n(r.fixtures.draws?.total)}-${n(r.fixtures.loses?.total)}` : undefined} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {formations.length > 0 && (
          <figure className="frame p-3">
            <figcaption className="mb-2 text-xs text-chalk-400">Formations used (starts)</figcaption>
            <ul className="space-y-1.5">
              {formations.map((f) => (
                <li key={f.formation} className="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-2 text-sm">
                  <span className="tnum text-chalk-200">{f.formation}</span>
                  <span className="h-2 overflow-hidden rounded bg-field-700" aria-hidden><span className="block h-full bg-pitch-400" style={{ width: `${(f.played / maxF) * 100}%` }} /></span>
                  <span className="text-right text-xs tnum text-chalk-300">{f.played}</span>
                </li>
              ))}
            </ul>
          </figure>
        )}
        {lines.length > 0 && played > 0 && (
          <div className="frame overflow-x-auto">
            <table className="w-full text-sm"><caption className="px-3 pt-2 text-left text-xs text-chalk-400">Matches scoring or conceding more than</caption>
              <thead><tr className="text-2xs text-chalk-500"><th className="th text-left" scope="col">Goals</th><th className="th text-right" scope="col">Scored over</th><th className="th text-right" scope="col">Conceded over</th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l} className="border-t border-field-700"><th scope="row" className="td text-left font-normal tnum text-chalk-300">{l}</th>
                  <td className="td text-right tnum">{n(r.goals!.for.under_over[l]?.over)}</td><td className="td text-right tnum">{n(r.goals!.against.under_over[l]?.over)}</td></tr>
              ))}</tbody></table>
          </div>
        )}
        {r.cards && periods.length > 0 && (
          <div className="frame overflow-x-auto sm:col-span-2">
            <table className="w-full text-sm"><caption className="px-3 pt-2 text-left text-xs text-chalk-400">Cards by minute</caption>
              <thead><tr className="text-2xs text-chalk-500"><th className="th text-left" scope="col"></th>{periods.map((p) => <th key={p} className="th text-right tnum" scope="col">{p}</th>)}</tr></thead>
              <tbody>
                <tr className="border-t border-field-700"><th scope="row" className="td text-left font-normal text-chalk-300">Yellow</th>{periods.map((p) => <td key={p} className="td text-right tnum">{n(r.cards!.yellow?.[p] ?? 0)}</td>)}</tr>
                <tr className="border-t border-field-700"><th scope="row" className="td text-left font-normal text-chalk-300">Red</th>{periods.map((p) => <td key={p} className="td text-right tnum">{n(r.cards!.red?.[p] ?? 0)}</td>)}</tr>
              </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}

export function GroundCard({ ground }: { ground: Ground }) {
  return (
    <figure className="frame overflow-hidden">
      {ground.image && <img src={ground.image} alt={ground.name} className="aspect-[16/9] w-full object-cover" loading="lazy" />}
      <figcaption className="space-y-0.5 px-3 py-2 text-sm">
        <span className="block font-medium text-chalk-100">{ground.name}</span>
        {(ground.address || ground.city) && <span className="flex items-center gap-1 text-xs text-chalk-400"><MapPin size={12} aria-hidden />{[ground.address, ground.city].filter(Boolean).join(', ')}</span>}
        <span className="block text-xs text-chalk-400">{[ground.capacity ? `${fmt.num(ground.capacity)} seats` : null, ground.surface ? cap(ground.surface) : null].filter(Boolean).join(' · ')}</span>
      </figcaption>
    </figure>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
