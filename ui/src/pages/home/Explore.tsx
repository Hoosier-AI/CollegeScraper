// The way into each area: what is in it, how much, and its main pages. One row, divided like the board above.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { fmt } from '../../lib/api';
import type { ProHome } from './data';
import type { IntlHome } from '../../lib/intl';

interface Status { programs: number; games: number; finals: number }

export function Explore({ pro, intl }: { pro: ProHome | undefined; intl: IntlHome | undefined }) {
  const status = useQuery({ queryKey: ['v1status'], queryFn: () => api<Status>('/v1/status') });
  const areas = [
    { id: 'college', title: 'College', what: 'Every NCAA program in Divisions I, II and III: rosters, schedules, box scores, standings and the coaches\' poll.',
      facts: status.data ? [`${fmt.num(status.data.programs)} programs`, `${fmt.num(status.data.games)} games this season`] : [],
      links: [['Matches', '/matches'], ['Teams', '/teams'], ['Rankings', '/rankings'], ['News', '/news']] },
    { id: 'pro', title: 'Pro', what: 'MLS, the NWSL and the USL, then every top league abroad: tables, squads, player stats, transfers and Americans abroad.',
      facts: pro ? [`${fmt.num(pro.counts.leagues)} competitions`, `${fmt.num(pro.counts.players)} players`] : [],
      links: [['Matches', '/pro/matches'], ['Leagues', '/pro/leagues'], ['Players', '/pro/players'], ['Americans abroad', '/pro/abroad'], ['College to Pro', '/pro/college']] },
    { id: 'intl', title: 'International', what: 'National teams back to 1872: the World Cup, qualifiers, friendlies, caps, head to head and Plaibook Elo.',
      facts: intl ? [`${fmt.num(intl.counts.nations)} national teams`, `${fmt.num(intl.counts.tournaments)} tournaments`] : [],
      links: [['Matches', '/intl/matches'], ['Tournaments', '/intl/tournaments'], ['National teams', '/intl/teams'], ['Rankings', '/intl/rankings']] },
  ] as const;
  return (
    <section aria-labelledby="explore" className="space-y-3">
      <h2 id="explore" className="text-base font-semibold text-chalk-100">Explore</h2>
      <div className="grid overflow-hidden rounded-xl border border-field-700 bg-field-900 max-md:divide-y max-md:divide-field-700 md:grid-cols-3 md:divide-x md:divide-field-700">
        {areas.map((a) => (
          <div key={a.id} className="flex flex-col gap-3 p-4 sm:p-5">
            <h3 className="display text-2xl leading-none text-chalk-100">{a.title}</h3>
            <p className="text-sm text-chalk-300">{a.what}</p>
            {a.facts.length > 0 && <p className="text-xs text-chalk-500 tnum">{a.facts.join(', ')}</p>}
            <ul className="mt-auto flex flex-wrap gap-1.5 pt-1">
              {a.links.map(([label, to]) => <li key={to}><Link to={to} className="chip">{label}</Link></li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
