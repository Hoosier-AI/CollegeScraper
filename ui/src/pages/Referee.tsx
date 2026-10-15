// One college referee (/referees/:slug): cards, fouls, penalty kicks and home wins a game against the same
// divisions' average, each season, the latest games and the teams refereed most. From the box scores that name them.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Flag as FlagIcon } from 'lucide-react';
import { api, ApiError, fmt } from '../lib/api';
import { divisionLabel, divisionShort, genderLabel, useHref } from '../lib/filters';
import { Crumbs } from '../components/shell';
import { DataTable, type Column } from '../components/DataTable';
import { EmptyState, ErrorBox, PageWithRail, RailCard, RailRow, Skeleton } from '../components/primitives';
import { ProHero } from '../components/pro/Hero';
import { MatchRow, type MatchLike } from '../components/match/MatchRow';
import { RefereeTiles, refValue, versus, type RefNumbers } from '../components/Referee';

type Season = RefNumbers & { season: number; gender: 'm' | 'w'; division: string; games: number; average: RefNumbers };
interface Data {
  referee: { slug: string; name: string; divisions: string[]; genders: string[]; first_date: string; last_date: string };
  career: RefNumbers; peer: Partial<RefNumbers> | null; seasons: Season[];
  recent: { match: MatchLike; yellow: number | null; red: number | null; fouls: number | null; pens: number | null }[];
  teams: { program: { id: string; name: string; short_name: string | null; seo: string | null; gender: 'm' | 'w' }; games: number; w: number; d: number; l: number }[];
}

export default function Referee() {
  const { slug = '' } = useParams();
  const href = useHref();
  const q = useQuery({ queryKey: ['referee', slug], queryFn: () => api<Data>(`/api/referees/${slug}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="No such referee" body="The link may be out of date." action={<Link className="btn-ghost btn-sm" to="/referees">All referees</Link>} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-64" />;
  const d = q.data!; const r = d.referee;
  const years = [r.first_date.slice(0, 4), r.last_date.slice(0, 4)];
  const cell = (key: keyof RefNumbers, spec: { d: number; pct?: boolean }) => (s: Season) => {
    const vs = versus(s[key] as number | null, s.average?.[key] as number | null);
    return <span className="inline-flex flex-col items-end leading-tight"><span>{refValue(s[key] as number | null, spec)}</span>{s.average?.[key] != null && <span className={`text-2xs ${vs?.tone ?? 'text-chalk-500'}`} title={vs?.word}>avg {refValue(s.average[key] as number, spec)}</span>}</span>;
  };
  const cols: Column<Season>[] = [
    { key: 'season', label: 'Season', primary: true, render: (s) => <span><span className="font-medium text-chalk-100">{s.season}</span> <span className="text-2xs text-chalk-500">{divisionShort(s.division)} {genderLabel(s.gender)}</span></span> },
    { key: 'games', label: 'Games', num: true },
    { key: 'cards_pg', label: 'Cards', title: 'Cards a game', num: true, render: cell('cards_pg', { d: 2 }) },
    { key: 'red_pg', label: 'Red', title: 'Red cards a game', num: true, priority: 2, render: cell('red_pg', { d: 2 }) },
    { key: 'fouls_pg', label: 'Fouls', title: 'Fouls a game', num: true, render: cell('fouls_pg', { d: 1 }) },
    { key: 'pens_pg', label: 'PKs', title: 'Penalty kicks a game', num: true, priority: 2, render: cell('pens_pg', { d: 2 }) },
    { key: 'home_pct', label: 'Home win', title: 'Home wins (neutral sites left out)', num: true, priority: 2, render: cell('home_pct', { d: 0, pct: true }) },
  ];
  return (
    <div className="space-y-5">
      <Crumbs items={[{ label: r.name }]} />
      <ProHero image={<span className="grid h-16 w-16 place-items-center rounded-full bg-field-800 text-chalk-300 sm:h-20 sm:w-20"><FlagIcon size={32} aria-hidden /></span>} title={r.name}
        line={<span>College referee, {r.divisions.map(divisionLabel).join(' and ')}</span>}
        chips={[`${fmt.num(d.career.games)} games in our records`, years[0] === years[1] ? years[0] : `${years[0]}–${years[1]}`, `Last game ${fmt.date(r.last_date)}`]}>
        <RefereeTiles me={d.career} peer={d.peer} college />
        <p className="mt-2 text-2xs text-chalk-500">Averages are those of every named referee in the same seasons and divisions, weighted by this referee's games in each.</p>
      </ProHero>
      <PageWithRail label="Teams" rail={d.teams.length > 0 && (
        <RailCard title="Teams refereed most">
          <ol className="space-y-0.5">
            {d.teams.map((t) => (
              <RailRow key={t.program.id} to={href(`/teams/${t.program.id}`, { gender: t.program.gender })}
                left={<span className="truncate">{t.program.name}</span>}
                right={<span className="tnum" title={`${t.games} games: ${t.w} won, ${t.l} lost, ${t.d} tied`}>{t.games} <span className="text-chalk-500">({t.w}-{t.l}-{t.d})</span></span>} />
            ))}
          </ol>
          <p className="mt-1.5 text-2xs text-chalk-500">Games, then the team's record in them (won-lost-tied).</p>
        </RailCard>
      )}>
        <section className="min-w-0 space-y-2">
          <h2 className="text-base font-semibold text-chalk-100">By season</h2>
          <DataTable rows={d.seasons} columns={cols} rowKey={(s) => `${s.season}-${s.gender}-${s.division}`} caption={`${r.name} by season`} />
        </section>
        <section className="min-w-0 space-y-2">
          <h2 className="text-base font-semibold text-chalk-100">Latest games</h2>
          <ul className="frame divide-y divide-field-700">
            {d.recent.map((x) => (
              <li key={x.match.id}>
                <MatchRow g={x.match} showDate />
                {(x.yellow != null || x.fouls != null) && (
                  <p className="-mt-1 px-3 pb-2 text-2xs text-chalk-400 tnum">
                    {[x.yellow != null ? `${x.yellow} yellow` : null, x.red ? `${x.red} red` : null, x.fouls != null ? `${x.fouls} fouls` : null, x.pens ? `${x.pens} ${x.pens === 1 ? 'penalty kick' : 'penalty kicks'}` : null].filter(Boolean).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      </PageWithRail>
    </div>
  );
}
