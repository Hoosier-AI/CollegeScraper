import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs, fmt } from '../lib/api';
import { useFilters, useKeepQuery } from '../lib/filters';
import { DataTable, ErrorBox, Spinner, TeamLogo, type Column } from '../components/ui';

export default function Leaders() {
  const f = useFilters();
  const keep = useKeepQuery();
  const [kind, setKind] = useState<'player' | 'team'>('player');
  const [stat, setStat] = useState('goals');
  const [division, setDivision] = useState('');
  const [minMin, setMinMin] = useState(0);
  const [conference, setConference] = useState('');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);
  const PAGE = 100;
  // Any filter change starts again from the top; the search box is debounced so typing does not fire a request per key.
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(0); }, [f.season, f.gender, kind, stat, division, conference, minMin, term]);
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ conferences: { id: string; name: string; division: string | null }[] }>('/api/meta') });
  const q = useQuery({ queryKey: ['leaders', f.season, f.gender, kind, stat, division, conference, minMin, term, page], placeholderData: (prev) => prev, queryFn: () => api<{ stats: string[]; rows: any[]; total: number; limit: number; offset: number }>(`/api/leaders${qs({ season: f.season, gender: f.gender, kind, stat, division, conference, min_minutes: minMin, q: term, limit: PAGE, offset: page * PAGE })}`) });
  const total = q.data?.total ?? 0; const offset = q.data?.offset ?? 0; const pages = Math.max(1, Math.ceil(total / PAGE));
  const rankOf = (r: any) => String(offset + (q.data?.rows.indexOf(r) ?? 0) + 1);
  const dec = (s: string) => /p90|pct|accuracy|share|_pg$|^ppg$|per_goal|^gaa$/.test(s) ? 2 : 0;
  const stats = q.data?.stats ?? [];
  const playerCols: Column<any>[] = [
    { key: 'rank', label: '#', num: true, value: (r) => offset + (q.data?.rows.indexOf(r) ?? 0) + 1, render: rankOf },
    { key: 'display_name', label: 'Player', sticky: true, render: (r) => <span className="flex items-center gap-2"><TeamLogo src={r.headshot_url} name={r.display_name} size={22} /><Link className="hover:text-teal-400" to={keep(`/players/${r.player_id}`)}>{r.display_name}</Link></span> },
    { key: 'program_name', label: 'Program', render: (r) => <Link className="flex items-center gap-2 hover:text-teal-400" to={keep(`/teams/${r.program_id}`)}><TeamLogo src={r.logo_svg_url} name={r.program_name} size={18} />{r.program_name}</Link> },
    { key: 'conference_name', label: 'Conf' }, { key: 'position', label: 'Pos' }, { key: 'class_raw', label: 'Class' },
    { key: stat, label: stat, num: true, render: (r) => stat.startsWith('pct_') || stat.startsWith('div_pct') ? fmt.pct(r[stat]) : fmt.num(r[stat], dec(stat)), className: 'font-bold text-teal-400' },
    { key: 'div_rank_points', label: 'Div rk (pts)', num: true, title: 'National rank in the division by points' }, { key: 'conf_rank_points', label: 'Conf rk', num: true }, { key: 'pct_points_p90', label: 'Pts/90 pctl', num: true, render: (r) => fmt.pct(r.pct_points_p90) },
    { key: 'gp', label: 'GP', num: true }, { key: 'minutes', label: 'MIN', num: true }, { key: 'goals', label: 'G', num: true }, { key: 'assists', label: 'A', num: true }, { key: 'shots', label: 'SH', num: true }, { key: 'sog', label: 'SOG', num: true },
  ];
  const teamCols: Column<any>[] = [
    { key: 'rank', label: '#', num: true, value: (r) => offset + (q.data?.rows.indexOf(r) ?? 0) + 1, render: rankOf },
    { key: 'program_name', label: 'Program', sticky: true, render: (r) => <Link className="flex items-center gap-2 hover:text-teal-400" to={keep(`/teams/${r.program_id}`)}><TeamLogo src={r.logo_svg_url} name={r.program_name} size={20} />{r.program_name}</Link> },
    { key: 'conference_name', label: 'Conf' }, { key: 'division', label: 'Div' },
    { key: stat, label: stat, num: true, render: (r) => stat.startsWith('div_pct') ? fmt.pct(r[stat]) : fmt.num(r[stat], dec(stat) || (stat === 'avg_attendance' ? 0 : 0)), className: 'font-bold text-teal-400' },
    { key: 'ppg', label: 'PPG', num: true, render: (r) => fmt.num(r.ppg, 2) }, { key: 'div_rank_ppg', label: 'Div rk', num: true }, { key: 'conf_rank_ppg', label: 'Conf rk', num: true },
    { key: 'rec', label: 'W-L-T', render: (r) => fmt.rec(r.w, r.l, r.t) }, { key: 'gf', label: 'GF', num: true }, { key: 'ga', label: 'GA', num: true }, { key: 'shots_pg', label: 'SH/G', num: true, render: (r) => fmt.num(r.shots_pg, 1) }, { key: 'corners_pg', label: 'CK/G', num: true, render: (r) => fmt.num(r.corners_pg, 1) },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-black">Leaders</h1>
        <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as any); setStat(e.target.value === 'team' ? 'w' : 'goals'); }}><option value="player">Players</option><option value="team">Teams</option></select>
        <select className="input" value={stat} onChange={(e) => setStat(e.target.value)}>{(stats.length ? stats : [stat]).map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className="input" value={division} onChange={(e) => setDivision(e.target.value)}><option value="">All divisions</option><option value="d1">D1</option><option value="d2">D2</option><option value="d3">D3</option></select>
        <select className="input" value={conference} onChange={(e) => setConference(e.target.value)}><option value="">All conferences</option>{(meta.data?.conferences ?? []).filter((c) => !division || c.division === division).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {kind === 'player' && <label className="flex items-center gap-1 text-sm text-ink-400">min minutes <input className="input w-20" type="number" value={minMin} onChange={(e) => setMinMin(Number(e.target.value) || 0)} /></label>}
        <input className="input w-52" placeholder={kind === 'player' ? 'Search player or program…' : 'Search program…'} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}
      {q.data && <Pager total={total} offset={offset} shown={q.data.rows.length} page={page} pages={pages} onPage={setPage} busy={q.isFetching} what={kind === 'player' ? 'players' : 'teams'} />}
      {q.data && (kind === 'player' ? <DataTable rows={q.data.rows} columns={playerCols} rowKey={(r) => r.player_season_id} dense empty="No players match" /> : <DataTable rows={q.data.rows} columns={teamCols} rowKey={(r) => r.program_id} dense empty="No teams match" />)}
      {q.data && total > PAGE && <Pager total={total} offset={offset} shown={q.data.rows.length} page={page} pages={pages} onPage={setPage} busy={q.isFetching} what={kind === 'player' ? 'players' : 'teams'} />}
    </div>
  );
}

