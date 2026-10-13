// Americans abroad (/pro/abroad): US players at clubs outside the US. Last week's match lines, who plays in the coming
// week, and the season's leaders among them. Men's or women's from the header toggle.
import { NewsSection } from '../../components/news/News';
import { useState } from 'react';
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
  const [allUpcoming, setAllUpcoming] = useState(false);
  const starred = (d?.lines ?? []).filter((l) => l.goals || l.assists);
  const rest = (d?.lines ?? []).filter((l) => !l.goals && !l.assists);
  const updated = d?.at ? new Date(d.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div className="space-y-6">
      <PageHeader title="Americans abroad" meta={`${gender === 'w' ? 'American women' : 'Americans'} at clubs outside the US: last week's games, the week ahead, and the season's leaders.${updated ? ` Updated ${updated}.` : ''}`} />
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-64" />}
      {d && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            {/* Everyone who played: goal and assist makers as cards, every other appearance in a compact list. */}
            <Section title={`This week: ${d.lines.length} ${d.lines.length === 1 ? 'appearance' : 'appearances'}`}>
              {d.lines.length ? (
                <>
                  {starred.length > 0 && <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{starred.map((l) => <AbroadCard key={`${l.player.id}-${l.match.id}`} l={l} />)}</ul>}
                  {rest.length > 0 && (
                    <div className="space-y-1">
                      <h3 className="text-xs font-medium text-chalk-400">Also played</h3>
                      <ul className="frame divide-y divide-field-700">
                        {rest.map((l) => {
                          const home = l.match.home.id === l.team_id; const club = home ? l.match.home : l.match.away, opp = home ? l.match.away : l.match.home;
                          const us = club.score ?? 0, them = opp.score ?? 0; const r = us > them ? 'W' : us < them ? 'L' : 'D';
                          return (
                            <li key={`${l.player.id}-${l.match.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1.5 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
                              <span className="flex min-w-0 items-center gap-2"><PlayerAvatar src={l.player.photo} name={l.player.name} size={22} /><Link to={proPath.player(l.player.slug)} className="truncate text-chalk-100 hover:text-pitch-300">{l.player.name}</Link></span>
                              <Link to={proPath.match(l.match.slug)} className="order-last col-span-2 flex min-w-0 items-center gap-1.5 text-xs text-chalk-400 hover:text-chalk-200 sm:order-none sm:col-span-1">
                                <TeamLogo src={club.logo} name={club.name} size={14} /><span className="truncate">{club.name}</span>
                                <span className={`shrink-0 ${r === 'W' ? 'text-win' : r === 'L' ? 'text-loss' : 'text-draw'}`}>{r} {us}–{them}</span><span className="truncate">{home ? 'v' : 'at'} {opp.name}</span>
                              </Link>
                              <span className="shrink-0 text-right text-xs text-chalk-400 tnum">{l.minutes}′{l.rating != null ? `, ${l.rating.toFixed(1)}` : ''}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </>
              ) : <EmptyState title="No games in the last seven days" body="Lines appear after each club match, as soon as its player stats are in." />}
            </Section>
            <NewsSection title="In the news" q={{ american: true, gender }} max={6} />
            <Section title={`Season leaders: ${statLabel(stat).toLowerCase()}`} right={<Field label="Stat">{(id) => <Select id={id} value={stat} onChange={setStat} options={PRO_STATS.map((s) => ({ value: s.key, label: s.label }))} />}</Field>}>
              <LeadersTable rows={d.leaderboard?.rows ?? []} stat={stat} caption={`Americans abroad, ${statLabel(stat)}`} loading={q.isPlaceholderData} />
              <Link to={`${proPaths2.leaders}${qs({ scope: 'world', nationality: 'USA', stat })}`} className="text-sm text-pitch-300 hover:text-pitch-200">Every American, at home and abroad</Link>
            </Section>
          </div>
          <aside className="space-y-2">
            <h2 className="text-base font-semibold text-chalk-100">Coming up<span className="ml-2 text-sm font-normal text-chalk-500">biggest competitions first</span></h2>
            {d.upcoming.length ? (
              <ul className="frame divide-y divide-field-700">
                {(allUpcoming ? d.upcoming : d.upcoming.slice(0, 25)).map((u) => {
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
            {d.upcoming.length > 25 && <button type="button" className="btn-ghost btn-sm w-full" aria-expanded={allUpcoming} onClick={() => setAllUpcoming((v) => !v)}>{allUpcoming ? 'Show fewer' : `Show all ${d.upcoming.length} matches`}</button>}
          </aside>
        </div>
      )}
    </div>
  );
}
