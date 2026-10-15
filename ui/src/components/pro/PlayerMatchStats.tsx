// Every player's numbers in one pro match (FotMob's player stats table): both sides, starters and substitutes who
// played, with views for the general line, attacking, passing, defending and goalkeeping. From the match data the
// provider sends after (and during) the match; columns it does not send stay empty. The provider's per-match pass
// "accuracy" is the number of passes completed (its season figure is a percentage), so it shows as completed/attempted.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { proPath } from '../../lib/pro';
import { DataTable, type Column, type Preset } from '../DataTable';
import { PlayerAvatar, SegmentedControl } from '../primitives';
import { RatingBadge } from '../Rating';
import type { ProSideDetail } from './MatchParts';

type Row = Record<string, any> & { side: 'home' | 'away'; team: string };
const PRESETS: Preset[] = [
  { id: 'general', label: 'General', columns: ['team', 'pos', 'minutes', 'rating', 'goals', 'assists', 'shots', 'key_passes', 'pass_pct', 'tackles', 'yellow', 'red'] },
  { id: 'attack', label: 'Attacking', columns: ['team', 'minutes', 'rating', 'goals', 'assists', 'shots', 'shots_on', 'key_passes', 'dribbles', 'dribbles_won', 'fouls_drawn', 'offsides', 'pen_won'] },
  { id: 'passing', label: 'Passing', columns: ['team', 'minutes', 'rating', 'passes', 'pass_pct', 'key_passes', 'assists'] },
  { id: 'defence', label: 'Defending', columns: ['team', 'minutes', 'rating', 'tackles', 'blocks', 'interceptions', 'duels', 'duels_won', 'dribbled_past', 'fouls_committed', 'pen_committed', 'yellow', 'red'] },
  { id: 'keeper', label: 'Goalkeeping', columns: ['team', 'minutes', 'rating', 'saves', 'conceded', 'pen_saved', 'passes', 'pass_pct'] },
];

export function PlayerMatchStats({ home, away, homeName, awayName }: { home: ProSideDetail; away: ProSideDetail; homeName: string; awayName: string }) {
  const [preset, setPreset] = useState('general');
  const [side, setSide] = useState<'both' | 'home' | 'away'>('both');
  const rows: Row[] = [
    ...[...home.starters, ...home.bench].map((l) => ({ ...(l as any), side: 'home' as const, team: homeName })),
    ...[...away.starters, ...away.bench].map((l) => ({ ...(l as any), side: 'away' as const, team: awayName })),
  ].filter((r) => (r.minutes ?? 0) > 0 && (side === 'both' || r.side === side) && (preset !== 'keeper' || /^G/i.test(r.pos ?? '')));
  if (!rows.length && side === 'both') return null;
  const num = (key: string, label: string, title?: string, fmt?: (v: any) => string): Column<Row> => ({ key, label, title, num: true, sortable: true, ...(fmt ? { render: (r: Row) => (r[key] == null ? '–' : fmt(r[key])) } : {}) });
  const cols: Column<Row>[] = [
    { key: 'player', label: 'Player', primary: true, value: (r) => r.display, render: (r) => (
      <span className="flex min-w-0 items-center gap-2">
        <PlayerAvatar src={r.photo} name={r.display} size={22} />
        {r.slug ? <Link to={proPath.player(r.slug)} className="truncate font-medium text-chalk-100 hover:text-pitch-300">{r.display}</Link> : <span className="truncate font-medium text-chalk-100">{r.display}</span>}
        {!r.starter && <span className="text-2xs text-chalk-500">sub</span>}
      </span>
    ) },
    { key: 'team', label: 'Team', render: (r) => <span className="truncate text-chalk-300">{r.team}</span> },
    { key: 'pos', label: 'Pos', value: (r) => r.pos },
    num('minutes', 'Min', 'Minutes'),
    { key: 'rating', label: 'Rating', num: true, sortable: true, render: (r) => <RatingBadge v={r.rating} /> },
    num('goals', 'G', 'Goals'), num('assists', 'A', 'Assists'), num('shots', 'Sh', 'Shots'), num('shots_on', 'SoT', 'Shots on target'),
    num('key_passes', 'KP', 'Key passes'), num('passes', 'Pass', 'Passes'), { key: 'pass_pct', label: 'Acc', title: 'Pass accuracy: completed of attempted', num: true, sortable: true, value: (r) => (r.passes ? (r.pass_accuracy ?? 0) / r.passes : null), render: (r) => (r.passes && r.pass_accuracy != null ? `${r.pass_accuracy}/${r.passes} (${Math.round((r.pass_accuracy / r.passes) * 100)}%)` : '–') },
    num('dribbles', 'Drb', 'Dribbles tried'), num('dribbles_won', 'Drb won', 'Dribbles completed'), num('fouls_drawn', 'Fld', 'Fouls drawn'), num('offsides', 'Off', 'Offsides'), num('pen_won', 'Pen won', 'Penalties won'),
    num('tackles', 'Tkl', 'Tackles'), num('blocks', 'Blk', 'Blocks'), num('interceptions', 'Int', 'Interceptions'), num('duels', 'Duels'), num('duels_won', 'Won', 'Duels won'),
    num('dribbled_past', 'Beaten', 'Dribbled past'), num('fouls_committed', 'Fls', 'Fouls committed'), num('pen_committed', 'Pen con', 'Penalties conceded'),
    num('yellow', 'YC', 'Yellow cards'), num('red', 'RC', 'Red cards'), num('saves', 'Saves'), num('conceded', 'GA', 'Goals conceded'), num('pen_saved', 'Pen sv', 'Penalties saved'),
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl label="Team" size="sm" value={side} onChange={(v) => setSide(v as typeof side)} options={[{ value: 'both', label: 'Both' }, { value: 'home', label: homeName }, { value: 'away', label: awayName }]} />
      </div>
      <DataTable rows={rows} columns={cols} rowKey={(r) => `${r.side}-${r.slot}`} caption="Player stats" presets={PRESETS} preset={preset} onPreset={setPreset} defaultSort={{ key: 'rating', dir: 'desc' }} dense />
    </div>
  );
}
