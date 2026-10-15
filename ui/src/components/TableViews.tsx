// All / Home / Away / Form table switch (FotMob style) for a pro competition or a college conference. "All" is the
// page's own official table; the others are worked out from the finished matches (src/standings/views.ts).
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { FormPips, SegmentedControl, Skeleton, TeamLogo } from './primitives';

export type TableViewKey = 'all' | 'home' | 'away' | 'form';
export const TABLE_VIEWS: { value: TableViewKey; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }, { value: 'form', label: 'Form' }];
interface Row { rank: number; team: { id: string | number; name: string; slug?: string | null; logo: string | null; seo?: string | null }; p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number; form: string }

export function TableViewSwitch({ value, onChange }: { value: TableViewKey; onChange: (v: TableViewKey) => void }) {
  return <SegmentedControl label="Table" size="sm" value={value} onChange={onChange} options={TABLE_VIEWS} />;
}

function ViewTable({ rows, caption, hrefOf, ties }: { rows: Row[]; caption: string; hrefOf: (t: Row['team']) => string | null; ties?: boolean }) {
  return (
    <div className="frame overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>
          <th scope="col" className="th w-8 text-right">#</th><th scope="col" className="th">Team</th>
          <th scope="col" className="th text-right">P</th><th scope="col" className="th text-right">W</th><th scope="col" className="th text-right">{ties ? 'T' : 'D'}</th><th scope="col" className="th text-right">L</th>
          <th scope="col" className="th hidden text-right sm:table-cell">Goals</th><th scope="col" className="th text-right">GD</th><th scope="col" className="th text-right">Pts</th>
          <th scope="col" className="th hidden md:table-cell">Form</th>
        </tr></thead>
        <tbody>{rows.map((r) => {
          const to = hrefOf(r.team);
          const name = <span className="flex min-w-0 items-center gap-2"><TeamLogo src={r.team.logo} seo={r.team.seo ?? null} name={r.team.name} size={18} /><span className="truncate font-medium text-chalk-100">{r.team.name}</span></span>;
          return (
            <tr key={String(r.team.id)}>
              <td className="td num text-chalk-400">{r.rank}</td>
              <th scope="row" className="td text-left font-normal">{to ? <Link to={to} className="hover:text-pitch-300">{name}</Link> : name}</th>
              <td className="td num">{r.p}</td><td className="td num">{r.w}</td><td className="td num">{r.d}</td><td className="td num">{r.l}</td>
              <td className="td num hidden sm:table-cell">{r.gf}:{r.ga}</td><td className="td num">{r.gd > 0 ? `+${r.gd}` : r.gd}</td><td className="td num font-semibold text-chalk-100">{r.pts}</td>
              <td className="td hidden md:table-cell"><FormPips form={r.form.replace(/D/g, 'T')} size="sm" /></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

const NOTE: Record<Exclude<TableViewKey, 'all'>, string> = { home: 'Home matches only.', away: 'Away matches only.', form: 'Each team’s last five matches.' };

export function ProTableView({ league, season, view, hrefOf }: { league: number; season: number; view: Exclude<TableViewKey, 'all'>; hrefOf: (t: Row['team']) => string | null }) {
  const q = useQuery({ queryKey: ['ptv', league, season, view], queryFn: () => api<{ groups: { name: string; rows: Row[] }[] }>(`/api/pro/leagues/${league}/table${qs({ season, view })}`), staleTime: 300_000 });
  if (q.isPending) return <Skeleton className="h-96" />;
  return <div className="space-y-4">{(q.data?.groups ?? []).map((g) => <div key={g.name} className="space-y-1.5">{g.name && <h3 className="text-sm font-semibold text-chalk-200">{g.name}</h3>}<ViewTable rows={g.rows} caption={`${g.name} ${view} table`} hrefOf={hrefOf} /></div>)}<p className="text-2xs text-chalk-500">{NOTE[view]} Worked out from the results we hold; points 3 for a win, 1 for a draw.</p></div>;
}

export function CollegeTableView({ conference, season, gender, view, hrefOf }: { conference: string; season: number; gender: 'm' | 'w'; view: Exclude<TableViewKey, 'all'>; hrefOf: (t: Row['team']) => string | null }) {
  const q = useQuery({ queryKey: ['ctv', conference, season, gender, view], queryFn: () => api<{ rows: Row[] }>(`/api/conferences/${conference}/table${qs({ season, gender, view })}`), staleTime: 300_000 });
  if (q.isPending) return <Skeleton className="h-96" />;
  return <div className="space-y-1.5"><ViewTable rows={q.data?.rows ?? []} caption={`${view} table`} hrefOf={hrefOf} ties /><p className="text-2xs text-chalk-500">{NOTE[view]} Conference games only, from the results we hold; 3 points a win, 1 a tie.</p></div>;
}
