// NCAA tournament odds (/tournament): the rest of the Division I season played thousands of times with Plaibook Elo
// (college-sims job): the projected field (each conference's likeliest champion, then the likeliest at-large teams)
// with the top 16 seeds, the bubble, and every team's chances of the conference title, the automatic bid, a bid and
// a seed. Men's 48, women's 64.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../lib/api';
import { genderLabel, useFilters, useHref } from '../lib/filters';
import { DataTable, type Column } from '../components/DataTable';
import { Badge, EmptyState, ErrorBox, PageHeader, PageWithRail, RailCard, Skeleton, TeamLogo } from '../components/primitives';

interface Prog { id: string; name: string; short_name: string | null; seo: string | null; gender: 'm' | 'w'; logo: string | null }
interface Team { program_id: string; program: Prog; conference: { id: string; name: string; short: string | null } | null; reg_title: number; auto_bid: number; bid: number; seed: number; avg_rank: number | null; rpi_rank: number | null; record: { w: number; l: number; t: number } | null; projected_seed?: number | null; how?: 'auto' | 'at-large' }
interface Data { season: number; run_at?: string; sims?: number; field_size?: number; seeds?: number; field: Team[]; last_in?: Team[]; first_out?: Team[]; teams: Team[] }

export const chance = (v: number | null | undefined) => (v == null ? '–' : v >= 0.9995 ? '>99%' : v > 0 && v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`);

function TeamCell({ t, href, sub }: { t: Team; href: (p: string, o?: Record<string, string | number | null | undefined>) => string; sub?: string }) {
  return (
    <Link to={href(`/teams/${t.program.id}`, { gender: t.program.gender })} className="flex min-w-0 items-center gap-2 hover:text-pitch-300">
      <TeamLogo src={t.program.logo} seo={t.program.seo} name={t.program.name} size={20} />
      <span className="min-w-0"><span className="block truncate font-medium text-chalk-100">{t.program.name}</span>{sub && <span className="block truncate text-2xs text-chalk-500">{sub}</span>}</span>
    </Link>
  );
}

export default function Tournament() {
  const f = useFilters();
  const href = useHref();
  const q = useQuery({ queryKey: ['tournament', f.season, f.gender], queryFn: () => api<Data>(`/api/tournament${qs({ season: f.season, gender: f.gender })}`) });
  const d = q.data;
  const rec = (t: Team) => (t.record ? fmt.rec(t.record.w, t.record.l, t.record.t) : '');
  const cols: Column<Team>[] = [
    { key: 'team', label: 'Team', primary: true, value: (t) => t.program.name, render: (t) => <TeamCell t={t} href={href} sub={[t.conference?.short ?? t.conference?.name, rec(t)].filter(Boolean).join(', ')} /> },
    { key: 'rpi_rank', label: 'RPI', title: 'RPI rank now', num: true },
    { key: 'avg_rank', label: 'Proj. RPI', title: 'Average final RPI rank in the simulations', num: true, decimals: 1 },
    { key: 'reg_title', label: 'Conf. title', title: 'Wins the conference regular season (at least first on points and goal difference)', num: true, render: (t) => chance(t.reg_title) },
    { key: 'auto_bid', label: 'Auto bid', title: 'Wins the conference tournament (approximated) and its automatic bid', num: true, render: (t) => chance(t.auto_bid) },
    { key: 'bid', label: 'NCAA bid', num: true, render: (t) => <span className="font-semibold text-chalk-100">{chance(t.bid)}</span> },
    { key: 'seed', label: 'Seed', title: 'One of the top 16 seeds', num: true, render: (t) => chance(t.seed) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="NCAA tournament odds" meta={`Division I ${genderLabel(f.gender)}, ${f.season}: the rest of the season played ${d?.sims ? fmt.num(d.sims) : 'thousands of'} times${d?.run_at ? `, updated ${fmt.agoWords(d.run_at)}` : ''}.`} />
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {d && !d.field.length && <EmptyState title="No simulation yet" body="The odds appear after the first run of the season simulations." />}
      {d && d.field.length > 0 && (
        <PageWithRail label="The bubble" rail={<>
          {(d.last_in?.length ?? 0) > 0 && <RailCard title="Last four in">
            <ol className="space-y-1.5">{d.last_in!.map((t) => <li key={t.program_id} className="flex items-center gap-2"><span className="min-w-0 flex-1"><TeamCell t={t} href={href} sub={`RPI ${t.rpi_rank ?? '–'}, ${rec(t)}`} /></span><span className="text-sm font-semibold text-chalk-100 tnum">{chance(t.bid)}</span></li>)}</ol>
          </RailCard>}
          {(d.first_out?.length ?? 0) > 0 && <RailCard title="First four out">
            <ol className="space-y-1.5">{d.first_out!.map((t) => <li key={t.program_id} className="flex items-center gap-2"><span className="min-w-0 flex-1"><TeamCell t={t} href={href} sub={`RPI ${t.rpi_rank ?? '–'}, ${rec(t)}`} /></span><span className="text-sm font-semibold text-chalk-100 tnum">{chance(t.bid)}</span></li>)}</ol>
          </RailCard>}
          <RailCard title="How this works">
            <p className="text-chalk-300">Every remaining game is played from Plaibook Elo's win, draw and loss chances, again and again. In each run the conference table decides the regular-season champion; each conference's tournament is approximated as a knockout of its top four (we do not hold every format), whose winner takes the automatic bid. The RPI is then worked out from the simulated results and the best RPIs not already in take the at-large places; the top 16 RPIs in the field are the seeds.</p>
            <p className="mt-2 text-2xs text-chalk-500">The committee also weighs results and other factors, so treat these as odds, not a bracket.</p>
          </RailCard>
        </>}>
          <section className="min-w-0 space-y-2">
            <h2 className="text-base font-semibold text-chalk-100">Projected field <span className="text-sm font-normal text-chalk-500">{d.field.length} teams, the likeliest champion of each conference and the likeliest at-large teams</span></h2>
            <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {d.field.filter((t) => t.projected_seed).map((t) => (
                <li key={t.program_id} className="frame flex items-center gap-2.5 px-3 py-2">
                  <span className="display w-6 text-center text-lg text-chalk-100 tnum">{t.projected_seed}</span>
                  <span className="min-w-0 flex-1"><TeamCell t={t} href={href} sub={`${chance(t.seed)} to be seeded`} /></span>
                </li>
              ))}
            </ol>
            <ul className="frame grid grid-cols-1 gap-x-4 px-3 py-2 sm:grid-cols-2 xl:grid-cols-3">
              {d.field.filter((t) => !t.projected_seed).map((t) => (
                <li key={t.program_id} className="flex items-center gap-2 py-1 text-sm">
                  <span className="min-w-0 flex-1"><TeamCell t={t} href={href} /></span>
                  {t.how === 'auto' && <Badge tone="teal" title={`Likeliest ${t.conference?.name ?? 'conference'} champion`}>Auto</Badge>}
                  <span className="w-10 text-right text-xs text-chalk-300 tnum">{chance(t.bid)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="min-w-0 space-y-2">
            <h2 className="text-base font-semibold text-chalk-100">Every team's chances</h2>
            <DataTable rows={d.teams} columns={cols} rowKey={(t) => t.program_id} caption="NCAA tournament odds" defaultSort={{ key: 'bid', dir: 'desc' }} pageSize={50} noun="teams" />
          </section>
        </PageWithRail>
      )}
    </div>
  );
}