/** Every player or team with a value for the stat is reachable: the server pages through them 100 at a time. */
function Pager({ total, offset, shown, page, pages, onPage, busy, what }: { total: number; offset: number; shown: number; page: number; pages: number; onPage: (p: number) => void; busy: boolean; what: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-400">
      <span>{total ? <>{fmt.num(offset + 1, 0)}–{fmt.num(offset + shown, 0)} of <b className="text-ink-200">{fmt.num(total, 0)}</b> {what}</> : `0 ${what}`}{busy && <span className="ml-2 text-ink-500">updating…</span>}</span>
      <span className="ml-auto flex items-center gap-1">
        <button className="btn-ghost !py-1" disabled={page === 0} onClick={() => onPage(0)} title="First page">«</button>
        <button className="btn-ghost !py-1" disabled={page === 0} onClick={() => onPage(page - 1)}>‹ Prev</button>
        <span className="px-2 tabular-nums">page <input className="input w-16 !py-1 text-center" type="number" min={1} max={pages} value={page + 1} onChange={(e) => { const n = Math.min(pages, Math.max(1, Number(e.target.value) || 1)); onPage(n - 1); }} /> of {fmt.num(pages, 0)}</span>
        <button className="btn-ghost !py-1" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
        <button className="btn-ghost !py-1" disabled={page + 1 >= pages} onClick={() => onPage(pages - 1)} title="Last page">»</button>
      </span>
    </div>
  );
}
