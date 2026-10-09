// Plaibook Stats Pro v2 building blocks: a country flag, percentile bars, the transfers list, goals by 15-minute
// period, and the leaders table the directory, leaders, country and league pages share.
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { fmt } from '../../lib/api';
import { ageFrom, positionShort, proPath, statLabel, useCountries, type ProLeagueRef, type ProTeamRef } from '../../lib/pro';
import { DataTable, type Column } from '../DataTable';
import { EmptyState, PlayerAvatar, TeamLogo } from '../primitives';

export function Flag({ country, size = 14 }: { country: string | null | undefined; size?: number }) {
  const { flag } = useCountries();
  const src = flag(country);
  if (!src) return null;
  return <img src={src} alt="" title={country ?? ''} width={Math.round(size * 1.4)} height={size} className="inline-block shrink-0 rounded-[2px] object-cover" style={{ width: Math.round(size * 1.4), height: size }} loading="lazy" />;
}

const PCT_LABEL: Record<string, string> = {
  goals: 'Goals', assists: 'Assists', shots: 'Shots', shots_on: 'Shots on target', key_passes: 'Key passes', passes: 'Passes', pass_accuracy: 'Pass accuracy',
  tackles: 'Tackles', interceptions: 'Interceptions', duels_won: 'Duels won', dribbles_won: 'Dribbles completed', saves: 'Saves', rating: 'Match rating',
};

