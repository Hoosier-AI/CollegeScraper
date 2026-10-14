// Two college players side by side (/compare?a=&b=, ids or slugs): each one's latest season, totals and per 90,
// and where they rank in their division. Same layout as Pro's compare.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, fmt, qs } from '../lib/api';
import { genderLabel, useHref } from '../lib/filters';
import { useEntityId } from '../lib/entity';
import { useUrlPatch } from '../lib/urlState';
import { EmptyState, ErrorBox, PageHeader, PlayerAvatar, Skeleton, TeamLogo } from '../components/primitives';

type Row = [key: string, label: string, kind: 'n' | 'd2' | 'pct' | 'low'];
const FIELD: Row[] = [['gp', 'Games', 'n'], ['gs', 'Starts', 'n'], ['minutes', 'Minutes', 'n'], ['goals', 'Goals', 'n'], ['assists', 'Assists', 'n'], ['points', 'Points', 'n'], ['shots', 'Shots', 'n'], ['sog', 'Shots on goal', 'n'],
  ['goals_p90', 'Goals per 90', 'd2'], ['assists_p90', 'Assists per 90', 'd2'], ['points_p90', 'Points per 90', 'd2'], ['shot_accuracy', 'Shot accuracy', 'pct'], ['conversion_pct', 'Goals per shot', 'pct'], ['gwg', 'Game-winning goals', 'n'],
  ['pct_points_p90', 'Points per 90, division percentile', 'pct'], ['pct_goals_p90', 'Goals per 90, division percentile', 'pct']];
const KEEPER: Row[] = [['gp', 'Games', 'n'], ['gk_minutes', 'Minutes in goal', 'n'], ['saves', 'Saves', 'n'], ['save_pct', 'Save percentage', 'pct'], ['gaa', 'Goals against average', 'low'], ['shutouts', 'Shutouts', 'n'], ['pct_save_pct', 'Save %, division percentile', 'pct']];

interface Hit { player_id: string; display_name: string; program_name?: string | null; pos?: string | null }

