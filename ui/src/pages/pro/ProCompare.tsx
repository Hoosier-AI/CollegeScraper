// Two players side by side (/pro/compare?a=&b=): profile, this season's numbers per 90, percentiles.
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt } from '../../lib/api';
import { ageFrom, per90, proPath, proPaths2 } from '../../lib/pro';
import { ProSearchBox, type Hit } from '../../components/pro/ProSearchBox';
import { Flag, PercentileBars } from '../../components/pro/People';
import { EmptyState, ErrorBox, PageHeader, PlayerAvatar, Skeleton, TeamLogo } from '../../components/primitives';
import type { PlayerData } from './ProPlayer';
import { X } from 'lucide-react';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { SegmentedControl } from '../../components/primitives';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { TeamCompareHead, TeamCompareRows, type CompareRow } from '../../components/TeamCompare';
import type { ProMatch } from '../../lib/pro';

const ROWS: [string, string, boolean][] = [['apps', 'Appearances', false], ['minutes', 'Minutes', false], ['goals', 'Goals per 90', true], ['assists', 'Assists per 90', true], ['shots', 'Shots per 90', true], ['key_passes', 'Key passes per 90', true], ['tackles', 'Tackles per 90', true], ['interceptions', 'Interceptions per 90', true], ['dribbles_won', 'Dribbles per 90', true], ['pass_accuracy', 'Pass accuracy %', false], ['rating', 'Average rating', false]];

/** The player's busiest club season in the latest season with minutes. */
function mainSeason(p: PlayerData) {
  const latest = Math.max(0, ...p.seasons.filter((s) => s.minutes > 0 && !s.team?.national).map((s) => s.season));
  return p.seasons.filter((s) => s.season === latest && !s.team?.national).sort((a, b) => b.minutes - a.minutes)[0] ?? null;
}

