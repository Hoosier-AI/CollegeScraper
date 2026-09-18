import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, useAdmin } from '../lib/api';
import { useKeepQuery } from '../lib/filters';
import { Badge, DataTable, DiffCell, ErrorBox, JsonViewer, Section, Spinner, Stat, TeamLogo, type Column } from '../components/ui';

export default function Player() {
  const { id = '' } = useParams();
  const admin = useAdmin();
  const keep = useKeepQuery();
  const q = useQuery({ queryKey: ['player', id], queryFn: () => api<any>(`/api/players/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { player: p, seasons, honors, career, transfers, gameLog } = q.data;
  const latest = seasons[0];
  const seasonCols: Column<any>[] = [
    { key: 'season', label: 'Season', sticky: true, render: (s) => <Link className="hover:text-teal-400" to={keep(`/teams/${s.program?.id}?season=${s.season}`)}>{s.season}</Link> },
    { key: 'program', label: 'Program', value: (s) => s.program?.name, render: (s) => <span className="flex items-center gap-2"><TeamLogo src={s.program?.college_schools?.logo_svg_url} name={s.program?.name} size={20} />{s.program?.name}</span> },
    { key: 'jersey', label: '#', num: true }, { key: 'position', label: 'Pos' }, { key: 'class_raw', label: 'Class' },
    { key: 'gp', label: 'GP', num: true, value: (s) => s.stats?.gp, render: (s) => <DiffCell value={s.stats?.gp} vs={s.site?.gp} tolerance={1} /> }, { key: 'gs', label: 'GS', num: true, value: (s) => s.stats?.gs },
    { key: 'minutes', label: 'MIN', num: true, value: (s) => s.stats?.minutes, render: (s) => <DiffCell value={s.stats?.minutes} vs={s.site?.minutes} tolerance={10} /> },
    { key: 'goals', label: 'G', num: true, value: (s) => s.stats?.goals, render: (s) => <DiffCell value={s.stats?.goals} vs={s.site?.goals} /> }, { key: 'assists', label: 'A', num: true, value: (s) => s.stats?.assists, render: (s) => <DiffCell value={s.stats?.assists} vs={s.site?.assists} /> }, { key: 'points', label: 'PTS', num: true, value: (s) => s.stats?.points },
    { key: 'shots', label: 'SH', num: true, value: (s) => s.stats?.shots }, { key: 'sog', label: 'SOG', num: true, value: (s) => s.stats?.sog }, { key: 'goals_p90', label: 'G/90', num: true, value: (s) => s.stats?.goals_p90, render: (s) => fmt.num(s.stats?.goals_p90, 2) }, { key: 'assists_p90', label: 'A/90', num: true, value: (s) => s.stats?.assists_p90, render: (s) => fmt.num(s.stats?.assists_p90, 2) },
    { key: 'shot_accuracy', label: 'SOG%', num: true, value: (s) => s.stats?.shot_accuracy, render: (s) => fmt.pct(s.stats?.shot_accuracy) }, { key: 'conversion_pct', label: 'Conv%', num: true, value: (s) => s.stats?.conversion_pct, render: (s) => fmt.pct(s.stats?.conversion_pct) },
    { key: 'yc', label: 'YC', num: true, value: (s) => s.stats?.yc }, { key: 'rc', label: 'RC', num: true, value: (s) => s.stats?.rc }, { key: 'fouls', label: 'Fouls', num: true, value: (s) => s.stats?.fouls }, { key: 'gwg', label: 'GWG', num: true, value: (s) => s.stats?.gwg },
    { key: 'ga', label: 'GA', num: true, value: (s) => s.stats?.ga }, { key: 'gaa', label: 'GAA', num: true, value: (s) => s.stats?.gaa, render: (s) => fmt.num(s.stats?.gaa, 2) }, { key: 'saves', label: 'SV', num: true, value: (s) => s.stats?.saves }, { key: 'save_pct', label: 'SV%', num: true, value: (s) => s.stats?.save_pct, render: (s) => fmt.pct(s.stats?.save_pct) }, { key: 'shutouts', label: 'SHO', num: true, value: (s) => s.stats?.shutouts },
    { key: 'minutes_share', label: 'Min share', num: true, value: (s) => s.stats?.minutes_share, render: (s) => fmt.pct(s.stats?.minutes_share) },
    { key: 'halves', label: 'G 1H·2H·OT', value: (s) => s.stats?.goals_1h, render: (s) => s.stats ? `${s.stats.goals_1h ?? 0}·${s.stats.goals_2h ?? 0}·${s.stats.goals_ot ?? 0}` : '–' },
    { key: 'div_rank_points', label: 'Div rk (pts)', num: true, value: (s) => s.stats?.div_rank_points }, { key: 'div_rank_goals', label: 'Div rk (G)', num: true, value: (s) => s.stats?.div_rank_goals }, { key: 'conf_rank_points', label: 'Conf rk', num: true, value: (s) => s.stats?.conf_rank_points },
    { key: 'pct_points_p90', label: 'Pts/90 pctl', num: true, value: (s) => s.stats?.pct_points_p90, render: (s) => fmt.pct(s.stats?.pct_points_p90) }, { key: 'pct_goals_p90', label: 'G/90 pctl', num: true, value: (s) => s.stats?.pct_goals_p90, render: (s) => fmt.pct(s.stats?.pct_goals_p90) }, { key: 'pct_shots_p90', label: 'SH/90 pctl', num: true, value: (s) => s.stats?.pct_shots_p90, render: (s) => fmt.pct(s.stats?.pct_shots_p90) },
    { key: 'shots_per_goal', label: 'SH/G', num: true, value: (s) => s.stats?.shots_per_goal, render: (s) => fmt.num(s.stats?.shots_per_goal, 1) }, { key: 'minutes_per_goal', label: 'MIN/G', num: true, value: (s) => s.stats?.minutes_per_goal, render: (s) => fmt.num(s.stats?.minutes_per_goal, 0) },
    { key: 'clean_sheets', label: 'CS', num: true, value: (s) => s.stats?.clean_sheets }, { key: 'pct_save_pct', label: 'SV% pctl', num: true, value: (s) => s.stats?.pct_save_pct, render: (s) => fmt.pct(s.stats?.pct_save_pct) }, { key: 'source', label: 'Src', render: (s) => <Badge tone={s.source === 'boxscore_only' ? 'amber' : 'gray'} title={`confidence ${s.confidence}`}>{s.source.replace('site_', '')}</Badge> },
  ];
  const logCols: Column<any>[] = [
    { key: 'date', label: 'Date', sticky: true, value: (r) => r.game.game_date, render: (r) => <Link className="hover:text-teal-400" to={keep(`/games/${r.game.id}`)}>{fmt.date(r.game.game_date)}</Link> },
    { key: 'opp', label: 'Game', value: (r) => `${r.game.away_name} @ ${r.game.home_name}`, render: (r) => `${r.game.away_name ?? '?'} ${r.game.away_score ?? ''} @ ${r.game.home_name ?? '?'} ${r.game.home_score ?? ''}` },
    { key: 'starter', label: 'GS', render: (r) => r.starter ? '★' : '' }, { key: 'minutes', label: 'MIN', num: true }, { key: 'goals', label: 'G', num: true }, { key: 'assists', label: 'A', num: true }, { key: 'shots', label: 'SH', num: true }, { key: 'shots_on_goal', label: 'SOG', num: true }, { key: 'fouls', label: 'Fouls', num: true }, { key: 'yellow_cards', label: 'YC', num: true }, { key: 'red_cards', label: 'RC', num: true }, { key: 'corners', label: 'CK', num: true },
    { key: 'goals_allowed', label: 'GA', num: true, render: (r) => r.is_goalie ? fmt.num(r.goals_allowed) : '' }, { key: 'saves', label: 'SV', num: true, render: (r) => r.is_goalie ? fmt.num(r.saves) : '' }, { key: 'source', label: 'Src', render: (r) => <Badge tone={r.source === 'site' ? 'teal' : 'blue'}>{r.source}</Badge> },
  ];
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-4">
        <TeamLogo src={latest?.headshot_url ?? p.headshot_url} name={p.display_name} size={96} />
        <div className="min-w-[240px]">
          <h1 className="text-2xl font-black">{p.display_name}{p.suppress && <Badge tone="red">suppressed</Badge>}</h1>
          <div className="text-sm text-ink-400">{latest ? <>#{latest.jersey ?? '–'} · {latest.position ?? latest.position_raw ?? '–'} · {latest.class_raw ?? '–'}{latest.is_redshirt ? ' (RS)' : ''} · {latest.height_cm ? `${Math.floor(latest.height_cm / 30.48)}-${Math.round(latest.height_cm / 2.54 % 12)}` : '–'}{latest.weight_lb ? ` · ${latest.weight_lb} lb` : ''}</> : 'no season row'}</div>
          <div className="mt-1 text-sm text-ink-400">Hometown: {latest?.hometown_raw ?? '–'}{admin && <span className="text-ink-500"> ({[p.hometown_city, p.hometown_region, p.hometown_country].filter(Boolean).join(', ') || 'unparsed'})</span>}</div>
          <div className="text-sm text-ink-400">High school: {latest?.high_school ?? p.high_school ?? '–'} · Previous school: {latest?.previous_school ?? '–'} · Major: {latest?.major ?? '–'}</div>
          <div className="mt-1 flex gap-2 text-xs">{(latest?.bio_url ?? p.bio_url) && <a className="text-teal-400 hover:underline" href={latest?.bio_url ?? p.bio_url} target="_blank" rel="noreferrer">school bio</a>}</div>
        </div>
        {career && <div className="ml-auto grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat label="Seasons" value={career.seasons} sub={`${career.programs} program${career.programs === 1 ? '' : 's'}`} /><Stat label="GP / GS" value={`${career.gp ?? 0} / ${career.gs ?? 0}`} /><Stat label="Minutes" value={fmt.num(career.minutes)} /><Stat label="G / A / PTS" value={`${career.goals ?? 0} / ${career.assists ?? 0} / ${career.points ?? 0}`} /><Stat label="SH / SOG" value={`${career.shots ?? 0} / ${career.sog ?? 0}`} /><Stat label="GK" value={career.gk_minutes ? `${career.ga} GA · ${career.saves} SV` : '–'} sub={career.shutouts ? `${career.shutouts} SHO` : undefined} />
        </div>}
      </div>
      <Section title="Seasons"><DataTable rows={seasons} columns={seasonCols} rowKey={(s) => s.id} dense /></Section>
      {latest?.splits?.length > 0 && <Section title={`Splits · ${latest.season}`}>
        <div className="overflow-auto rounded-xl border border-navy-700"><table className="min-w-full text-sm"><thead><tr><th className="th">Split</th><th className="th text-right">GP</th><th className="th text-right">GS</th><th className="th text-right">MIN</th><th className="th text-right">G</th><th className="th text-right">A</th><th className="th text-right">PTS</th><th className="th text-right">SH</th><th className="th text-right">SOG</th><th className="th text-right">SV</th><th className="th text-right">GA</th></tr></thead><tbody>
          {['home', 'away', 'neutral', 'conf', 'nonconf', 'vs_ranked'].map((k) => latest.splits.find((x: any) => x.split === k)).filter(Boolean).map((x: any) => <tr key={x.split}><td className="td">{{ home: 'Home', away: 'Away', neutral: 'Neutral', conf: 'Conference', nonconf: 'Non-conference', vs_ranked: 'vs ranked (USC top 25)' }[x.split as string]}</td><td className="td num">{x.gp}</td><td className="td num">{x.gs}</td><td className="td num">{fmt.num(x.minutes)}</td><td className="td num">{fmt.num(x.goals)}</td><td className="td num">{fmt.num(x.assists)}</td><td className="td num">{fmt.num(x.points)}</td><td className="td num">{fmt.num(x.shots)}</td><td className="td num">{fmt.num(x.sog)}</td><td className="td num">{fmt.num(x.saves)}</td><td className="td num">{fmt.num(x.ga)}</td></tr>)}
        </tbody></table></div>
      </Section>}
      {latest?.ranks?.length > 0 && <Section title={`NCAA.com national ranks · ${latest.season}`}><div className="flex flex-wrap gap-2">{latest.ranks.map((r: any) => <span key={r.category} className="rounded-lg border border-navy-700 bg-navy-950/60 px-2 py-1 text-sm"><span className="text-ink-400">{r.category}</span> <b className="text-teal-400">#{r.rank}</b> <span className="text-ink-500">{fmt.num(r.value, Number(r.value) % 1 ? 2 : 0)}</span></span>)}</div></Section>}
      {transfers.length > 0 && <Section title="Transfers"><ul className="text-sm">{transfers.map((t: any) => <li key={t.id}>{t.from_season} → {t.to_season}: confidence {t.confidence} ({t.evidence?.rule})</li>)}</ul></Section>}
      <Section title={`Honors (${honors.length})`}>{honors.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{honors.map((h: any) => <li key={h.id}>{h.text}{h.source_url && <a className="ml-2 text-xs text-teal-400" href={h.source_url} target="_blank" rel="noreferrer">source</a>}</li>)}</ul> : <p className="text-sm text-ink-500">None extracted.</p>}</Section>
      <Section title={`Game log (${gameLog.length})`}><DataTable rows={gameLog} columns={logCols} rowKey={(r) => `${r.game.id}-${r.source}`} dense /></Section>
      {admin && <JsonViewer title="identity row" value={p} />}
    </div>
  );
}