function Picker({ label, onPick }: { label: string; onPick: (id: string) => void }) {
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const t = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  const q = useQuery({ queryKey: ['search', deb], queryFn: () => api<{ players: Hit[] }>(`/v1/search${qs({ q: deb, limit: 8 })}`), enabled: deb.length >= 2 });
  return (
    <div className="w-full max-w-sm">
      <label className="mb-1 block text-xs text-chalk-400" htmlFor={`pick-${label}`}>{label}</label>
      <input id={`pick-${label}`} type="search" className="input w-full" placeholder="Find a college player" value={term} onChange={(e) => setTerm(e.target.value)} />
      {deb.length >= 2 && (
        <ul className="mt-1 max-h-72 overflow-auto rounded-lg border border-field-700 bg-field-900 p-1">
          {q.isPending && <li className="px-3 py-2 text-sm text-chalk-400">Searching…</li>}
          {q.data && !q.data.players.length && <li className="px-3 py-2 text-sm text-chalk-400">No player matches “{deb}”.</li>}
          {q.data?.players.map((h) => <li key={h.player_id}><button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-field-800" onClick={() => onPick(h.player_id)}><span className="font-medium text-chalk-100">{h.display_name}</span><span className="ml-auto truncate text-xs text-chalk-500">{[h.program_name, h.pos].filter(Boolean).join(', ')}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

export default function Compare() {
  const [sp] = useSearchParams();
  const patch = useUrlPatch();
  const href = useHref();
  const a = useEntityId('player', sp.get('a') ?? ''), b = useEntityId('player', sp.get('b') ?? '');
  const pa = useQuery({ queryKey: ['player', a.id], queryFn: () => api<any>(`/api/players/${a.id}`), enabled: !!a.id });
  const pb = useQuery({ queryKey: ['player', b.id], queryFn: () => api<any>(`/api/players/${b.id}`), enabled: !!b.id });
  const sides = [pa.data, pb.data];
  const ready = !!(pa.data?.player && pb.data?.player);
  const latest = (d: any) => (d?.seasons ?? []).find((s: any) => s.stats) ?? d?.seasons?.[0] ?? null;
  const seasons = sides.map(latest);
  const keeper = seasons.every((s) => s && (s.position === 'GK' || s.stats?.gk_minutes > 0));
  const rows = keeper ? KEEPER : FIELD;
  const card = (d: any, i: number) => {
    const s = seasons[i];
    return (
      <div key={i} className="card relative flex flex-col items-center gap-2 px-3 py-4 text-center">
        <button type="button" className="btn-ghost btn-icon absolute right-1 top-1" aria-label={`Change ${d.player.display_name}`} onClick={() => patch({ [i === 0 ? 'a' : 'b']: null })}><X size={14} /></button>
        <Link to={`/players/${d.player.slug ?? d.player.id}`} className="flex flex-col items-center gap-2 hover:text-pitch-300">
          <PlayerAvatar src={s?.headshot_url ?? d.player.headshot_url} name={d.player.display_name} size={64} />
          <span className="display text-lg text-chalk-100">{d.player.display_name}</span>
        </Link>
        <span className="text-xs text-chalk-400">{[s?.position, s?.class_raw].filter(Boolean).join(', ')}</span>
        {s?.program && <Link to={href(`/teams/${s.program.id}`, { season: s.season, gender: s.program.gender })} className="flex items-center gap-1 text-xs text-chalk-300 hover:text-pitch-300"><TeamLogo src={s.program.college_schools?.logo_svg_url} seo={s.program.school_seo} name={s.program.name} size={16} />{s.program.name}, {genderLabel(s.program.gender)} {s.season}</Link>}
      </div>
    );
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Compare players" meta="Two college players side by side: each one's latest season, totals, rates and division percentiles." />
      {(!a.id || !b.id) && (
        <div className="flex flex-wrap gap-4">
          {!a.id && <Picker label="First player" onPick={(id) => patch({ a: id })} />}
          {!b.id && <Picker label={a.id ? 'Second player' : 'Second player (optional now)'} onPick={(id) => patch({ b: id })} />}
          {(a.id || b.id) && <p className="w-full text-sm text-chalk-400">Chosen: {[pa.data?.player?.display_name, pb.data?.player?.display_name].filter(Boolean).join(' and ')}</p>}
        </div>
      )}
      {(a.missing || b.missing) && <EmptyState title="A player in the link was not found" body="Pick another one above." />}
      {(pa.error || pb.error) && <ErrorBox error={pa.error ?? pb.error} />}
      {a.id && b.id && !ready && !pa.error && !pb.error && <Skeleton className="h-96" />}
      {ready && (
        <>
          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3">{sides.map((d, i) => card(d, i))}</div>
          <div className="frame mx-auto max-w-4xl divide-y divide-field-700">
            {rows.map(([k, label, kind]) => {
              const x = seasons[0]?.stats?.[k], y = seasons[1]?.stats?.[k];
              const nx = x == null ? null : Number(x), ny = y == null ? null : Number(y);
              const better = nx != null && ny != null && nx !== ny ? ((kind === 'low' ? nx < ny : nx > ny) ? 0 : 1) : null;
              const show = (v: number | null) => (v == null ? '–' : kind === 'pct' ? fmt.pct(v) : kind === 'n' ? fmt.num(v) : fmt.num(v, 2));
              return (
                <div key={k} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2 text-sm">
                  <span className={`text-right tnum ${better === 0 ? 'font-semibold text-win' : 'text-chalk-200'}`}>{show(nx)}</span>
                  <span className="w-44 text-center text-xs text-chalk-400">{label}</span>
                  <span className={`tnum ${better === 1 ? 'font-semibold text-win' : 'text-chalk-200'}`}>{show(ny)}</span>
                </div>
              );
            })}
          </div>
          <p className="mx-auto max-w-4xl text-xs text-chalk-500">Percentiles are within each player's own division and season. A rate needs minutes to mean much: check the minutes row.</p>
        </>
      )}
    </div>
  );
}
