import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs, fmt } from '../lib/api';
import { useFilters, useKeepQuery } from '../lib/filters';
import { Badge, ErrorBox, Spinner, TeamLogo } from '../components/ui';

export default function Standings() {
  const f = useFilters(); const keep = useKeepQuery();
  const [division, setDivision] = useState('d1');
  const q = useQuery({ queryKey: ['standings', f.season, f.gender, division], queryFn: () => api<{ source: string; official: number; computed: number; rows: any[] }>(`/api/standings${qs({ season: f.season, gender: f.gender, division })}`) });
  const groups = new Map<string, any[]>();
  for (const r of q.data?.rows ?? []) { const k = r.college_conferences?.name ?? 'Unknown'; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const check = (r: any) => {
    if (r.source !== 'conference') return null;
    const bad = (r.checks ?? []).filter((c: any) => c.field === 'conf_record' || c.field === 'overall_record');
    const lag = (r.checks ?? []).filter((c: any) => c.field === 'conf_record_lag' || c.field === 'overall_record_lag');
    if (!r.computed) return <span className="text-ink-500" title="No computed record yet (no games stored)">·</span>;
    if (bad.length) return <span className="text-amber-300" title={bad.map((c: any) => `${c.field}: official ${c.official} vs ours ${c.computed}`).join('\n')}>≠</span>;
    if (lag.length) return <span className="text-sky-300" title={lag.map((c: any) => `${String(c.field).replace('_lag', '')}: official ${c.official}, ours ${c.computed}: every result it lists is in our record, we hold extra games it does not`).join('\n')}>✓…</span>;
    return <span className="text-emerald-300" title="Official conference and overall records equal our computed records">✓</span>;
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-black">Standings</h1><select className="input" value={division} onChange={(e) => setDivision(e.target.value)}><option value="d1">D1</option><option value="d2">D2</option><option value="d3">D3</option></select>
        {q.data && <span className="text-xs text-ink-500">{q.data.official} rows from conference websites · {q.data.computed} computed from stored games</span>}</div>
      {q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}
      {q.data && !q.data.rows.length && <p className="text-sm text-ink-500">No standings yet — run compute-standings from the Jobs page.</p>}
      <p className="text-xs text-ink-500"><Badge tone="teal">official</Badge> = the conference's own standings page (rank, points and records as published). <Badge tone="gray">computed</Badge> = derived from our stored results (3 pts win, 1 tie). ✓ means the official conference and overall records equal our computed records; ✓… means every result the conference lists is in our record and we hold extra games it has not posted; ≠ lists a real difference on hover.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[...groups.entries()].map(([conf, rows]) => {
        const official = rows[0]?.source === 'conference';
        const pods = [...new Set(rows.map((r) => r.pod).filter(Boolean))] as string[];
        const hasGfga = rows.some((r) => r.conf_gf != null);
        const hasStreak = rows.some((r) => r.streak);
        return (
          <div key={conf} className="card">
            <div className="mb-2 flex items-center justify-between"><h2 className="font-bold">{conf}</h2><span className="flex items-center gap-1">{official ? <a className="badge bg-teal-500/20 text-teal-400" href={rows[0].source_url} target="_blank" rel="noreferrer" title={rows[0].source_url}>official</a> : <Badge tone="gray">computed</Badge>}</span></div>
            <table className="w-full text-sm"><thead><tr><th className="th">#</th><th className="th">Team</th><th className="th text-right">Conf</th><th className="th text-right">Pts</th>{hasGfga && <th className="th text-right">GF-GA</th>}<th className="th text-right">Overall</th>{hasStreak && <th className="th">Strk</th>}<th className="th"></th></tr></thead><tbody>
              {rows.map((r, i) => <>{pods.length > 0 && r.pod && (i === 0 || rows[i - 1].pod !== r.pod) && <tr key={`${r.pod}-h`}><td className="td text-xs font-semibold uppercase text-ink-500" colSpan={8}>{r.pod}</td></tr>}
                <tr key={r.program_id}><td className="td">{r.rank ?? ''}</td><td className="td"><Link className="flex items-center gap-2 hover:text-teal-400" to={keep(`/teams/${r.program_id}`)}><TeamLogo src={r.college_programs?.college_schools?.logo_svg_url} name={r.college_programs?.name} size={18} />{r.college_programs?.name}</Link></td><td className="td num">{fmt.rec(r.conf_w, r.conf_l, r.conf_t)}</td><td className="td num">{r.conf_pts ?? ''}</td>{hasGfga && <td className="td num">{r.conf_gf != null ? `${r.conf_gf}-${r.conf_ga}` : ''}</td>}<td className="td num">{fmt.rec(r.overall_w, r.overall_l, r.overall_t)}</td>{hasStreak && <td className="td">{r.streak ?? ''}</td>}<td className="td text-center">{check(r)}</td></tr></>)}
            </tbody></table>
          </div>
        );
      })}</div>
    </div>
  );
}
