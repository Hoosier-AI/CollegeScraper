// Every corner of the data in two rows: men's and women's, three divisions, each with teams, tables and leaders.
import { Link } from 'react-router-dom';
import { useFilters, divisionLabel } from '../../lib/filters';
import { Panel } from './Panel';

export function BrowseGrid({ className }: { className?: string }) {
  const { season } = useFilters();
  const link = (path: string, p: Record<string, string>) => `${path}?${new URLSearchParams({ season: String(season), ...p })}`;
  return (
    <Panel className={className} title="Browse" meta="Teams, conference tables and leaders for every division">
      <div className="grid gap-3 sm:grid-cols-2">
        {(['m', 'w'] as const).map((g) => (
          <div key={g}>
            <h3 className="mb-1.5 text-xs font-medium text-chalk-400">{g === 'm' ? "Men's" : "Women's"}</h3>
            <ul className="frame divide-y divide-field-700">
              {(['d1', 'd2', 'd3'] as const).map((d) => (
                <li key={d} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <Link className="min-w-[7.5rem] font-medium text-chalk-100 hover:text-pitch-300" to={link('/teams', { gender: g, division: d })}>{divisionLabel(d)}</Link>
                  <span className="flex gap-3 text-sm">
                    <Link className="text-chalk-400 hover:text-pitch-300" to={link('/rankings', { gender: g, division: d, view: 'standings' })}>Tables</Link>
                    <Link className="text-chalk-400 hover:text-pitch-300" to={link('/rankings', { gender: g, division: d, view: 'leaders' })}>Leaders</Link>
                    <Link className="text-chalk-400 hover:text-pitch-300" to={link('/rankings', { gender: g, division: d, view: 'polls' })}>Poll</Link>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}
