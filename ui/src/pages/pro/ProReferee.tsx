// One pro referee (/pro/referees/:slug): career cards, penalties, fouls, VAR checks and home wins a match against
// the same competitions' average, each competition and season, the latest matches and the clubs refereed most.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Flag as FlagIcon } from 'lucide-react';
import { api, ApiError, fmt } from '../../lib/api';
import { proPath, type ProLeagueRef, type ProMatch, type ProTeamRef } from '../../lib/pro';
import { Crumbs } from '../../components/shell';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState, ErrorBox, PageWithRail, RailCard, RailRow, Skeleton, TeamLogo } from '../../components/primitives';
import { ProHero } from '../../components/pro/Hero';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { RefereeTiles, refValue, versus, type RefNumbers } from '../../components/Referee';

type Season = RefNumbers & { season: number; league: ProLeagueRef | null; matches: number; average: RefNumbers };
interface Data {
  referee: { slug: string; name: string; country: string | null; gender: 'm' | 'w'; first_at: string; last_at: string };
  career: RefNumbers; peer: Partial<RefNumbers> | null; seasons: Season[];
  recent: { match: ProMatch; yellow: number | null; red: number | null; pens: number | null; fouls: number | null }[];
  clubs: { team: ProTeamRef; matches: number; w: number; d: number; l: number }[];
}

export default function ProReferee() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: ['pro-referee', slug], queryFn: () => api<Data>(`/api/pro/referees/${slug}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="No such referee" body="The link may be out of date, or the referee has no finished matches in our records yet." action={<Link className="btn-ghost btn-sm" to="/pro/referees">All referees</Link>} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-64" />;
  const d = q.data!; const r = d.referee;
  // The competition they have refereed most, over every season.
  const byLeague = new Map<number, { league: ProLeagueRef; n: number }>();
  for (const x of d.seasons) if (x.league) { const e = byLeague.get(x.league.id) ?? { league: x.league, n: 0 }; e.n += x.matches; byLeague.set(x.league.id, e); }
  const main = [...byLeague.values()].sort((a, b) => b.n - a.n)[0]?.league ?? null;
  const years = [new Date(r.first_at).getFullYear(), new Date(r.last_at).getFullYear()];
  const showVar = (d.career.var_pg ?? 0) > 0;
  const cell = (key: keyof RefNumbers, spec: { d: number; pct?: boolean }) => (s: Season) => {
    const vs = versus(s[key] as number | null, s.average?.[key] as number | null);
    return <span className="inline-flex flex-col items-end leading-tight"><span>{refValue(s[key] as number | null, spec)}</span>{s.average?.[key] != null && <span className={`text-2xs ${vs?.tone ?? 'text-chalk-500'}`} title={vs?.word}>avg {refValue(s.average[key] as number, spec)}</span>}</span>;
  };
  const cols: Column<Season>[] = [
    { key: 'competition', label: 'Competition', primary: true, render: (s) => s.league ? (
      <Link to={proPath.league(s.league.slug, s.season, null, s.league.scope ?? null)} className="flex min-w-0 items-center gap-2 hover:text-pitch-300">
        <TeamLogo src={s.league.logo} name={s.league.name} size={20} chip={false} />
        <span className="min-w-0"><span className="block truncate font-medium text-chalk-100">{s.league.name}</span><span className="block text-2xs text-chalk-500">{s.season}{s.league.country && s.league.country !== 'World' ? `, ${s.league.country}` : ''}</span></span>
      </Link>) : String(s.season) },
    { key: 'matches', label: 'Matches', num: true },
    { key: 'cards_pg', label: 'Cards', title: 'Cards a match', num: true, render: cell('cards_pg', { d: 2 }) },
    { key: 'red_pg', label: 'Red', title: 'Red cards a match', num: true, priority: 2, render: cell('red_pg', { d: 2 }) },
    { key: 'pens_pg', label: 'Pens', title: 'Penalties a match', num: true, render: cell('pens_pg', { d: 2 }) },
    { key: 'fouls_pg', label: 'Fouls', title: 'Fouls a match', num: true, priority: 2, render: cell('fouls_pg', { d: 1 }) },
    ...(showVar ? [{ key: 'var_pg', label: 'VAR', title: 'VAR checks a match', num: true, priority: 3 as const, render: cell('var_pg', { d: 2 }) }] : []),
    { key: 'home_pct', label: 'Home win', title: 'Home wins', num: true, priority: 2, render: cell('home_pct', { d: 0, pct: true }) },
  ];
  return (
    <div className="space-y-5">
      <Crumbs items={[{ label: r.name }]} />
      <ProHero image={<span className="grid h-16 w-16 place-items-center rounded-full bg-field-800 text-chalk-300 sm:h-20 sm:w-20"><FlagIcon size={32} aria-hidden /></span>} title={r.name}
        line={<>{r.country && <span>Referee from {r.country}</span>}{main && <span>Mostly {main.name}</span>}</>}
        chips={[`${fmt.num(d.career.matches)} matches in our records`, years[0] === years[1] ? String(years[0]) : `${years[0]}–${years[1]}`, `Last match ${fmt.date(r.last_at)}`]}>
        <RefereeTiles me={d.career} peer={d.peer} showVar={showVar} />
        <p className="mt-2 text-2xs text-chalk-500">Averages are those of every referee in the same competitions and seasons, weighted by this referee's matches in each.</p>
      </ProHero>
      <PageWithRail label="Clubs" rail={d.clubs.length > 0 && (
        <RailCard title="Clubs refereed most">
          <ol className="space-y-0.5">
            {d.clubs.map((c) => (
              <RailRow key={c.team.id} to={proPath.team(c.team.slug, null, !!c.team.national)}
                left={<><TeamLogo src={c.team.logo} name={c.team.name} size={18} /><span className="truncate">{c.team.name}</span></>}
                right={<span className="tnum" title={`${c.matches} matches: ${c.w} won, ${c.d} drawn, ${c.l} lost`}>{c.matches} <span className="text-chalk-500">({c.w}-{c.d}-{c.l})</span></span>} />
            ))}
          </ol>
          <p className="mt-1.5 text-2xs text-chalk-500">Matches, then the club's record in them (won-drawn-lost).</p>
        </RailCard>
      )}>
        <section className="min-w-0 space-y-2">
          <h2 className="text-base font-semibold text-chalk-100">By competition and season</h2>
          <DataTable rows={d.seasons} columns={cols} rowKey={(s) => `${s.league?.id ?? 0}-${s.season}`} caption={`${r.name} by competition and season`} pageSize={15} noun="seasons" />
        </section>
        <section className="min-w-0 space-y-2">
          <h2 className="text-base font-semibold text-chalk-100">Latest matches</h2>
          <ul className="frame divide-y divide-field-700">
            {d.recent.map((x) => (
              <li key={x.match.id}>
                <ProMatchRow m={x.match} showDate showLeague />
                {(x.yellow != null || x.pens) && (
                  <p className="-mt-1 px-3 pb-2 text-2xs text-chalk-400 tnum">
                    {[x.yellow != null ? `${x.yellow} yellow` : null, x.red ? `${x.red} red` : null, x.pens ? `${x.pens} ${x.pens === 1 ? 'penalty' : 'penalties'}` : null, x.fouls != null ? `${x.fouls} fouls` : null].filter(Boolean).join(', ')}
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