/** Per-90 percentiles against same-position players of the league season (pro_player_percentiles). */
export function PercentileBars({ rows, caption }: { rows: { stat: string; value: number; pct: number; peers: number }[]; caption: string }) {
  if (!rows.length) return null;
  const order = Object.keys(PCT_LABEL);
  const sorted = [...rows].sort((a, b) => order.indexOf(a.stat) - order.indexOf(b.stat));
  const tone = (p: number) => (p >= 0.8 ? 'bg-win' : p >= 0.5 ? 'bg-pitch-400' : p >= 0.25 ? 'bg-note' : 'bg-loss');
  return (
    <figure className="frame p-3">
      <figcaption className="mb-2 text-xs text-chalk-400">{caption}</figcaption>
      <ul className="space-y-1.5">
        {sorted.map((r) => {
          const pct = Math.round(r.pct * 100);
          const per = r.stat === 'rating' || r.stat === 'pass_accuracy' ? '' : ' per 90';
          return (
            <li key={r.stat} className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-2 text-sm" aria-label={`${PCT_LABEL[r.stat] ?? r.stat}: ${r.value}${per}, ${pct}th percentile of ${r.peers}`}>
              <span className="truncate text-chalk-300">{PCT_LABEL[r.stat] ?? r.stat}</span>
              <span className="h-2 overflow-hidden rounded bg-field-700" aria-hidden><span className={`block h-full ${tone(r.pct)}`} style={{ width: `${Math.max(3, pct)}%` }} /></span>
              <span className="text-right text-xs tnum text-chalk-200" title={`${r.value}${per}`}>{pct}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-2xs text-chalk-500">Percentile among {sorted[0]?.peers ?? 0} players in the same position with 450+ minutes; per 90 minutes except rating and pass accuracy.</p>
    </figure>
  );
}

export interface TransferLine { date: string; type: string | null; from_team_id: number; from_name: string | null; from_logo: string | null; to_team_id: number; to_name: string | null; to_logo: string | null; direction?: 'in' | 'out'; player_name?: string | null; player?: { name: string; slug: string | null } | null; from_slug?: string | null; to_slug?: string | null }

export function TransfersList({ rows, showPlayer, empty = 'No transfers recorded.' }: { rows: TransferLine[]; showPlayer?: boolean; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-chalk-400">{empty}</p>;
  const side = (name: string | null, logo: string | null, slug?: string | null) => (
    <span className="flex min-w-0 items-center gap-1.5">
      <TeamLogo src={logo} name={name} size={18} />
      {slug ? <Link to={proPath.team(slug)} className="truncate hover:text-pitch-300">{name ?? 'Unknown'}</Link> : <span className="truncate">{name ?? 'Unknown'}</span>}
    </span>
  );
  return (
    <ul className="frame divide-y divide-field-700">
      {rows.map((t, i) => (
        <li key={`${t.date}-${t.from_team_id}-${t.to_team_id}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <span className="w-20 shrink-0 text-xs tnum text-chalk-500">{fmt.date(t.date)}</span>
          {showPlayer && t.player && <span className="min-w-[8rem] font-medium text-chalk-100">{t.player.slug ? <Link to={proPath.player(t.player.slug)} className="hover:text-pitch-300">{t.player.name}</Link> : t.player.name}</span>}
          {t.direction && <span className={`rounded px-1.5 text-2xs font-semibold ${t.direction === 'in' ? 'bg-win/15 text-win' : 'bg-loss/15 text-loss'}`}>{t.direction === 'in' ? 'IN' : 'OUT'}</span>}
          <span className="flex min-w-0 flex-1 items-center gap-2 text-chalk-200">
            {side(t.from_name, t.from_logo, t.from_slug)}<ArrowRight size={14} aria-label="to" className="shrink-0 text-chalk-500" />{side(t.to_name, t.to_logo, t.to_slug)}
          </span>
          {t.type && <span className="text-2xs text-chalk-400">{t.type}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Goals for and against by 15-minute period: two bars per period. */
export function GoalsByPeriod({ rows }: { rows: { period: string; for: number; against: number }[] }) {
  const shown = rows.filter((r) => r.period !== 'ET' || r.for || r.against);
  const max = Math.max(1, ...shown.flatMap((r) => [r.for, r.against]));
  if (!shown.some((r) => r.for || r.against)) return <p className="text-sm text-chalk-400">No goals recorded yet this season.</p>;
  return (
    <figure className="frame p-3">
      <div className="flex h-36 items-end gap-2" role="img" aria-label={`Goals by period: ${shown.map((r) => `${r.period} minutes ${r.for} for, ${r.against} against`).join('; ')}`}>
        {shown.map((r) => (
          <div key={r.period} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-28 w-full items-end justify-center gap-0.5">
              <span className="w-1/3 rounded-t bg-pitch-400" style={{ height: `${(r.for / max) * 100}%` }} title={`${r.for} scored`} />
              <span className="w-1/3 rounded-t bg-loss/70" style={{ height: `${(r.against / max) * 100}%` }} title={`${r.against} conceded`} />
            </div>
            <span className="text-2xs tnum text-chalk-400">{r.period}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex gap-4 text-2xs text-chalk-400"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-pitch-400" />Scored</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-loss/70" />Conceded</span></figcaption>
    </figure>
  );
}

export interface LeaderRow { rank: number; player: { id: number; name: string; slug: string; photo: string | null; nationality: string | null; birth_date: string | null; position: string | null }; team: ProTeamRef | null; league: ProLeagueRef | null; season: number; apps: number; minutes: number; goals: number; assists: number; rating: number | null; value: number | null }

/** The leaders / directory table: rank, player (flag, age, position), club, competition, the sorted stat. */
export function LeadersTable({ rows, stat, per90, caption, loading, showLeague = true, empty }: { rows: LeaderRow[]; stat: string; per90?: boolean; caption: string; loading?: boolean; showLeague?: boolean; empty?: React.ReactNode }) {
  const valueLabel = `${statLabel(stat)}${per90 && !['rating', 'minutes', 'apps', 'starts'].includes(stat) ? ' per 90' : ''}`;
  const cols: Column<LeaderRow>[] = [
    { key: 'rank', label: '#', num: true, sortable: false, value: (r) => r.rank },
    { key: 'player', label: 'Player', primary: true, sortable: false, render: (r) => <span className="flex items-center gap-2"><PlayerAvatar src={r.player.photo} name={r.player.name} size={24} /><span className="truncate">{r.player.name}</span><Flag country={r.player.nationality} size={11} /></span> },
    { key: 'pos', label: 'Pos', sortable: false, priority: 2, render: (r) => positionShort(r.player.position) },
    { key: 'age', label: 'Age', num: true, sortable: false, priority: 2, value: (r) => ageFrom(r.player.birth_date) },
    { key: 'team', label: 'Club', sortable: false, render: (r) => r.team ? <span className="flex items-center gap-1.5"><TeamLogo src={r.team.logo} name={r.team.name} size={18} /><span className="truncate">{r.team.name}</span></span> : '–' },
    ...(showLeague ? [{ key: 'league', label: 'Competition', sortable: false, priority: 2 as const, render: (r: LeaderRow) => r.league?.name ?? '–' }] : []),
    { key: 'apps', label: 'Apps', num: true, sortable: false, priority: 2, value: (r) => r.apps },
    { key: 'minutes', label: 'Min', num: true, sortable: false, priority: 3, value: (r) => r.minutes },
    { key: 'value', label: valueLabel, num: true, sortable: false, decimals: per90 || stat === 'rating' ? 2 : 0, value: (r) => r.value, className: 'font-semibold text-chalk-100' },
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(r) => `${r.player.id}-${r.team?.id}-${r.league?.id}`} caption={caption} rowHref={(r) => proPath.player(r.player.slug)} loading={loading} dense
    empty={empty ?? <EmptyState title="No players match" body="Loosen the filters, or try another competition." />} />;
}
