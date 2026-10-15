// College to Pro (/pro/college): every professional player we know played NCAA soccer, grouped by school.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { api, fmt, qs } from '../../lib/api';
import { useUrlText } from '../../lib/urlState';
import { ageFrom, positionShort, proPath, proPaths2, type ProTeamRef } from '../../lib/pro';
import { Flag } from '../../components/pro/People';
import { EmptyState, ErrorBox, Field, PageHeader, PlayerAvatar, Skeleton, TeamLogo } from '../../components/primitives';
import { useProGender } from '../../lib/proGender';

interface Alum { id: number; name: string; slug: string; photo: string | null; nationality: string | null; position: string | null; gender: 'm' | 'w' | null; birth_date: string | null; minutes_recent: number; team: ProTeamRef | null; college_years: number[] }
interface Hub { total: number; schools: number; groups: { school: { seo: string | null; name: string; logo: string | null }; players: Alum[] }[] }

// Over 3,000 players from 600+ schools: the biggest schools first, a few players each, the rest a click away (all of
// them at once was thousands of rows and photos). A search shows every match.
const SCHOOLS_STEP = 30, PER_SCHOOL = 6;

export default function ProCollege() {
  const [gender] = useProGender();
  const search = useUrlText('q');
  const [shownSchools, setShownSchools] = useState(SCHOOLS_STEP);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const q = useQuery({ queryKey: ['pro-college', gender], queryFn: () => api<Hub>(`/api/pro/college${qs({ gender })}`) });
  const term = search.value.trim().toLowerCase();
  const groups = useMemo(() => (q.data?.groups ?? []).filter((g) => !term || g.school.name.toLowerCase().includes(term) || g.players.some((p) => p.name.toLowerCase().includes(term))), [q.data, term]);
  return (
    <div className="space-y-5">
      <PageHeader title={<span className="flex items-center gap-3"><GraduationCap size={28} aria-hidden className="text-pitch-300" />College to Pro</span>}
        meta={q.data ? `${fmt.num(q.data.total)} ${gender === 'w' ? "women's" : "men's"} professional players from ${fmt.num(q.data.schools)} colleges` : 'Professional players who played NCAA soccer'}>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-48" placeholder="School or player" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      <p className="text-sm text-chalk-400">Matched from public career records and our own college rosters, by birth date and name; only confident or checked links are shown. See also <Link to={`${proPaths2.country('usa')}`} className="text-pitch-300 hover:text-pitch-200">American players abroad</Link>.</p>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {q.data && !groups.length && <EmptyState title="No links yet" body="Links appear as player profiles with birth dates arrive and the weekly college match runs." />}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(term ? groups : groups.slice(0, shownSchools)).map((g) => {
          const key = g.school.seo ?? g.school.name;
          const all = !!term || open.has(key) || g.players.length <= PER_SCHOOL + 1;
          return (
          <section key={key} className="frame" aria-label={g.school.name}>
            <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-chalk-100">
              <TeamLogo src={g.school.logo} seo={g.school.seo} name={g.school.name} size={22} />
              {g.school.seo ? <Link to={`/teams/${g.school.seo}/${(gender || g.players[0]?.gender) === 'w' ? 'women' : 'men'}`} className="truncate hover:text-pitch-300">{g.school.name}</Link> : <span className="truncate">{g.school.name}</span>}
              <span className="ml-auto text-2xs font-normal tnum text-chalk-500">{g.players.length}</span>
            </h2>
            <ul className="divide-y divide-field-700 border-t border-field-700">
              {(all ? g.players : g.players.slice(0, PER_SCHOOL)).map((p) => (
                <li key={p.id}>
                  <Link to={proPath.player(p.slug)} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-field-800">
                    <PlayerAvatar src={p.photo} name={p.name} size={24} />
                    <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 truncate font-medium text-chalk-100">{p.name}<Flag country={p.nationality} size={10} /></span>
                      <span className="block truncate text-2xs text-chalk-500">{[positionShort(p.position), ageFrom(p.birth_date) != null ? `${ageFrom(p.birth_date)}` : null, p.college_years.length ? `college ${p.college_years.join('–')}` : null].filter(Boolean).join(' · ')}</span></span>
                    {p.team && <span className="flex shrink-0 items-center gap-1 text-2xs text-chalk-400"><TeamLogo src={p.team.logo} name={p.team.name} size={16} /><span className="hidden max-w-[7rem] truncate sm:inline">{p.team.name}</span></span>}
                  </Link>
                </li>
              ))}
            </ul>
            {!all && <button type="button" className="w-full border-t border-field-700 px-3 py-1.5 text-left text-xs text-pitch-300 hover:bg-field-800 hover:text-pitch-200"
              onClick={() => setOpen((s) => new Set(s).add(key))}>Show all {g.players.length}</button>}
          </section>
          );
        })}
      </div>
      {!term && groups.length > shownSchools && (
        <div className="flex justify-center">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setShownSchools((n) => n + SCHOOLS_STEP)}>Show more schools ({fmt.num(groups.length - shownSchools)} left)</button>
        </div>
      )}
    </div>
  );
}
