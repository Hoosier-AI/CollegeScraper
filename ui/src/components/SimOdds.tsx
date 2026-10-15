// Season-simulation pieces (college_sim_odds): a conference's title race (chance of the regular-season title, the
// automatic bid and an NCAA bid, with points now, the most still reachable, and clinched / eliminated / magic number)
// and a team's postseason chances. Hidden until the simulations have run.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../lib/api';
import { useHref } from '../lib/filters';
import { Badge, RailCard, TeamLogo } from './primitives';
import { chance } from '../pages/Tournament';

interface Odds { program_id: string; program: { id: string; name: string; seo: string | null; logo: string | null; gender: 'm' | 'w' } | null; division: string; reg_title: number; auto_bid: number; bid: number | null; seed: number | null; points_now: number; max_points: number; conf_left: number; clinched: boolean; eliminated: boolean; magic: number | null; run_at: string; sims: number }

const status = (o: Odds) => (o.clinched ? <Badge tone="green">Clinched</Badge> : o.eliminated ? <Badge tone="gray">Out of the race</Badge> : o.magic != null ? <span className="text-xs text-chalk-300" title="Points still needed to be sure of at least a share of the title, whatever the others do">Magic number {o.magic}</span> : null);

export function TitleRace({ conference, season, gender }: { conference: string; season: number; gender: 'm' | 'w' }) {
  const href = useHref();
  const q = useQuery({ queryKey: ['sim-conf', conference, season, gender], queryFn: () => api<{ rows: Odds[] }>(`/api/sim-odds${qs({ conference, season, gender })}`), staleTime: 300_000 });
  const rows = (q.data?.rows ?? []).filter((r) => r.program);
  if (!rows.length || rows.every((r) => r.conf_left === 0 && !r.clinched)) return null;
  const d1 = rows[0]!.division === 'd1';
  return (
    <section className="min-w-0 space-y-2">
      <h2 className="text-base font-semibold text-chalk-100">Title race <span className="text-sm font-normal text-chalk-500">the rest of the season played {fmt.num(rows[0]!.sims)} times, updated {fmt.agoWords(rows[0]!.run_at)}</span></h2>
      <div className="frame overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Conference title race</caption>
          <thead><tr>
            <th scope="col" className="th">Team</th><th scope="col" className="th text-right" title="Conference points now (3 a win, 1 a tie)">Pts</th><th scope="col" className="th text-right" title="The most points still reachable">Max</th>
            <th scope="col" className="th text-right">Title</th>{d1 && <><th scope="col" className="th text-right" title="Wins the conference tournament (approximated) and the automatic bid">Auto bid</th><th scope="col" className="th text-right">NCAA bid</th></>}
            <th scope="col" className="th hidden sm:table-cell" />
          </tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.program_id}>
              <th scope="row" className="td text-left font-normal"><Link to={href(`/teams/${o.program!.id}`)} className="flex items-center gap-2 font-medium text-chalk-100 hover:text-pitch-300"><TeamLogo src={o.program!.logo} seo={o.program!.seo} name={o.program!.name} size={18} />{o.program!.name}</Link></th>
              <td className="td num">{o.points_now}</td><td className="td num text-chalk-400">{o.max_points}</td>
              <td className="td num font-semibold text-chalk-100">{chance(o.reg_title)}</td>
              {d1 && <><td className="td num">{chance(o.auto_bid)}</td><td className="td num">{chance(o.bid)}</td></>}
              <td className="td hidden sm:table-cell">{status(o)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-2xs text-chalk-500">From Plaibook Elo's chances for every remaining game; ties on points split by goal difference. {d1 ? 'The conference tournament is approximated as a knockout of the top four. ' : ''}<Link to={href('/tournament')} className="text-pitch-300 hover:text-pitch-200">NCAA tournament odds</Link></p>
    </section>
  );
}

export function PostseasonCard({ program, season }: { program: string; season: number }) {
  const href = useHref();
  const q = useQuery({ queryKey: ['sim-prog', program, season], queryFn: () => api<{ rows: Odds[] }>(`/api/sim-odds${qs({ program, season })}`), staleTime: 300_000 });
  const o = q.data?.rows[0];
  if (!o) return null;
  const d1 = o.division === 'd1';
  const line = (label: string, v: number | null, title?: string) => <div className="flex items-baseline justify-between gap-3" title={title}><dt className="text-chalk-300">{label}</dt><dd className="font-semibold text-chalk-100 tnum">{chance(v)}</dd></div>;
  return (
    <RailCard title="Postseason chances" to={d1 ? href('/tournament') : undefined} toLabel="All odds">
      <dl className="space-y-1">
        {line('Conference title', o.reg_title, 'Regular-season title')}
        {d1 && line('Automatic bid', o.auto_bid, 'Wins the conference tournament (approximated)')}
        {d1 && line('NCAA tournament', o.bid)}
        {d1 && line('Top-16 seed', o.seed)}
      </dl>
      <p className="mt-2 text-xs text-chalk-400">{o.points_now} conference points, {o.conf_left} conference {o.conf_left === 1 ? 'game' : 'games'} left{o.clinched ? '; title clinched' : o.eliminated ? '; out of the title race' : o.magic != null ? `; magic number ${o.magic}` : ''}.</p>
    </RailCard>
  );
}
