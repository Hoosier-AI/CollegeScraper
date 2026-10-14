// One college coach (/coaches/:id): every staff season we hold, the team's record in each, and the record as head coach.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, fmt } from '../lib/api';
import { divisionShort, genderLabel, useHref } from '../lib/filters';
import { Crumbs } from '../components/shell';
import { Badge, EmptyState, ErrorBox, PlayerAvatar, Skeleton, TeamLogo } from '../components/primitives';
import { StatTile } from '../components/pro/Hero';

interface Season { season: number; title: string | null; is_head: boolean; program: { id: string; name: string; gender: 'm' | 'w'; seo: string | null; logo: string | null } | null; division: string | null; conference: string | null; record: { w: number; l: number; t: number; conf_w: number | null; conf_l: number | null; conf_t: number | null } | null }
interface Data { coach: { id: string; name: string; headshot: string | null }; seasons: Season[]; head_record: { w: number; l: number; t: number; seasons: number } | null }

export default function Coach() {
  const { id = '' } = useParams();
  const href = useHref();
  const q = useQuery({ queryKey: ['coach', id], queryFn: () => api<Data>(`/api/coaches/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="No such coach" body="The link may be out of date." />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-64" />;
  const d = q.data!; const latest = d.seasons[0];
  const h = d.head_record;
  return (
    <div className="space-y-5">
      <Crumbs items={[...(latest?.program ? [{ label: latest.program.name, to: href(`/teams/${latest.program.id}`, { season: latest.season, gender: latest.program.gender }) }] : []), { label: d.coach.name }]} />
      <header className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-6">
        <PlayerAvatar src={d.coach.headshot} name={d.coach.name} size={80} crest={latest?.program?.logo} crestSeo={latest?.program?.seo} />
        <div className="min-w-0 flex-1">
          <h1 className="display text-3xl leading-none sm:text-4xl">{d.coach.name}</h1>
          {latest && <p className="mt-2 text-sm text-chalk-300">{latest.title ?? 'Coach'}{latest.program ? <>, <Link className="font-medium text-chalk-100 hover:text-pitch-300" to={href(`/teams/${latest.program.id}`, { season: latest.season, gender: latest.program.gender })}>{latest.program.name}</Link> {genderLabel(latest.program.gender)} soccer</> : null} ({latest.season})</p>}
        </div>
        {h && (
          <div className="grid shrink-0 grid-cols-2 gap-2">
            <StatTile label="As head coach" value={fmt.rec(h.w, h.l, h.t)} sub={`${h.seasons} ${h.seasons === 1 ? 'season' : 'seasons'} we hold`} accent />
            <StatTile label="Win share" value={h.w + h.l + h.t ? `${Math.round(((h.w + h.t / 2) / (h.w + h.l + h.t)) * 100)}%` : '–'} sub="ties count half" />
          </div>
        )}
      </header>
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-chalk-100">Seasons</h2>
        <ul className="frame divide-y divide-field-700 text-sm">
          {d.seasons.map((s) => (
            <li key={`${s.season}-${s.program?.id}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
              <span className="text-chalk-400 tnum">{s.season}</span>
              <span className="min-w-0">
                {s.program ? <Link to={href(`/teams/${s.program.id}`, { season: s.season, gender: s.program.gender })} className="flex items-center gap-2 font-medium text-chalk-100 hover:text-pitch-300"><TeamLogo src={s.program.logo} seo={s.program.seo} name={s.program.name} size={20} /><span className="truncate">{s.program.name}</span></Link> : '–'}
                <span className="mt-0.5 block text-xs text-chalk-500">{[s.title, divisionShort(s.division), s.conference].filter(Boolean).join(', ')}{s.is_head && <Badge tone="teal" className="ml-2">Head coach</Badge>}</span>
              </span>
              <span className="text-right text-xs text-chalk-300 tnum">{s.record ? <>{fmt.rec(s.record.w, s.record.l, s.record.t)}{s.record.conf_w != null && <span className="block text-chalk-500">{fmt.rec(s.record.conf_w, s.record.conf_l, s.record.conf_t)} conference</span>}</> : ''}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-chalk-500">From the schools' staff pages for the seasons we hold (2024 on); records are the team's in each season.</p>
      </section>
    </div>
  );
}