function ComparePlayers() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const a = sp.get('a') ?? '', b = sp.get('b') ?? '';
  const q = useQuery({ queryKey: ['pro-compare', a, b], queryFn: () => api<{ a: PlayerData; b: PlayerData }>(`/api/pro/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`), enabled: !!a && !!b });
  const pick = (which: 'a' | 'b') => (
    <div className="max-w-sm">
      <p className="mb-1 text-xs text-chalk-400">{which === 'a' ? 'First player' : 'Second player'}</p>
      <ProSearchBox placeholder="Find a player" onPick={(h: Hit) => h.kind === 'player' && nav(proPaths2.compare(which === 'a' ? h.slug : a, which === 'a' ? (b || undefined) : h.slug))} />
    </div>
  );
  if (!a || !b) return (
    <div className="space-y-4">
      <PageHeader title="Compare players" meta="Pick two players to see their season side by side." />
      <div className="flex flex-wrap gap-4">{!a && pick('a')}{a && !b && pick('b')}</div>
      {a && <p className="text-sm text-chalk-400">First player: <Link className="text-pitch-300" to={proPath.player(a)}>{a}</Link></p>}
    </div>
  );
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-96" />;
  if (!q.data) return <EmptyState title="Players not found" />;
  const sides = [q.data.a, q.data.b];
  const seasons = sides.map(mainSeason);
  const val = (i: number, k: string, rate: boolean) => { const s = seasons[i] as any; if (!s) return null; const v = s[k]; return rate ? per90(v, s.minutes) : v ?? null; };
  return (
    <div className="space-y-5">
      <PageHeader title="Compare players" meta="Each player's busiest club season in their latest season with minutes." />
      <div className="grid grid-cols-2 gap-3">
        {sides.map((p, i) => (
          <Link key={p.player.id} to={proPath.player(p.player.slug)} className="card flex flex-col items-center gap-2 px-3 py-4 text-center hover:bg-field-800">
            <PlayerAvatar src={p.player.photo} name={p.player.name} size={64} />
            <span className="display text-lg text-chalk-100">{p.player.name}</span>
            <span className="flex items-center gap-1 text-xs text-chalk-400"><Flag country={p.player.nationality} size={11} />{[p.player.position, ageFrom(p.player.birth_date) != null ? `${ageFrom(p.player.birth_date)} yrs` : null].filter(Boolean).join(' · ')}</span>
            {seasons[i]?.team && <span className="flex items-center gap-1 text-xs text-chalk-300"><TeamLogo src={seasons[i]!.team!.logo} name={seasons[i]!.team!.name} size={16} />{seasons[i]!.team!.name}, {seasons[i]!.league?.name} {seasons[i]!.season}</span>}
          </Link>
        ))}
      </div>
      <div className="frame divide-y divide-field-700">
        {ROWS.map(([k, label, rate]) => {
          const x = val(0, k, rate), y = val(1, k, rate);
          const better = x != null && y != null && x !== y ? (x > y ? 0 : 1) : null;
          const show = (v: number | null) => (v == null ? '–' : rate || k === 'rating' ? v.toFixed(2) : fmt.num(v));
          return (
            <div key={k} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2 text-sm">
              <span className={`text-right tnum ${better === 0 ? 'font-semibold text-win' : 'text-chalk-200'}`}>{show(x)}</span>
              <span className="w-40 text-center text-xs text-chalk-400">{label}</span>
              <span className={`tnum ${better === 1 ? 'font-semibold text-win' : 'text-chalk-200'}`}>{show(y)}</span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sides.map((p) => p.percentiles && p.percentiles.rows.length > 0 ? <PercentileBars key={p.player.id} rows={p.percentiles.rows} caption={`${p.player.name}: ${p.percentiles.league?.name ?? ''} ${p.percentiles.season}`} /> : <p key={p.player.id} className="text-sm text-chalk-400">No percentiles for {p.player.name} yet (450+ minutes needed).</p>)}
      </div>
    </div>
  );
}

/** Players or clubs (?mode=teams). */
export default function ProCompare() {
  const [mode, setMode] = useUrlState('mode', 'players', { allow: ['players', 'teams'] });
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><SegmentedControl label="Compare" size="sm" value={mode} onChange={setMode} options={[{ value: 'players', label: 'Players' }, { value: 'teams', label: 'Clubs' }]} /></div>
      {mode === 'teams' ? <CompareClubs /> : <ComparePlayers />}
    </div>
  );
}

interface ClubSide { team: { id: number; name: string; slug: string; logo: string | null; national: boolean }; competition: { name: string; slug: string; season: number; logo: string | null } | null; record: { w: number; d: number; l: number; played: number } | null; elo: { rating: number; rank: number | null } | null }

function CompareClubs() {
  const patch = useUrlPatch();
  const [ta] = useUrlState('ta'); const [tb] = useUrlState('tb');
  const q = useQuery({ queryKey: ['pro-compare-teams', ta, tb], queryFn: () => api<{ a: ClubSide; b: ClubSide; rows: CompareRow[]; meetings: { record: { played: number; w: number; d: number; l: number }; matches: ProMatch[] } | null }>(`/api/pro/compare/teams?a=${encodeURIComponent(ta)}&b=${encodeURIComponent(tb)}`), enabled: !!ta && !!tb && ta !== tb });
  const pick = (key: 'ta' | 'tb', label: string) => (
    <div className="w-full max-w-sm"><p className="mb-1 text-xs text-chalk-400">{label}</p><ProSearchBox placeholder="Find a club" pickTeams onPick={(h: Hit) => h.kind === 'team' && patch({ [key]: h.slug })} /></div>
  );
  const head = (s: ClubSide, key: 'ta' | 'tb') => (
    <div className="card relative flex flex-col items-center gap-1.5 px-3 py-4 text-center">
      <button type="button" className="btn-ghost btn-icon absolute right-1 top-1" aria-label={`Change ${s.team.name}`} onClick={() => patch({ [key]: null })}><X size={14} /></button>
      <Link to={proPath.team(s.team.slug)} className="flex flex-col items-center gap-1.5 hover:text-pitch-300"><TeamLogo src={s.team.logo} name={s.team.name} size={56} /><span className="display text-lg text-chalk-100">{s.team.name}</span></Link>
      <span className="text-xs text-chalk-400">{s.competition ? `${s.competition.name} ${s.competition.season}` : 'No league season yet'}{s.record ? `, ${s.record.w}-${s.record.d}-${s.record.l}` : ''}</span>
      {s.elo && <span className="text-xs text-chalk-300">Elo {s.elo.rating}{s.elo.rank ? ` (No. ${s.elo.rank} in the world)` : ''}</span>}
    </div>
  );
  return (
    <div className="space-y-5">
      <PageHeader title="Compare clubs" meta="Two clubs side by side: this season a match in their league, against the rest of that league, with Plaibook Elo and their meetings." />
      {(!ta || !tb) && <div className="flex flex-wrap gap-4">{!ta && pick('ta', 'First club')}{!tb && pick('tb', 'Second club')}</div>}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {ta && tb && q.isPending && <Skeleton className="h-96" />}
      {q.data && (
        <div className="mx-auto max-w-4xl space-y-4">
          <TeamCompareHead a={head(q.data.a, 'ta')} b={head(q.data.b, 'tb')} />
          {q.data.rows.length ? <TeamCompareRows rows={q.data.rows} peerNote="its own league this season" /> : <EmptyState title="No league numbers yet this season" />}
          {(q.data.meetings?.matches.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h2 className="flex items-baseline justify-between text-base font-semibold text-chalk-100">Last meetings<Link to={`/pro/h2h?a=${ta}&b=${tb}`} className="text-xs font-normal text-pitch-300 hover:text-pitch-200">Every meeting</Link></h2>
              <div className="frame divide-y divide-field-700">{q.data.meetings!.matches.map((m) => <ProMatchRow key={m.id} m={m} showDate showLeague />)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
