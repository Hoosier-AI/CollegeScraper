// The roster with season stats. Forty-odd columns exist; presets show the ones a question needs.
import { Shield } from 'lucide-react';
import { fmt, useAdmin } from '../../lib/api';
import { useSortParam, useUrlState } from '../../lib/urlState';
import { DataTable, type Column, type Preset } from '../../components/DataTable';
import { Badge, EmptyState, Note, TeamLogo } from '../../components/primitives';

/** Highlights a computed value against the school's own cumulative table. */
function Diff({ value, vs, digits = 0, tolerance = 0 }: { value: unknown; vs: unknown; digits?: number; tolerance?: number }) {
  const a = value == null ? null : Number(value), b = vs == null ? null : Number(vs);
  const same = a === b || (a != null && b != null && Math.abs(a - b) <= tolerance);
  if (b == null || same) return <>{fmt.num(a, digits)}</>;
  return <span className="rounded bg-note/15 px-1 text-note" title={`The school's table says ${fmt.num(b, digits)}`}>{fmt.num(a, digits)}<span className="sr-only"> (school table: {fmt.num(b, digits)})</span></span>;
}

const PRESETS: Preset[] = [
  { id: 'overview', label: 'Overview', columns: ['jersey', 'position', 'class_raw', 'gp', 'gs', 'minutes', 'goals', 'assists', 'points', 'shots', 'sog', 'shot_accuracy'] },
  { id: 'attack', label: 'Attacking', columns: ['jersey', 'position', 'gp', 'minutes', 'goals', 'assists', 'points', 'shots', 'sog', 'shot_accuracy', 'conversion_pct', 'shots_per_goal', 'minutes_per_goal', 'gwg', 'pk', 'halves'] },
  { id: 'gk', label: 'Goalkeeping', columns: ['jersey', 'gp', 'gs', 'gk_minutes', 'ga', 'gaa', 'saves', 'save_pct', 'shutouts', 'clean_sheets', 'gkrec', 'pct_save_pct'] },
  { id: 'discipline', label: 'Discipline', columns: ['jersey', 'position', 'gp', 'minutes', 'fouls', 'yc', 'rc', 'corners'] },
  { id: 'splits', label: 'Splits', columns: ['jersey', 'position', 'goals', 'home_g', 'conf_g', 'halves'] },
  { id: 'ranks', label: 'Ranks', columns: ['jersey', 'position', 'points', 'div_rank_points', 'conf_rank_points', 'pct_points_p90'] },
  { id: 'bio', label: 'Bio', columns: ['jersey', 'position', 'class_raw', 'height_cm', 'hometown_raw', 'previous_school', 'honors'] },
];

