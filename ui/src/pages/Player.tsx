import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api, fmt, resultOf, useAdmin } from '../lib/api';
import { useHref, genderLabel } from '../lib/filters';
import { useUrlState } from '../lib/urlState';
import { DataTable, type Column, type Preset } from '../components/DataTable';
import { Badge, EmptyState, ErrorBox, Figure, JsonViewer, ResultBadge, Section, Skeleton, TeamLogo } from '../components/primitives';

const PRESETS: Preset[] = [
  { id: 'overview', label: 'Overview', columns: ['program', 'jersey', 'position', 'class_raw', 'gp', 'gs', 'minutes', 'goals', 'assists', 'points', 'shots', 'sog', 'shot_accuracy'] },
  { id: 'rates', label: 'Per 90 & ranks', columns: ['program', 'minutes', 'goals_p90', 'assists_p90', 'conversion_pct', 'shots_per_goal', 'minutes_per_goal', 'minutes_share', 'div_rank_points', 'conf_rank_points', 'pct_points_p90', 'pct_goals_p90'] },
  { id: 'gk', label: 'Goalkeeping', columns: ['program', 'gp', 'gs', 'ga', 'gaa', 'saves', 'save_pct', 'shutouts', 'clean_sheets', 'pct_save_pct'] },
  { id: 'discipline', label: 'Discipline & extras', columns: ['program', 'gp', 'fouls', 'yc', 'rc', 'gwg', 'halves'] },
];
const SPLIT_LABEL: Record<string, string> = { home: 'Home', away: 'Away', neutral: 'Neutral', conf: 'Conference', nonconf: 'Non-conference', vs_ranked: 'Against ranked teams' };

