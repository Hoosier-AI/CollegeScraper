// Head to head between two college programs (/h2h?a=&b=, program ids): every finished meeting we hold, the record
// from the first team's side, where they won, the biggest wins and the current run. Same layout as International's.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, ApiError, fmt, qs } from '../lib/api';
import { genderLabel, useFilters, useHref } from '../lib/filters';
import { useUrlPatch, useUrlState } from '../lib/urlState';
import { MatchRow, type MatchLike } from '../components/match/MatchRow';
import { EmptyState, ErrorBox, PageHeader, Skeleton, TeamLogo } from '../components/primitives';
import { StatTile } from '../components/pro/Hero';

interface Prog { id: string; name: string; gender: 'm' | 'w'; seo: string | null; logo: string | null }
type Rec = { w: number; l: number; t: number };
interface Summary { played: number; home_wins: number; away_wins: number; ties: number; home_goals: number; away_goals: number; at_home: Rec; at_away: Rec; at_neutral: Rec; first_season: number | null;
  biggest_home_win: { id: string; game_date: string; score: string } | null; biggest_away_win: { id: string; game_date: string; score: string } | null;
  streak: { side: 'home' | 'away' | null; kind: 'won' | 'unbeaten' | 'drawn'; count: number } | null; games: MatchLike[] }

export function ProgramPicker({ label, gender, onPick }: { label: string; gender: 'm' | 'w'; onPick: (id: string) => void }) {
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const t = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  const q = useQuery({ queryKey: ['search', deb, 'programs'], queryFn: () => api<{ programs: { program_id: string; name: string; gender: 'm' | 'w'; conference?: { id: string; name: string } | null; division?: string | null; logo_svg_url?: string | null }[] }>(`/api/search${qs({ q: deb, limit: 10 })}`), enabled: deb.length >= 2 });
  const hits = (q.data?.programs ?? []).filter((p) => p.gender === gender);
  const id = `pick-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="w-full max-w-sm">
      <label className="mb-1 block text-xs text-chalk-400" htmlFor={id}>{label}</label>
      <input id={id} type="search" className="input w-full" placeholder={`Find a ${genderLabel(gender)} team`} value={term} onChange={(e) => setTerm(e.target.value)} />
      {deb.length >= 2 && (
        <ul className="mt-1 max-h-72 overflow-auto rounded-lg border border-field-700 bg-field-900 p-1">
          {q.isPending && <li className="px-3 py-2 text-sm text-chalk-400">Searching…</li>}
          {q.data && !hits.length && <li className="px-3 py-2 text-sm text-chalk-400">No {genderLabel(gender)} team matches “{deb}”.</li>}
          {hits.map((h) => <li key={h.program_id}><button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-field-800" onClick={() => onPick(h.program_id)}><TeamLogo src={h.logo_svg_url} name={h.name} size={18} /><span className="font-medium text-chalk-100">{h.name}</span><span className="ml-auto truncate text-xs text-chalk-500">{h.conference?.name}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

const rec = (r: Rec) => `${r.w}-${r.l}-${r.t}`;

export default function H2H() {
  const f = useFilters();
  const href = useHref();
  const patch = useUrlPatch();
  const [a] = useUrlState('a');
  const [b] = useUrlState('b');
  const q = useQuery({ queryKey: ['h2h', a, b], queryFn: () => api<{ a: Prog; b: Prog; summary: Summary }>(`/api/h2h${qs({ a, b })}`), enabled: !!a && !!b && a !== b, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  const d = q.data; const s = d?.summary;
  const team = (p: Prog, side: 'a' | 'b') => (
    <span className="flex items-center gap-2">
      <Link to={href(`/teams/${p.id}`)} className="flex items-center gap-2 font-semibold text-chalk-100 hover:text-pitch-300">{side === 'b' && p.name}<TeamLogo src={p.logo} seo={p.seo} name={p.name} size={28} />{side === 'a' && p.name}</Link>
      <button type="button" className="btn-ghost btn-icon" aria-label={`Change ${p.name}`} onClick={() => patch({ [side]: null })}><X size={14} /></button>
    </span>
  );
  const streak = s?.streak && d ? (s.streak.kind === 'drawn' ? `The last ${s.streak.count} ${s.streak.count === 1 ? 'meeting was' : 'meetings were'} tied` : `${(s.streak.side === 'home' ? d.a : d.b).name} ${s.streak.kind === 'won' ? 'won' : 'unbeaten in'} the last ${s.streak.count}`) : null;
  return (
    <div className="space-y-4">
      <PageHeader title="Head to head" meta={d ? `${d.a.name} against ${d.b.name}, every meeting we hold` : `Two ${genderLabel(f.gender)} college teams, every meeting`} />
      {(!a || !b) && (
        <div className="flex flex-wrap gap-4">
          {!a && <ProgramPicker label="Team" gender={f.gender} onPick={(id) => patch({ a: id })} />}
          {!b && <ProgramPicker label="Against" gender={f.gender} onPick={(id) => patch({ b: id })} />}
        </div>
      )}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isFetching && !d && <Skeleton className="h-64" />}
      {d && s && (
        <>
          <div className="flex flex-wrap items-center justify-center gap-4 text-lg">{team(d.a, 'a')}<span className="text-chalk-500">v</span>{team(d.b, 'b')}</div>
          {s.played ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="Meetings" value={s.played} sub={s.first_season ? `since ${s.first_season}` : undefined} />
                <StatTile label={`${d.a.name} won`} value={s.home_wins} sub={`${Math.round((s.home_wins / s.played) * 100)}%`} accent />
                <StatTile label="Tied" value={s.ties} />
                <StatTile label={`${d.b.name} won`} value={s.away_wins} sub={`${Math.round((s.away_wins / s.played) * 100)}%`} />
              </div>
              <p className="text-center text-sm text-chalk-300 tnum">Goals {s.home_goals}–{s.away_goals}{streak ? ` · ${streak}` : ''}</p>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <p className="frame px-3 py-2"><span className="text-chalk-400">{d.a.name} at home</span> <span className="float-right text-chalk-100 tnum">{rec(s.at_home)}</span></p>
                <p className="frame px-3 py-2"><span className="text-chalk-400">{d.a.name} away</span> <span className="float-right text-chalk-100 tnum">{rec(s.at_away)}</span></p>
                <p className="frame px-3 py-2"><span className="text-chalk-400">Neutral ground</span> <span className="float-right text-chalk-100 tnum">{rec(s.at_neutral)}</span></p>
              </div>
              {(s.biggest_home_win || s.biggest_away_win) && <p className="text-center text-xs text-chalk-400">{[s.biggest_home_win && `${d.a.name}'s biggest win: ${s.biggest_home_win.score}, ${fmt.date(s.biggest_home_win.game_date)}`, s.biggest_away_win && `${d.b.name}'s biggest win: ${s.biggest_away_win.score}, ${fmt.date(s.biggest_away_win.game_date)}`].filter(Boolean).join('. ')}</p>}
              <div className="frame divide-y divide-field-700">{s.games.map((g) => <MatchRow key={g.id} g={g} showDate />)}</div>
              <p className="text-xs text-chalk-500">Meetings from the seasons we hold (2024 on).</p>
            </>
          ) : <EmptyState title="They have not met in the seasons we hold" body="We hold every result from 2024 on." />}
        </>
      )}
    </div>
  );
}
