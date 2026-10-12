// Americans abroad (/pro/abroad): US players at clubs outside the US. Last week's match lines, who plays in the coming
// week, and the season's leaders among them. Men's or women's from the header toggle.
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useUrlState } from '../../lib/urlState';
import { PRO_STATS, proPath, proPaths2, statLabel } from '../../lib/pro';
import { useProGender } from '../../lib/proGender';
import { AbroadCard, type AbroadData } from '../../components/pro/Abroad';
import { LeadersTable, type LeaderRow } from '../../components/pro/People';
import { EmptyState, ErrorBox, Field, PageHeader, PlayerAvatar, Section, Select, Skeleton, TeamLogo } from '../../components/primitives';

interface Data extends AbroadData { leaderboard: { rows: LeaderRow[]; total: number } | null }

export default function ProAbroad() {
  const [gender] = useProGender();
  const [stat, setStat] = useUrlState('stat', 'goals', { allow: PRO_STATS.map((s) => s.key) });
  const q = useQuery({ queryKey: ['pro-abroad', gender, stat], queryFn: () => api<Data>(`/api/pro/americans-abroad${qs({ gender, stat })}`), placeholderData: keepPreviousData });
  const d = q.data;
  const updated = d?.at ? new Date(d.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div className="space-y-6">
      <PageHeader title="Americans abroad" meta={`${gender === 'w' ? 'American women' : 'Americans'} at clubs outside the US: last week's games, the week ahead, and the season's leaders.${updated ? ` Updated ${updated}.` : ''}`} />
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-64" />}
      {d && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <Section title="This week">
              {d.lines.length
                ? <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{d.lines.slice(0, 24).map((l) => <AbroadCard key={`${l.player.id}-${l.match.id}`} l={l} />)}</ul>
                : <EmptyState title="No games in the last seven days" body="Lines appear after each club match, as soon as its player stats are in." />}
            </Section>
            <Section title={`Season leaders: ${statLabel(stat).toLowerCase()}`} right={<Field label="Stat">{(id) => <Select id={id} value={stat} onChange={setStat} options={PRO_STATS.map((s) => ({ value: s.key, label: s.label }))} />}</Field>}>
              <LeadersTable rows={d.leaderboard?.rows ?? []} stat={stat} caption={`Americans abroad, ${statLabel(stat)}`} loading={q.isPlaceholderData} />
              <Link to={`${proPaths2.leaders}${qs({ scope: 'world', nationality: 'USA', stat })}`} className="text-sm text-pitch-300 hover:text-pitch-200">Every American, at home and abroad</Link>
            </Section>
          </div>
          <aside className="space-y-2">
            <h2 className="text-base font-semibold text-chalk-100">Coming up</h2>
            {d.upcoming.length ? (
              <ul className="frame divide-y divide-field-700">
                {d.upcoming.slice(0, 30).map((u) => {
                  const club = u.match.home.id === u.team_id ? u.match.home : u.match.away;
                  const opp = u.match.home.id === u.team_id ? u.match.away : u.match.home;
                  return (
                    <li key={`${u.match.id}-${u.team_id}`} className="space-y-1 px-3 py-2">
                      <Link to={proPath.match(u.match.slug)} className="flex items-center gap-2 text-sm hover:text-pitch-300">
                        <TeamLogo src={club.logo} name={club.name} size={18} /><span className="min-w-0 truncate font-medium text-chalk-100">{club.name}</span>
                        <span className="shrink-0 text-chalk-500">{u.match.home.id === u.team_id ? 'v' : 'at'}</span><span className="min-w-0 truncate text-chalk-300">{opp.name}</span>
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-chalk-400">
                        <span className="tnum">{new Date(u.match.kickoff).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        {u.players.map((p) => <Link key={p.id} to={proPath.player(p.slug)} className="inline-flex items-center gap-1 hover:text-pitch-300"><PlayerAvatar src={p.photo} name={p.name} size={16} />{p.name}</Link>)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-chalk-400">No matches for clubs with Americans in the next seven days.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
