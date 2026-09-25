// Why the numbers can be trusted, in three lines, and where to get them as data.
import { Link } from 'react-router-dom';
import { Globe, School, Table2 } from 'lucide-react';
import { Panel } from './Panel';

const POINTS = [
  { icon: School, title: 'School sites', body: 'Rosters, schedules and box scores come from each school\'s athletics site.' },
  { icon: Globe, title: 'NCAA.com', body: 'Every game is also stored from NCAA.com, live scores included, as a second source.' },
  { icon: Table2, title: 'Conference tables', body: 'Official tables are compared row by row with records computed from results; disagreements are shown.' },
];

export function HowChecked({ className }: { className?: string }) {
  return (
    <Panel className={className} title="How the numbers are checked">
      <ul className="space-y-3">
        {POINTS.map((p) => (
          <li key={p.title} className="flex gap-3">
            <p.icon size={18} className="mt-0.5 shrink-0 text-pitch-400" aria-hidden />
            <span className="text-sm text-chalk-300"><span className="font-medium text-chalk-100">{p.title}.</span> {p.body}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-field-700 pt-3 text-sm text-chalk-400">All of it is available as a <Link className="text-pitch-400 hover:text-pitch-300" to="/docs">read API</Link>, no key needed.</p>
    </Panel>
  );
}
