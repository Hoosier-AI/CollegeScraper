// One pro coach (/pro/coaches/:id): profile, every club and national team managed, and trophies won as coach.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { api, ApiError, fmt } from '../../lib/api';
import { ageFrom, proPath, type ProTeamRef } from '../../lib/pro';
import { Crumbs } from '../../components/shell';
import { Flag } from '../../components/pro/People';
import { EmptyState, ErrorBox, PlayerAvatar, Skeleton, TeamLogo } from '../../components/primitives';
import { ProHero, StatTile } from '../../components/pro/Hero';

interface Data {
  coach: { id: number; name: string; birth_date: string | null; birth_country: string | null; nationality: string | null; photo: string | null };
  career: { team: (Partial<ProTeamRef> & { name: string; slug: string | null; logo: string | null }); start: string | null; end: string | null; current: boolean }[];
  trophies: { league: string; country: string | null; season: string }[]; runners_up: number;
}

export default function ProCoach() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['pro-coach', id], queryFn: () => api<Data>(`/api/pro/coaches/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="No such coach" body="The link may be out of date." />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-64" />;
  const d = q.data!; const c = d.coach;
  const now = d.career.find((x) => x.current) ?? null;
  const age = ageFrom(c.birth_date);
  return (
    <div className="space-y-5">
      <Crumbs items={[...(now?.team.slug ? [{ label: now.team.name, to: proPath.team(now.team.slug, null, !!now.team.national) }] : []), { label: c.name }]} />
      <ProHero image={<PlayerAvatar src={c.photo} name={c.name} size={88} />} title={c.name}
        line={<>{c.nationality && <span className="inline-flex items-center gap-1.5"><Flag country={c.nationality} />{c.nationality}</span>}{now && <span>Coach of {now.team.name}</span>}</>}
        chips={[age != null ? `${age} years old` : null, c.birth_country ? `Born in ${c.birth_country}` : null]}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatTile label="Trophies" value={d.trophies.length} sub={d.runners_up ? `${d.runners_up} times runner-up` : undefined} accent />
          <StatTile label="Teams managed" value={new Set(d.career.map((x) => x.team.name)).size} />
          {now?.start && <StatTile label="In charge since" value={fmt.date(now.start)} />}
        </div>
      </ProHero>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-chalk-100">Career</h2>
          {d.career.length ? <ul className="frame divide-y divide-field-700 text-sm">
            {d.career.map((x, i) => {
              const inner = <><TeamLogo src={x.team.logo} name={x.team.name} size={22} /><span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{x.team.name}</span><span className="text-xs text-chalk-400 tnum">{x.start ? fmt.date(x.start) : '?'} – {x.end ? fmt.date(x.end) : 'now'}</span></>;
              return <li key={i}>{x.team.slug ? <Link to={proPath.team(x.team.slug, null, !!x.team.national)} className="flex items-center gap-2.5 px-3 py-2 hover:bg-field-800">{inner}</Link> : <span className="flex items-center gap-2.5 px-3 py-2">{inner}</span>}</li>;
            })}
          </ul> : <p className="text-sm text-chalk-400">No career recorded.</p>}
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-chalk-100">Trophies as coach</h2>
          {d.trophies.length ? <ul className="frame divide-y divide-field-700 text-sm">
            {d.trophies.map((t, i) => <li key={i} className="flex items-center gap-2.5 px-3 py-2"><Trophy size={15} aria-hidden className="shrink-0 text-note" /><span className="min-w-0 flex-1 truncate text-chalk-100">{t.league}</span><span className="text-xs text-chalk-400">{[t.country, t.season].filter(Boolean).join(', ')}</span></li>)}
          </ul> : <p className="text-sm text-chalk-400">No trophies recorded as coach.</p>}
        </section>
      </div>
    </div>
  );
}
