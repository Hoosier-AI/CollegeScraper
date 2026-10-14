// Head to head between two clubs (/pro/h2h?a=&b=, club addresses): every finished meeting we hold in any
// competition, newest first, the record from the first club's side. Same layout as College and International.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { proPath, type ProMatch, type ProTeamRef } from '../../lib/pro';
import { ProSearchBox, type Hit } from '../../components/pro/ProSearchBox';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { EmptyState, ErrorBox, PageHeader, Skeleton, TeamLogo } from '../../components/primitives';
import { StatTile } from '../../components/pro/Hero';

interface Data { a: ProTeamRef; b: ProTeamRef; record: { played: number; w: number; d: number; l: number; gf: number; ga: number }; matches: ProMatch[] }

export default function ProH2H() {
  const patch = useUrlPatch();
  const [a] = useUrlState('a');
  const [b] = useUrlState('b');
  const q = useQuery({ queryKey: ['pro-h2h', a, b], queryFn: () => api<Data>(`/api/pro/h2h${qs({ a, b })}`), enabled: !!a && !!b && a !== b, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  const d = q.data; const r = d?.record;
  const pick = (which: 'a' | 'b', label: string) => (
    <div className="w-full max-w-sm">
      <p className="mb-1 text-xs text-chalk-400">{label}</p>
      <ProSearchBox placeholder="Find a club" pickTeams onPick={(h: Hit) => h.kind === 'team' && patch({ [which]: h.slug })} />
    </div>
  );
  const team = (t: ProTeamRef, side: 'a' | 'b') => (
    <span className="flex items-center gap-2">
      <Link to={proPath.team(t.slug)} className="flex items-center gap-2 font-semibold text-chalk-100 hover:text-pitch-300">{side === 'b' && t.name}<TeamLogo src={t.logo} name={t.name} size={28} />{side === 'a' && t.name}</Link>
      <button type="button" className="btn-ghost btn-icon" aria-label={`Change ${t.name}`} onClick={() => patch({ [side]: null })}><X size={14} /></button>
    </span>
  );
  // Meetings span years: a year line above each new year.
  let year = '';
  return (
    <div className="space-y-4">
      <PageHeader title="Head to head" meta={d ? `${d.a.name} against ${d.b.name}, every meeting we hold` : 'Two clubs, every meeting in any competition'} />
      {(!a || !b) && <div className="flex flex-wrap gap-4">{!a && pick('a', 'Club')}{!b && pick('b', 'Against')}</div>}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isFetching && !d && <Skeleton className="h-64" />}
      {d && r && (
        <>
          <div className="flex flex-wrap items-center justify-center gap-4 text-lg">{team(d.a, 'a')}<span className="text-chalk-500">v</span>{team(d.b, 'b')}</div>
          {r.played ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="Meetings" value={r.played} sub={d.matches.length ? `since ${d.matches[d.matches.length - 1]!.kickoff.slice(0, 4)}` : undefined} />
                <StatTile label={`${d.a.name} won`} value={r.w} sub={`${Math.round((r.w / r.played) * 100)}%`} accent />
                <StatTile label="Drawn" value={r.d} />
                <StatTile label={`${d.b.name} won`} value={r.l} sub={`${Math.round((r.l / r.played) * 100)}%`} />
              </div>
              <p className="text-center text-sm text-chalk-300 tnum">Goals {r.gf}–{r.ga}. A match settled on penalties counts as a draw.</p>
              <div className="frame divide-y divide-field-700">
                {d.matches.map((m) => {
                  const y = m.kickoff.slice(0, 4); const head = y !== year; year = y;
                  return <div key={m.id}>{head && <p className="bg-field-950/60 px-3 py-1 text-2xs font-semibold text-chalk-500">{y}</p>}<ProMatchRow m={m} showDate showLeague /></div>;
                })}
              </div>
            </>
          ) : <EmptyState title="They have not met in the seasons we hold" />}
        </>
      )}
    </div>
  );
}
