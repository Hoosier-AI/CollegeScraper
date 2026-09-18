import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api, qs, fmt, useAdmin } from '../lib/api';
import { useFilters, useHref, genderLabel, divisionLabel } from '../lib/filters';
import { useUrlPatch, useUrlState } from '../lib/urlState';
import { Badge, EmptyState, ErrorBox, Field, PageHeader, SegmentedControl, Select, Skeleton, TeamLogo, VerifiedMark, type VerifyState } from '../components/primitives';

const DIV_OPTIONS = [{ value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];

function verify(r: any): { state: VerifyState; details?: { field: string; official: string; ours: string }[] } {
  if (r.source !== 'conference' || !r.computed) return { state: 'none' };
  const checks: any[] = r.checks ?? [];
  const bad = checks.filter((c) => c.field === 'conf_record' || c.field === 'overall_record');
  const lag = checks.filter((c) => c.field === 'conf_record_lag' || c.field === 'overall_record_lag');
  if (bad.length) return { state: 'mismatch', details: bad.map((c) => ({ field: c.field, official: c.official, ours: c.computed })) };
  if (lag.length) return { state: 'lag', details: lag.map((c) => ({ field: String(c.field).replace('_lag', ''), official: c.official, ours: c.computed })) };
  return { state: 'ok' };
}

export default function Standings() {
  const admin = useAdmin();
  const f = useFilters();
  const href = useHref();
  const patch = useUrlPatch();
  const [division] = useUrlState('division', 'd1', { allow: ['d1', 'd2', 'd3'] });
  const [conference, setConference] = useUrlState('conference');
  const q = useQuery({ queryKey: ['standings', f.season, f.gender, division], queryFn: () => api<{ source: string; official: number; computed: number; rows: any[] }>(`/api/standings${qs({ season: f.season, gender: f.gender, division })}`) });
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; rows: any[] }>();
    for (const r of q.data?.rows ?? []) { const k = r.college_conferences?.name ?? 'No conference'; const g: { id: string; rows: any[] } = m.get(k) ?? { id: String(r.conference_id ?? r.college_conferences?.id ?? k), rows: [] }; g.rows.push(r); m.set(k, g); }
    return [...m.entries()];
  }, [q.data]);
  const confOptions = [{ value: '', label: 'All conferences' }, ...groups.map(([name, g]) => ({ value: g.id, label: name }))];
  const shown = conference ? groups.filter(([, g]) => g.id === conference) : groups;
  const scope = `${divisionLabel(division)} ${genderLabel(f.gender)}, ${f.season}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Standings" meta={q.data ? `${scope}: ${q.data.official} rows from official conference tables, ${q.data.computed} computed from results` : scope}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={(v) => patch({ division: v === 'd1' ? null : v, conference: null })} options={DIV_OPTIONS} />}</Field>
        <Field label="Conference">{(id) => <Select id={id} value={conference} onChange={setConference} options={confOptions} className="max-w-[240px]" />}</Field>
      </PageHeader>
      <details className="text-xs text-chalk-400">
        <summary className="cursor-pointer text-chalk-300">How these tables are checked</summary>
        <p className="mt-2 max-w-3xl leading-relaxed"><Badge tone="teal">Official</Badge> tables are read from the conference's own standings page: rank, points and records exactly as published. <Badge tone="gray">Computed</Badge> tables come from our stored results (3 points for a win, 1 for a tie). Each official row is then compared with the record we compute from our own game list: <b className="text-win">Verified</b> means both records match; <b className="text-chalk-300">Source behind</b> means every result the conference lists is in our record and we hold games it has not posted yet; <b className="text-note">Differs</b> lists the two records.</p>
      </details>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-56" /></div>)}</div>}
      {q.data && !q.data.rows.length && <EmptyState title={`No standings for ${scope} yet`} body={admin ? 'Run compute-standings from the Jobs page.' : 'Conference play has not started, or the tables have not been collected yet.'} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {shown.map(([conf, g]) => {
          const rows = g.rows;
          const official = rows[0]?.source === 'conference';
          const pods = rows.some((r) => r.pod);
          const hasGfga = rows.some((r) => r.conf_gf != null);
          const hasStreak = rows.some((r) => r.streak);
          return (
            <section key={conf} className="card" aria-labelledby={`conf-${g.id}`}>
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <h2 id={`conf-${g.id}`} className="display text-lg">{conf}</h2>
                {official
                  ? <a className="badge bg-pitch-400/15 text-pitch-300 hover:bg-pitch-400/25" href={rows[0].source_url} target="_blank" rel="noreferrer">Official table <ExternalLink size={11} aria-hidden /><span className="sr-only">(opens the conference site)</span></a>
                  : <Badge tone="gray" title="Computed from stored results, 3 points for a win, 1 for a tie">Computed</Badge>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <caption className="sr-only">{conf} standings, {scope}</caption>
                  <thead><tr>
                    <th scope="col" className="th w-8 text-right">#</th><th scope="col" className="th">Team</th><th scope="col" className="th text-right" title="Conference record">Conf</th><th scope="col" className="th text-right" title="Conference points">Pts</th>
                    {hasGfga && <th scope="col" className="th hidden text-right sm:table-cell" title="Conference goals for and against">GF-GA</th>}
                    <th scope="col" className="th text-right">Overall</th>{hasStreak && <th scope="col" className="th hidden sm:table-cell" title="Current streak">Streak</th>}<th scope="col" className="th"><span className="sr-only">Check</span></th>
                  </tr></thead>
                  <tbody className="[&>tr:hover>td]:bg-field-800">
                    {rows.map((r, i) => {
                      const v = verify(r);
                      return (
                        <Fragment key={r.program_id}>
                          {pods && r.pod && (i === 0 || rows[i - 1].pod !== r.pod) && <tr><th scope="rowgroup" colSpan={8} className="td bg-field-900 text-2xs font-medium text-chalk-500">{r.pod}</th></tr>}
                          <tr>
                            <td className="td num text-chalk-500">{r.rank ?? ''}</td>
                            <td className="td"><Link className="flex items-center gap-2 font-medium hover:text-pitch-300" to={href(`/teams/${r.program_id}`)}><TeamLogo src={r.college_programs?.college_schools?.logo_svg_url} name={r.college_programs?.name} size={18} /><span className="truncate">{r.college_programs?.name}</span></Link></td>
                            <td className="td num">{fmt.rec(r.conf_w, r.conf_l, r.conf_t)}</td><td className="td num">{r.conf_pts ?? ''}</td>
                            {hasGfga && <td className="td num hidden sm:table-cell">{r.conf_gf != null ? `${r.conf_gf}-${r.conf_ga}` : ''}</td>}
                            <td className="td num">{fmt.rec(r.overall_w, r.overall_l, r.overall_t)}</td>{hasStreak && <td className="td hidden sm:table-cell">{r.streak ?? ''}</td>}
                            <td className="td text-center">{official && <VerifiedMark compact state={v.state} details={v.details} />}</td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
