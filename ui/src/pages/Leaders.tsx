import { useState } from 'react';
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
  const q = useQuery({ queryKey: ['leaders', f.season, f.gender, kind, stat, division, minMin], queryFn: () => api<{ stats: string[]; rows: any[] }>(`/api/leaders${qs({ season: f.season, gender: f.gender, kind, stat, division, min_minutes: minMin, limit: 200 })}`) });
  const stats = q.data?.stats ?? [];
  const playerCols: Column<any>[] = [
    { key: 'rank', label: '#', num: true, value: (_r) => 0, render: (r) => String((q.data?.rows.indexOf(r) ?? 0) + 1) },
    { key: 'display_name', label: 'Player', sticky: true, render: (r) => <span className="flex items-center gap-2"><TeamLogo src={r.headshot_url} name={r.display_name} size={22} /><Link className="hover:text-teal-400" to={keep(`/players/${r.player_id}`)}>{r.display_name}</Link></span> },
    { key: 'program_name', label: 'Program', render: (r) => <Link className="flex items-center gap-2 hover:text-teal-400" to={keep(`/teams/${r.program_id}`)}><TeamLogo src={r.logo_svg_url} name={r.program_name} size={18} />{r.program_name}</Link> },
    { key: 'conference_name', label: 'Conf' }, { key: 'position', label: 'Pos' }, { key: 'class_raw', label: 'Class' },
    { key: stat, label: stat, num: true, render: (r) => fmt.num(r[stat], String(stat).includes('p90') || String(stat).includes('pct') || stat === 'gaa' || String(stat).includes('accuracy') || String(stat).includes('share') ? 2 : 0), className: 'font-bold text-teal-400' },
    { key: 'gp', label: 'GP', num: true }, { key: 'minutes', label: 'MIN', num: true }, { key: 'goals', label: 'G', num: true }, { key: 'assists', label: 'A', num: true }, { key: 'shots', label: 'SH', num: true }, { key: 'sog', label: 'SOG', num: true },
  ];
  const teamCols: Column<any>[] = [
    { key: 'rank', label: '#', render: (r) => String((q.data?.rows.indexOf(r) ?? 0) + 1) },
    { key: 'program_name', label: 'Program', sticky: true, render: (r) => <Link className="flex items-center gap-2 hover:text-teal-400" to={keep(`/teams/${r.program_id}`)}><TeamLogo src={r.logo_svg_url} name={r.program_name} size={20} />{r.program_name}</Link> },
    { key: 'conference_name', label: 'Conf' }, { key: 'division', label: 'Div' },
    { key: stat, label: stat, num: true, render: (r) => fmt.num(r[stat], String(stat).includes('_pg') || stat === 'avg_attendance' ? 2 : 0), className: 'font-bold text-teal-400' },
    { key: 'rec', label: 'W-L-T', render: (r) => fmt.rec(r.w, r.l, r.t) }, { key: 'gf', label: 'GF', num: true }, { key: 'ga', label: 'GA', num: true }, { key: 'shots_pg', label: 'SH/G', num: true, render: (r) => fmt.num(r.shots_pg, 1) }, { key: 'corners_pg', label: 'CK/G', num: true, render: (r) => fmt.num(r.corners_pg, 1) },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-black">Leaders</h1>
        <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as any); setStat(e.target.value === 'team' ? 'w' : 'goals'); }}><option value="player">Players</option><option value="team">Teams</option></select>
        <select className="input" value={stat} onChange={(e) => setStat(e.target.value)}>{(stats.length ? stats : [stat]).map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className="input" value={division} onChange={(e) => setDivision(e.target.value)}><option value="">All divisions</option><option value="d1">D1</option><option value="d2">D2</option><option value="d3">D3</option></select>
        {kind === 'player' && <label className="flex items-center gap-1 text-sm text-ink-400">min minutes <input className="input w-20" type="number" value={minMin} onChange={(e) => setMinMin(Number(e.target.value) || 0)} /></label>}
      </div>
      {q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}
      {q.data && (kind === 'player' ? <DataTable rows={q.data.rows} columns={playerCols} rowKey={(r) => r.player_season_id} dense /> : <DataTable rows={q.data.rows} columns={teamCols} rowKey={(r) => r.program_id} dense />)}
    </div>
  );
}