export default function Player() {
  const { id = '' } = useParams();
  const admin = useAdmin();
  const href = useHref();
  const [preset, setPreset] = useUrlState('cols', 'overview', { replace: true, resetPage: false, allow: PRESETS.map((p) => p.id) });
  const q = useQuery({ queryKey: ['player', id], queryFn: () => api<any>(`/api/players/${id}`) });
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-40" /><Skeleton className="h-48" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const p = q.data?.player;
  if (!p) return <EmptyState title="No such player" body="The link may be out of date." action={<Link className="btn-ghost btn-sm" to="/rankings?view=leaders">Browse leaders</Link>} />;
  const seasons: any[] = q.data.seasons ?? [], honors: any[] = q.data.honors ?? [], career = q.data.career, transfers: any[] = q.data.transfers ?? [], gameLog: any[] = q.data.gameLog ?? [];
  const latest = seasons[0];
  const st = latest?.stats;
  const isGk = seasons.some((s) => s.stats?.gk_minutes > 0 || s.position === 'GK');
  const n = (v: unknown, d = 0) => fmt.num(v, d);
  const sc = (key: string, label: string, title: string, opts: { d?: number; pct?: boolean } = {}): Column<any> => ({ key, label, title, num: true, priority: 3, value: (s) => s.stats?.[key], render: (s) => opts.pct ? fmt.pct(s.stats?.[key]) : n(s.stats?.[key], opts.d ?? 0) });
  const seasonCols: Column<any>[] = [
    { key: 'season', label: 'Season', primary: true, render: (s) => String(s.season) },
    { key: 'program', label: 'Team', priority: 3, value: (s) => s.program?.name, render: (s) => <Link className="flex items-center gap-2 hover:text-pitch-300" to={href(`/teams/${s.program?.id}`, { season: s.season, gender: s.program?.gender })}><TeamLogo src={s.program?.college_schools?.logo_svg_url} name={s.program?.name} size={20} />{s.program?.name}</Link> },
    { key: 'jersey', label: '#', title: 'Jersey', num: true, priority: 3 }, { key: 'position', label: 'Pos', title: 'Position', priority: 3 }, { key: 'class_raw', label: 'Class', priority: 3 },
    sc('gp', 'GP', 'Games played'), sc('gs', 'GS', 'Games started'), sc('minutes', 'Min', 'Minutes'), sc('goals', 'G', 'Goals'), sc('assists', 'A', 'Assists'), sc('points', 'Pts', 'Points'), sc('shots', 'Sh', 'Shots'), sc('sog', 'SOG', 'Shots on goal'),
    sc('shot_accuracy', 'SOG%', 'Shot accuracy', { pct: true }), sc('conversion_pct', 'Conv%', 'Goals per shot', { pct: true }), sc('goals_p90', 'G/90', 'Goals per 90', { d: 2 }), sc('assists_p90', 'A/90', 'Assists per 90', { d: 2 }),
    sc('shots_per_goal', 'Sh/G', 'Shots per goal', { d: 1 }), sc('minutes_per_goal', 'Min/G', 'Minutes per goal'), sc('minutes_share', 'Min share', 'Share of team minutes', { pct: true }),
    sc('div_rank_points', 'Div rank', 'Division rank by points'), sc('conf_rank_points', 'Conf rank', 'Conference rank by points'), sc('pct_points_p90', 'Pts/90 pctl', 'Points per 90 percentile', { pct: true }), sc('pct_goals_p90', 'G/90 pctl', 'Goals per 90 percentile', { pct: true }),
    sc('ga', 'GA', 'Goals against'), sc('gaa', 'GAA', 'Goals against average', { d: 2 }), sc('saves', 'Saves', 'Saves'), sc('save_pct', 'Save%', 'Save percentage', { pct: true }), sc('shutouts', 'SHO', 'Shutouts'), sc('clean_sheets', 'CS', 'Clean sheets'), sc('pct_save_pct', 'Save% pctl', 'Save percentage percentile', { pct: true }),
    sc('fouls', 'Fouls', 'Fouls'), sc('yc', 'YC', 'Yellow cards'), sc('rc', 'RC', 'Red cards'), sc('gwg', 'GWG', 'Game-winning goals'),
    { key: 'halves', label: 'G by half', title: 'Goals in the first half, second half, overtime', priority: 3, value: (s) => s.stats?.goals_1h, render: (s) => s.stats ? `${s.stats.goals_1h ?? 0} / ${s.stats.goals_2h ?? 0} / ${s.stats.goals_ot ?? 0}` : '–' },
  ];
  if (admin) seasonCols.push({ key: 'source', label: 'Identity', priority: 3, render: (s) => <Badge tone={s.source === 'boxscore_only' ? 'amber' : 'gray'} title={`confidence ${s.confidence}`}>{String(s.source).replace('site_', '')}</Badge> });
  const own = (r: any) => (r.program_id ?? latest?.program?.id);
  const logCols: Column<any>[] = [
    { key: 'date', label: 'Date', primary: true, value: (r) => r.game.game_date, render: (r) => fmt.day(r.game.game_date) },
    { key: 'opp', label: 'Game', value: (r) => r.game.game_date, sortable: false, render: (r) => { const g = r.game; const home = g.home_program_id === own(r); const us = home ? g.home_score : g.away_score, them = home ? g.away_score : g.home_score; const opp = home ? g.away_name : g.home_name; return <span className="flex items-center gap-2"><span className="text-chalk-500">{home ? 'vs' : 'at'}</span><span>{opp ?? '?'}</span><ResultBadge result={resultOf(us, them)} us={us} them={them} /></span>; } },
    { key: 'starter', label: 'Start', render: (r) => r.starter ? 'Started' : r.participated ? 'Sub' : '' },
    { key: 'minutes', label: 'Min', num: true }, { key: 'goals', label: 'G', num: true }, { key: 'assists', label: 'A', num: true }, { key: 'shots', label: 'Sh', num: true, priority: 2 }, { key: 'shots_on_goal', label: 'SOG', num: true, priority: 2 },
    { key: 'fouls', label: 'Fouls', num: true, priority: 2 }, { key: 'yellow_cards', label: 'YC', num: true, priority: 2 }, { key: 'red_cards', label: 'RC', num: true, priority: 2 },
    ...(isGk ? [{ key: 'goals_allowed', label: 'GA', num: true, render: (r: any) => r.is_goalie ? n(r.goals_allowed) : '' }, { key: 'saves', label: 'Saves', num: true, render: (r: any) => r.is_goalie ? n(r.saves) : '' }] as Column<any>[] : []),
  ];
  const bioLine = latest ? [latest.position ?? latest.position_raw, latest.class_raw ? `${latest.class_raw}${latest.is_redshirt ? ' (redshirt)' : ''}` : null, latest.height_cm ? `${Math.floor(latest.height_cm / 30.48)}′${Math.round(latest.height_cm / 2.54 % 12)}″` : null, latest.weight_lb ? `${latest.weight_lb} lb` : null].filter(Boolean).join(', ') : '';
  const bioUrl = latest?.bio_url ?? p.bio_url;
  return (
    <div className="space-y-6">
      <header className="card flex flex-col gap-5 p-4 sm:flex-row sm:items-start sm:p-6">
        <TeamLogo src={latest?.headshot_url ?? p.headshot_url} name={p.display_name} size={88} />
        <div className="min-w-0 flex-1">
          <h1 className="display text-3xl leading-none sm:text-4xl">{p.display_name}{p.suppress && <Badge tone="red" className="ml-2 align-middle">suppressed</Badge>}</h1>
          {latest?.program && <p className="mt-2 text-sm text-chalk-300"><Link className="font-medium text-chalk-100 hover:text-pitch-300" to={href(`/teams/${latest.program.id}`, { season: latest.season, gender: latest.program.gender })}>{latest.program.name}</Link> {genderLabel(latest.program.gender)} soccer{latest.jersey != null ? `, No. ${latest.jersey}` : ''}{bioLine ? `, ${bioLine}` : ''}</p>}
          <p className="mt-1 text-sm text-chalk-400">{[latest?.hometown_raw ? `From ${latest.hometown_raw}` : null, (latest?.high_school ?? p.high_school) ? `${latest?.high_school ?? p.high_school}` : null, latest?.previous_school ? `previously ${latest.previous_school}` : null, latest?.major ? `studying ${latest.major}` : null].filter(Boolean).join('; ') || 'No bio collected yet.'}</p>
          {bioUrl && <a className="mt-1 inline-flex items-center gap-1 text-xs text-pitch-400 hover:text-pitch-300" href={bioUrl} target="_blank" rel="noreferrer">School bio <ExternalLink size={12} aria-hidden /></a>}
        </div>
        {st && (
          <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-3 sm:justify-end">
            {isGk ? <>
              <Figure big label={`${latest.season} save %`} value={fmt.pct(st.save_pct)} sub={`${st.saves ?? 0} saves`} />
              <Figure label="Goals against avg" value={n(st.gaa, 2)} sub={`${st.ga ?? 0} conceded in ${n(st.gk_minutes)} min`} />
              <Figure label="Shutouts" value={st.shutouts ?? 0} />
            </> : <>
              <Figure big label={`${latest.season} goals`} value={st.goals ?? 0} sub={`${st.assists ?? 0} assists`} />
              <Figure label="Games" value={`${st.gp ?? 0}`} sub={`${st.gs ?? 0} starts, ${n(st.minutes)} min`} />
              <Figure label="Goals per 90" value={n(st.goals_p90, 2)} sub={st.pct_goals_p90 != null ? `${fmt.pct(st.pct_goals_p90)} percentile` : undefined} />
            </>}
          </div>
        )}
      </header>
      {career && seasons.length > 1 && (
        <div className="grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-6">
          <Figure label="Seasons" value={career.seasons} sub={`${career.programs} program${career.programs === 1 ? '' : 's'}`} />
          <Figure label="Games" value={career.gp ?? 0} sub={`${career.gs ?? 0} starts`} />
          <Figure label="Minutes" value={n(career.minutes)} />
          <Figure label="Goals" value={career.goals ?? 0} /><Figure label="Assists" value={career.assists ?? 0} /><Figure label="Shots" value={career.shots ?? 0} sub={`${career.sog ?? 0} on goal`} />
        </div>
      )}
      <Section title="Seasons">
        <DataTable rows={seasons} columns={seasonCols} rowKey={(s) => s.id} caption="Season by season" presets={PRESETS} preset={preset} onPreset={setPreset} dense empty={<EmptyState title="No seasons recorded" />} />
      </Section>
      {latest?.splits?.length > 0 && (
        <Section title={`Splits, ${latest.season}`}>
          <div className="frame overflow-x-auto"><table className="w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Season splits</caption>
            <thead><tr><th scope="col" className="th">Split</th><th scope="col" className="th text-right">GP</th><th scope="col" className="th text-right">GS</th><th scope="col" className="th text-right">Min</th><th scope="col" className="th text-right">G</th><th scope="col" className="th text-right">A</th><th scope="col" className="th text-right">Pts</th><th scope="col" className="th hidden text-right sm:table-cell">Sh</th><th scope="col" className="th hidden text-right sm:table-cell">SOG</th>{isGk && <><th scope="col" className="th text-right">Saves</th><th scope="col" className="th text-right">GA</th></>}</tr></thead>
            <tbody>{['home', 'away', 'neutral', 'conf', 'nonconf', 'vs_ranked'].map((k) => latest.splits.find((x: any) => x.split === k)).filter(Boolean).map((x: any) => <tr key={x.split}><th scope="row" className="td text-left font-normal text-chalk-300">{SPLIT_LABEL[x.split] ?? x.split}</th><td className="td num">{x.gp}</td><td className="td num">{x.gs}</td><td className="td num">{n(x.minutes)}</td><td className="td num">{n(x.goals)}</td><td className="td num">{n(x.assists)}</td><td className="td num">{n(x.points)}</td><td className="td num hidden sm:table-cell">{n(x.shots)}</td><td className="td num hidden sm:table-cell">{n(x.sog)}</td>{isGk && <><td className="td num">{n(x.saves)}</td><td className="td num">{n(x.ga)}</td></>}</tr>)}</tbody>
          </table></div>
        </Section>
      )}
      {latest?.ranks?.length > 0 && <Section title={`National ranks, ${latest.season}`}><ul className="flex flex-wrap gap-1.5">{latest.ranks.map((r: any) => <li key={r.category} className="chip"><span className="text-chalk-100 tnum">{fmt.ordinal(r.rank)}</span>{r.category}<span className="text-chalk-500 tnum">{n(r.value, Number(r.value) % 1 ? 2 : 0)}</span></li>)}</ul></Section>}
      {transfers.length > 0 && <Section title="Transfers"><ul className="frame divide-y divide-field-700 text-sm">{transfers.map((t: any) => <li key={t.id} className="px-3 py-2">{t.from_season} to {t.to_season}{admin && <span className="text-chalk-500"> (confidence {t.confidence}, {t.evidence?.rule})</span>}</li>)}</ul></Section>}
      {honors.length > 0 && <Section title="Honors"><ul className="frame divide-y divide-field-700 text-sm">{honors.map((h: any) => <li key={h.id} className="flex items-center gap-2 px-3 py-2"><span>{h.text}</span>{h.source_url && <a className="ml-auto inline-flex items-center gap-1 text-xs text-pitch-400 hover:text-pitch-300" href={h.source_url} target="_blank" rel="noreferrer">source <ExternalLink size={11} aria-hidden /></a>}</li>)}</ul></Section>}
      <Section title="Game log">
        <DataTable rows={gameLog} columns={logCols} rowKey={(r) => `${r.game.id}-${r.source}`} caption="Game by game" rowHref={(r) => href(`/matches/${r.game.id}`)} dense defaultSort={{ key: 'date', dir: 'desc' }} empty={<EmptyState title="No box scores yet" body="Game-by-game lines appear once box scores are collected." />} />
      </Section>
      {admin && <JsonViewer title="Identity row" value={p} />}
    </div>
  );
}
