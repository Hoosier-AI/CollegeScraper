// A league table (or one group of it): position, club, played, W-D-L, goals, points, recent form.
import { Link } from 'react-router-dom';
import { TeamLogo } from '../primitives';
import { proPath, type ProStandingRow } from '../../lib/pro';

const PIP: Record<string, string> = { W: 'bg-win/20 text-win', D: 'bg-field-600 text-chalk-200', L: 'bg-loss/20 text-loss' };
/** The provider lists form newest first; shown oldest to newest so the latest result sits on the right. */
export function ProForm({ form }: { form: string | null }) {
  const letters = [...(form ?? '').toUpperCase()].filter((c) => c === 'W' || c === 'D' || c === 'L').reverse();
  if (!letters.length) return <span className="text-chalk-500">–</span>;
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`Form, oldest to latest: ${letters.join(' ')}`}>
      {letters.map((c, i) => <span key={i} aria-hidden className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-semibold tnum ${PIP[c]}`}>{c}</span>)}
    </span>
  );
}

export function LeagueTable({ rows, caption, highlight, season, compact }: { rows: ProStandingRow[]; caption: string; highlight?: number; season?: number | null; compact?: boolean }) {
  // Coloured edges for promotion / European places / relegation, from the provider's description of each place.
  const edge = (d: string | null) => !d ? 'border-l-transparent' : /relegat/i.test(d) ? 'border-l-loss' : /champions league|promotion|play ?offs?|final/i.test(d) ? 'border-l-pitch-400' : /europa|conference|qualif/i.test(d) ? 'border-l-sky-400' : 'border-l-field-600';
  return (
    <div className="frame overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-2xs text-chalk-500">
            <th scope="col" className="th w-8 text-right">#</th>
            <th scope="col" className="th text-left">Club</th>
            <th scope="col" className="th text-right" title="Played">P</th>
            {!compact && <><th scope="col" className="th text-right" title="Won">W</th><th scope="col" className="th text-right" title="Drawn">D</th><th scope="col" className="th text-right" title="Lost">L</th></>}
            {!compact && <th scope="col" className="th hidden text-right sm:table-cell" title="Goals for and against">Goals</th>}
            <th scope="col" className="th text-right" title="Goal difference">GD</th>
            <th scope="col" className="th text-right" title="Points">Pts</th>
            {!compact && <th scope="col" className="th hidden md:table-cell">Form</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team.id} className={`border-t border-field-700 ${r.team.id === highlight ? 'bg-pitch-400/10' : ''}`}>
              <td className={`td border-l-2 text-right tnum text-chalk-400 ${edge(r.description)}`} title={r.description ?? undefined}>{r.rank ?? ''}</td>
              <td className="td">
                <Link to={proPath.team(r.team.slug, season)} className="flex min-w-0 items-center gap-2 hover:text-pitch-300">
                  <TeamLogo src={r.team.logo} name={r.team.name} size={20} />
                  <span className="truncate font-medium text-chalk-100">{r.team.name}</span>
                </Link>
              </td>
              <td className="td text-right tnum">{r.played ?? '–'}</td>
              {!compact && <><td className="td text-right tnum">{r.win ?? '–'}</td><td className="td text-right tnum">{r.draw ?? '–'}</td><td className="td text-right tnum">{r.lose ?? '–'}</td></>}
              {!compact && <td className="td hidden text-right tnum sm:table-cell">{r.gf ?? 0}:{r.ga ?? 0}</td>}
              <td className="td text-right tnum">{r.gd != null && r.gd > 0 ? `+${r.gd}` : r.gd ?? '–'}</td>
              <td className="td text-right font-semibold tnum text-chalk-100">{r.points ?? '–'}</td>
              {!compact && <td className="td hidden md:table-cell"><ProForm form={r.form} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
