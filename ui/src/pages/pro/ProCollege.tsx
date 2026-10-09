// College to Pro (/pro/college): every professional player we know played NCAA soccer, grouped by school.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { api, fmt, qs } from '../../lib/api';
import { useUrlState, useUrlText } from '../../lib/urlState';
import { ageFrom, positionShort, proPath, proPaths2, type ProTeamRef } from '../../lib/pro';
import { Flag } from '../../components/pro/People';
import { EmptyState, ErrorBox, Field, PageHeader, PlayerAvatar, SegmentedControl, Skeleton, TeamLogo } from '../../components/primitives';

interface Alum { id: number; name: string; slug: string; photo: string | null; nationality: string | null; position: string | null; gender: 'm' | 'w' | null; birth_date: string | null; minutes_recent: number; team: ProTeamRef | null; college_years: number[] }
interface Hub { total: number; schools: number; groups: { school: { seo: string | null; name: string; logo: string | null }; players: Alum[] }[] }

export default function ProCollege() {
  const [gender, setGender] = useUrlState('gender', '', { allow: ['m', 'w'] });
  const search = useUrlText('q');
  const q = useQuery({ queryKey: ['pro-college', gender], queryFn: () => api<Hub>(`/api/pro/college${qs({ gender })}`) });
  const term = search.value.trim().toLowerCase();
  const groups = useMemo(() => (q.data?.groups ?? []).filter((g) => !term || g.school.name.toLowerCase().includes(term) || g.players.some((p) => p.name.toLowerCase().includes(term))), [q.data, term]);
  return (
    <div className="space-y-5">
      <PageHeader title={<span className="flex items-center gap-3"><GraduationCap size={28} aria-hidden className="text-pitch-300" />College to Pro</span>}
        meta={q.data ? `${fmt.num(q.data.total)} professional players from ${fmt.num(q.data.schools)} colleges` : 'Professional players who played NCAA soccer'}>
        <Field label="Game">{() => <SegmentedControl label="Men's or women's" size="sm" value={gender} onChange={setGender} options={[{ value: '', label: 'Both' }, { value: 'm', label: "Men's" }, { value: 'w', label: "Women's" }]} />}</Field>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-48" placeholder="School or player" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
      </PageHeader>
      <p className="text-sm text-chalk-400">Matched from Wikidata's education records and our own college rosters, by birth date and name; only confident or checked links are shown. See also <Link to={`${proPaths2.country('usa')}`} className="text-pitch-300 hover:text-pitch-200">American players abroad</Link>.</p>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {q.data && !groups.length && <EmptyState title="No links yet" body="Links appear as player profiles with birth dates arrive and the weekly college match runs." />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <section key={g.school.seo ?? g.school.name} className="frame" aria-label={g.school.name}>
            <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-chalk-100">
              <TeamLogo src={g.school.logo} seo={g.school.seo} name={g.school.name} size={22} />
              {g.school.seo ? <Link to={`/teams/${g.school.seo}/${(gender || g.players[0]?.gender) === 'w' ? 'women' : 'men'}`} className="truncate hover:text-pitch-300">{g.school.name}</Link> : <span className="truncate">{g.school.name}</span>}
              <span className="ml-auto text-2xs font-normal tnum text-chalk-500">{g.players.length}</span>
            </h2>
            <ul className="divide-y divide-field-700 border-t border-field-700">
              {g.players.map((p) => (
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
          </section>
        ))}
      </div>
    </div>
  );
}