export function RosterTable({ rows, loading, playerHref }: { rows: any[]; loading: boolean; playerHref: (r: any) => string }) {
  const admin = useAdmin();
  const [preset, setPreset] = useUrlState('cols', 'overview', { resetPage: false, replace: true, allow: PRESETS.map((p) => p.id) });
  const [per90raw, setPer90] = useUrlState('per90', '', { resetPage: false, replace: true, allow: ['1'] });
  const per90 = per90raw === '1';
  const [sort, setSort] = useSortParam('sort', { key: preset === 'gk' ? 'gk_minutes' : 'jersey', dir: preset === 'gk' ? 'desc' : 'asc' });
  const gk = (r: any) => r.stats?.gk_minutes > 0 || r.position === 'GK';
  const n = (v: unknown, d = 0) => fmt.num(v, d);
  const p90 = (key: string, label: string, plain: string): Column<any> => ({ key, label: per90 ? `${plain}/90` : plain, title: per90 ? `${label} per 90 minutes` : label, num: true, priority: 3,
    value: (r) => per90 ? r.stats?.[`${key}_p90`] : r.stats?.[key], render: (r) => per90 ? n(r.stats?.[`${key}_p90`], 2) : <Diff value={r.stats?.[key]} vs={r.site?.[key]} /> });
  const cols: Column<any>[] = [
    { key: 'name', label: 'Player', primary: true, value: (r) => r.player?.display_name, render: (r) => <span className="flex items-center gap-2"><TeamLogo src={r.headshot_url ?? r.player?.headshot_url} name={r.player?.display_name} size={22} fallback="blank" /><span>{r.player?.display_name}</span>{r.is_captain && <Badge tone="amber" title="Captain"><Shield size={10} aria-hidden />C</Badge>}</span> },
    { key: 'jersey', label: '#', title: 'Jersey number', num: true, priority: 3, value: (r) => r.jersey, className: 'text-chalk-500' },
    { key: 'position', label: 'Pos', title: 'Position', priority: 3, value: (r) => r.position ?? r.position_raw },
    { key: 'class_raw', label: 'Class', priority: 3, value: (r) => r.class_raw },
    { key: 'height_cm', label: 'Height', priority: 3, value: (r) => r.height_cm, render: (r) => r.height_cm ? `${Math.floor(r.height_cm / 30.48)}′${Math.round(r.height_cm / 2.54 % 12)}″` : '–' },
    { key: 'hometown_raw', label: 'Hometown', priority: 3, wrap: true, value: (r) => r.hometown_raw },
    { key: 'previous_school', label: 'Previous school', priority: 3, wrap: true, value: (r) => r.previous_school },
    { key: 'gp', label: 'GP', title: 'Games played', num: true, priority: 3, value: (r) => r.stats?.gp, render: (r) => <Diff value={r.stats?.gp} vs={r.site?.gp} tolerance={1} /> },
    { key: 'gs', label: 'GS', title: 'Games started', num: true, priority: 3, value: (r) => r.stats?.gs, render: (r) => <Diff value={r.stats?.gs} vs={r.site?.gs} tolerance={1} /> },
    { key: 'minutes', label: 'Min', title: 'Minutes played', num: true, priority: 3, value: (r) => r.stats?.minutes, render: (r) => <Diff value={r.stats?.minutes} vs={r.site?.minutes} tolerance={10} /> },
    p90('goals', 'Goals', 'G'), p90('assists', 'Assists', 'A'), p90('points', 'Points', 'Pts'), p90('shots', 'Shots', 'Sh'), p90('sog', 'Shots on goal', 'SOG'),
    { key: 'shot_accuracy', label: 'SOG%', title: 'Shot accuracy', num: true, priority: 3, value: (r) => r.stats?.shot_accuracy, render: (r) => fmt.pct(r.stats?.shot_accuracy) },
    { key: 'conversion_pct', label: 'Conv%', title: 'Goals per shot', num: true, priority: 3, value: (r) => r.stats?.conversion_pct, render: (r) => fmt.pct(r.stats?.conversion_pct) },
    { key: 'shots_per_goal', label: 'Sh/G', title: 'Shots per goal', num: true, priority: 3, value: (r) => r.stats?.shots_per_goal, render: (r) => n(r.stats?.shots_per_goal, 1) },
    { key: 'minutes_per_goal', label: 'Min/G', title: 'Minutes per goal', num: true, priority: 3, value: (r) => r.stats?.minutes_per_goal, render: (r) => n(r.stats?.minutes_per_goal) },
    { key: 'gwg', label: 'GWG', title: 'Game-winning goals', num: true, priority: 3, value: (r) => r.stats?.gwg, render: (r) => <Diff value={r.stats?.gwg} vs={r.site?.gwg} /> },
    { key: 'pk', label: 'PK', title: 'Penalties scored–taken', priority: 3, value: (r) => r.stats?.pk_goals, render: (r) => r.stats ? `${r.stats.pk_goals ?? 0}–${r.stats.pk_att ?? 0}` : '–' },
    { key: 'halves', label: 'G by half', title: 'Goals in the first half, second half, overtime', priority: 3, value: (r) => r.stats?.goals_1h, render: (r) => r.stats ? `${r.stats.goals_1h ?? 0} / ${r.stats.goals_2h ?? 0} / ${r.stats.goals_ot ?? 0}` : '–' },
    { key: 'home_g', label: 'G home / away', title: 'Goals in home and away games', priority: 3, value: (r) => r.splits?.home?.goals, render: (r) => r.splits?.home || r.splits?.away ? `${r.splits.home?.goals ?? 0} / ${r.splits.away?.goals ?? 0}` : '–' },
    { key: 'conf_g', label: 'G conf', title: 'Goals in conference games', num: true, priority: 3, value: (r) => r.splits?.conf?.goals },
    { key: 'div_rank_points', label: 'Div rank', title: 'National rank in the division by points', num: true, priority: 3, value: (r) => r.stats?.div_rank_points },
    { key: 'conf_rank_points', label: 'Conf rank', title: 'Rank in the conference by points', num: true, priority: 3, value: (r) => r.stats?.conf_rank_points },
    { key: 'pct_points_p90', label: 'Pts/90 pctl', title: 'Percentile among division players with at least 30% of team minutes', num: true, priority: 3, value: (r) => r.stats?.pct_points_p90, render: (r) => r.stats?.pct_points_p90 != null ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-1.5 w-12 rounded bg-field-700"><span className="block h-1.5 rounded bg-pitch-400" style={{ width: `${Math.round(r.stats.pct_points_p90 * 100)}%` }} /></span>{fmt.pct(r.stats.pct_points_p90)}</span> : '' },
    { key: 'fouls', label: 'Fouls', num: true, priority: 3, value: (r) => r.stats?.fouls },
    { key: 'yc', label: 'YC', title: 'Yellow cards', num: true, priority: 3, value: (r) => r.stats?.yc, render: (r) => <Diff value={r.stats?.yc} vs={r.site?.yc} /> },
    { key: 'rc', label: 'RC', title: 'Red cards', num: true, priority: 3, value: (r) => r.stats?.rc, render: (r) => <Diff value={r.stats?.rc} vs={r.site?.rc} /> },
    { key: 'corners', label: 'CK', title: 'Corners taken', num: true, priority: 3, value: (r) => r.stats?.corners },
    { key: 'gk_minutes', label: 'GK min', title: 'Minutes in goal', num: true, priority: 3, value: (r) => gk(r) ? r.stats?.gk_minutes : null, render: (r) => gk(r) ? n(r.stats?.gk_minutes) : '' },
    { key: 'ga', label: 'GA', title: 'Goals against', num: true, priority: 3, value: (r) => gk(r) ? r.stats?.ga : null, render: (r) => gk(r) ? n(r.stats?.ga) : '' },
    { key: 'gaa', label: 'GAA', title: 'Goals against average', num: true, priority: 3, value: (r) => gk(r) ? r.stats?.gaa : null, render: (r) => gk(r) ? n(r.stats?.gaa, 2) : '' },
    { key: 'saves', label: 'Saves', num: true, priority: 3, value: (r) => gk(r) ? r.stats?.saves : null, render: (r) => gk(r) ? n(r.stats?.saves) : '' },
    { key: 'save_pct', label: 'Save%', title: 'Save percentage', num: true, priority: 3, value: (r) => gk(r) ? r.stats?.save_pct : null, render: (r) => gk(r) ? fmt.pct(r.stats?.save_pct) : '' },
    { key: 'shutouts', label: 'SHO', title: 'Shutouts', num: true, priority: 3, value: (r) => gk(r) ? r.stats?.shutouts : null, render: (r) => gk(r) ? n(r.stats?.shutouts) : '' },
    { key: 'clean_sheets', label: 'CS', title: 'Clean sheets (at least 45 minutes, none conceded)', num: true, priority: 3, value: (r) => gk(r) ? r.stats?.clean_sheets : null, render: (r) => gk(r) ? n(r.stats?.clean_sheets) : '' },
    { key: 'gkrec', label: 'GK W-L-T', title: 'Record while in goal', priority: 3, value: (r) => gk(r) ? r.stats?.gk_wins : null, render: (r) => gk(r) && r.stats ? fmt.rec(r.stats.gk_wins, r.stats.gk_losses, r.stats.gk_ties) : '' },
    { key: 'pct_save_pct', label: 'Save% pctl', title: 'Percentile among division keepers with at least 180 minutes', num: true, priority: 3, value: (r) => gk(r) ? r.stats?.pct_save_pct : null, render: (r) => gk(r) ? fmt.pct(r.stats?.pct_save_pct) : '' },
    { key: 'honors', label: 'Honors', num: true, priority: 3, value: (r) => r.honors.length },
  ];
  if (admin) cols.push({ key: 'source', label: 'Identity', priority: 3, value: (r) => r.source, render: (r) => <Badge tone={r.source === 'boxscore_only' ? 'amber' : 'gray'} title={`identity confidence ${r.confidence}`}>{String(r.source).replace('site_', '')}</Badge> });
  const gkRows = preset === 'gk' ? rows.filter(gk) : rows;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Note>Computed from box scores. A shaded number differs from the school's own cumulative table.</Note>
        <label className="flex items-center gap-1.5 text-xs text-chalk-300"><input type="checkbox" checked={per90} onChange={(e) => setPer90(e.target.checked ? '1' : '')} /> per 90 minutes</label>
      </div>
      <DataTable rows={gkRows} columns={cols} rowKey={(r) => r.id} caption="Roster and season stats" rowHref={playerHref} presets={PRESETS} preset={preset} onPreset={setPreset} sort={sort} onSort={setSort} loading={loading} dense
        empty={<EmptyState title="No roster yet" body={admin ? 'Sync this program to collect its roster.' : "This school's roster has not been collected yet."} />} />
    </div>
  );
}
