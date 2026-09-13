import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, fmt } from '../lib/api';
import { useFilters, useKeepQuery } from '../lib/filters';
import { Badge, DataTable, DiffCell, ErrorBox, Section, SourceBadge, Spinner, Stat, Tabs, TeamLogo, type Column } from '../components/ui';
import { RunProgress } from '../components/RunProgress';

type Tab = 'roster' | 'games' | 'coaches' | 'honors';

export default function Team() {
  const { id = '' } = useParams();
  const f = useFilters();
  const keep = useKeepQuery();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('roster');
  const [per90, setPer90] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const team = useQuery({ queryKey: ['program', id, f.season], queryFn: () => api<any>(`/api/programs/${id}${qs({ season: f.season })}`) });
  const roster = useQuery({ queryKey: ['roster', id, f.season], queryFn: () => api<any[]>(`/api/programs/${id}/roster${qs({ season: f.season })}`) });
  const games = useQuery({ queryKey: ['pgames', id, f.season], queryFn: () => api<any[]>(`/api/programs/${id}/games${qs({ season: f.season })}`) });
  const sync = useMutation({ mutationFn: (force: boolean) => api<{ id: string }>(`/api/programs/${id}/sync`, { method: 'POST', body: JSON.stringify({ season: f.season, force }) }), onSuccess: (r) => setRunId(r.id) });
  const refreshAll = () => { qc.invalidateQueries({ queryKey: ['program', id] }); qc.invalidateQueries({ queryKey: ['roster', id] }); qc.invalidateQueries({ queryKey: ['pgames', id] }); };
  if (team.isLoading) return <Spinner />;
  if (team.error) return <ErrorBox error={team.error} />;
  const t = team.data; const p = t.program; const s = t.teamStats; const school = p.college_schools;
  const honors = (roster.data ?? []).flatMap((r: any) => r.honors.map((h: string) => ({ player: r.player?.display_name, id: r.player?.id, text: h })));
  const gk = (r: any) => r.stats?.gk_minutes > 0 || r.position === 'GK';
  const p90 = (v: number | null, min: number | null) => (v == null || !min ? null : Math.round((v * 90 / min) * 100) / 100);
  const rosterCols: Column<any>[] = [
    { key: 'jersey', label: '#', num: true, value: (r) => r.jersey },
    { key: 'name', label: 'Player', sticky: true, value: (r) => r.player?.display_name, render: (r) => <span className="flex items-center gap-2"><TeamLogo src={r.headshot_url ?? r.player?.headshot_url} name={r.player?.display_name} size={22} />{r.player?.display_name}{r.is_captain && <Badge tone="amber">C</Badge>}</span> },
    { key: 'position', label: 'Pos', value: (r) => r.position ?? r.position_raw },
    { key: 'class_raw', label: 'Class', value: (r) => r.class_raw },
    { key: 'height_cm', label: 'Ht', value: (r) => r.height_cm, render: (r) => r.height_cm ? `${Math.floor(r.height_cm / 30.48)}-${Math.round(r.height_cm / 2.54 % 12)}` : '–' },
    { key: 'hometown_raw', label: 'Hometown', value: (r) => r.hometown_raw },
    { key: 'previous_school', label: 'Prev school', value: (r) => r.previous_school },
    { key: 'gp', label: 'GP', num: true, value: (r) => r.stats?.gp, render: (r) => <DiffCell value={r.stats?.gp} vs={r.site?.gp} tolerance={1} /> },
    { key: 'gs', label: 'GS', num: true, value: (r) => r.stats?.gs, render: (r) => <DiffCell value={r.stats?.gs} vs={r.site?.gs} tolerance={1} /> },
    { key: 'minutes', label: 'MIN', num: true, value: (r) => r.stats?.minutes, render: (r) => <DiffCell value={r.stats?.minutes} vs={r.site?.minutes} tolerance={10} /> },
    { key: 'goals', label: per90 ? 'G/90' : 'G', num: true, value: (r) => per90 ? r.stats?.goals_p90 : r.stats?.goals, render: (r) => per90 ? fmt.num(r.stats?.goals_p90, 2) : <DiffCell value={r.stats?.goals} vs={r.site?.goals} /> },
    { key: 'assists', label: per90 ? 'A/90' : 'A', num: true, value: (r) => per90 ? r.stats?.assists_p90 : r.stats?.assists, render: (r) => per90 ? fmt.num(r.stats?.assists_p90, 2) : <DiffCell value={r.stats?.assists} vs={r.site?.assists} /> },
    { key: 'points', label: per90 ? 'PTS/90' : 'PTS', num: true, value: (r) => per90 ? r.stats?.points_p90 : r.stats?.points, render: (r) => per90 ? fmt.num(r.stats?.points_p90, 2) : <DiffCell value={r.stats?.points} vs={r.site?.points} /> },
    { key: 'shots', label: per90 ? 'SH/90' : 'SH', num: true, value: (r) => per90 ? r.stats?.shots_p90 : r.stats?.shots, render: (r) => per90 ? fmt.num(r.stats?.shots_p90, 2) : <DiffCell value={r.stats?.shots} vs={r.site?.shots} /> },
    { key: 'sog', label: per90 ? 'SOG/90' : 'SOG', num: true, value: (r) => per90 ? r.stats?.sog_p90 : r.stats?.sog, render: (r) => per90 ? fmt.num(r.stats?.sog_p90, 2) : <DiffCell value={r.stats?.sog} vs={r.site?.sog} /> },
    { key: 'shot_accuracy', label: 'SOG%', num: true, value: (r) => r.stats?.shot_accuracy, render: (r) => fmt.pct(r.stats?.shot_accuracy) },
    { key: 'conversion_pct', label: 'Conv%', num: true, value: (r) => r.stats?.conversion_pct, render: (r) => fmt.pct(r.stats?.conversion_pct) },
    { key: 'pk', label: 'PK', value: (r) => r.stats?.pk_goals, render: (r) => r.stats ? `${r.stats.pk_goals ?? 0}-${r.stats.pk_att ?? 0}` : '–' },
    { key: 'yc', label: 'YC', num: true, value: (r) => r.stats?.yc, render: (r) => <DiffCell value={r.stats?.yc} vs={r.site?.yc} /> },
    { key: 'rc', label: 'RC', num: true, value: (r) => r.stats?.rc, render: (r) => <DiffCell value={r.stats?.rc} vs={r.site?.rc} /> },
    { key: 'fouls', label: 'Fouls', num: true, value: (r) => r.stats?.fouls },
    { key: 'corners', label: 'CK', num: true, value: (r) => r.stats?.corners },
    { key: 'gwg', label: 'GWG', num: true, value: (r) => r.stats?.gwg, render: (r) => <DiffCell value={r.stats?.gwg} vs={r.site?.gwg} /> },
    { key: 'ga', label: 'GA', num: true, value: (r) => gk(r) ? r.stats?.ga : null, render: (r) => gk(r) ? fmt.num(r.stats?.ga) : '' },
    { key: 'gaa', label: 'GAA', num: true, value: (r) => gk(r) ? r.stats?.gaa : null, render: (r) => gk(r) ? fmt.num(r.stats?.gaa, 2) : '' },
    { key: 'saves', label: 'SV', num: true, value: (r) => gk(r) ? r.stats?.saves : null, render: (r) => gk(r) ? fmt.num(r.stats?.saves) : '' },
    { key: 'save_pct', label: 'SV%', num: true, value: (r) => gk(r) ? r.stats?.save_pct : null, render: (r) => gk(r) ? fmt.pct(r.stats?.save_pct) : '' },
    { key: 'shutouts', label: 'SHO', num: true, value: (r) => gk(r) ? r.stats?.shutouts : null, render: (r) => gk(r) ? fmt.num(r.stats?.shutouts) : '' },
    { key: 'gkrec', label: 'GK W-L-T', value: (r) => gk(r) ? r.stats?.gk_wins : null, render: (r) => gk(r) && r.stats ? fmt.rec(r.stats.gk_wins, r.stats.gk_losses, r.stats.gk_ties) : '' },
    { key: 'source', label: 'Src', value: (r) => r.source, render: (r) => <Badge tone={r.source === 'boxscore_only' ? 'amber' : 'gray'} title={`identity confidence ${r.confidence}`}>{r.source.replace('site_', '')}</Badge> },
    { key: 'honors', label: 'Honors', num: true, value: (r) => r.honors.length },
  ];
  void p90;
  const gameCols: Column<any>[] = [
    { key: 'game_date', label: 'Date', sticky: true, render: (g) => fmt.date(g.game_date) },
    { key: 'opp', label: 'Opponent', value: (g) => g.home_program_id === id ? g.away_name : g.home_name, render: (g) => { const home = g.home_program_id === id; return <span className="flex items-center gap-2"><TeamLogo src={home ? g.away_logo : g.home_logo} name={home ? g.away_name : g.home_name} size={20} />{g.neutral_site ? 'vs' : home ? 'vs' : 'at'} {(home ? g.away_name : g.home_name) ?? '?'}</span>; } },
    { key: 'result', label: 'Result', value: (g) => g.status, render: (g) => { if (g.status !== 'final') return <Badge>{g.status}</Badge>; const home = g.home_program_id === id; const us = home ? g.home_score : g.away_score, them = home ? g.away_score : g.home_score; const r = us > them ? 'W' : us < them ? 'L' : 'T'; return <span className={r === 'W' ? 'text-emerald-300' : r === 'L' ? 'text-red-300' : 'text-ink-300'}>{r} {us}-{them}{g.overtime ? ' (OT)' : ''}{g.shootout ? ' (PK)' : ''}</span>; } },
    { key: 'conference_game', label: 'Conf', render: (g) => g.conference_game ? '✓' : '' },
    { key: 'attendance', label: 'Att', num: true },
    { key: 'venue_name', label: 'Venue', value: (g) => g.venue_name ? `${g.venue_name}${g.venue_city ? ', ' + g.venue_city : ''}` : '' },
    { key: 'truth', label: 'Truth', value: (g) => g.source_of_truth, render: (g) => <SourceBadge source={g.source_of_truth} /> },
    { key: 'sources', label: 'Have', render: (g) => <span className="flex gap-1">{g.team_stats.some((t: any) => t.source === 'site') && <Badge tone="teal">site</Badge>}{g.team_stats.some((t: any) => t.source === 'ncaa') && <Badge tone="blue">ncaa</Badge>}</span> },
    { key: 'sh', label: 'SH', num: true, value: (g) => g.team_stats.find((t: any) => t.program_id === id && t.source === g.source_of_truth)?.shots },
    { key: 'sog', label: 'SOG', num: true, value: (g) => g.team_stats.find((t: any) => t.program_id === id && t.source === g.source_of_truth)?.shots_on_goal },
    { key: 'ck', label: 'CK', num: true, value: (g) => g.team_stats.find((t: any) => t.program_id === id && t.source === g.source_of_truth)?.corners },
    { key: 'fo', label: 'Fouls', num: true, value: (g) => g.team_stats.find((t: any) => t.program_id === id && t.source === g.source_of_truth)?.fouls },
  ];
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-start gap-4">
        <TeamLogo src={school?.logo_svg_url} name={p.name} size={64} />
        <div className="min-w-[240px]">
          <h1 className="text-2xl font-black">{p.name} <span className="text-base font-normal text-ink-400">{p.gender === 'm' ? "men's" : "women's"} · {f.season}</span></h1>
          <div className="mt-1 flex flex-wrap gap-2 text-sm text-ink-400">
            <span>{(t.season?.division ?? '').toUpperCase()}</span><span>{t.season?.college_conferences?.name ?? 'no conference'}</span>
            {school?.athletics_host && <a className="text-teal-400 hover:underline" href={`https://${school.athletics_host}`} target="_blank" rel="noreferrer">{school.athletics_host}</a>}
            <Badge tone={school?.site_platform === 'sidearm' ? 'teal' : 'blue'}>{school?.site_platform}</Badge>
            {t.standing && <span>Conf {fmt.rec(t.standing.conf_w, t.standing.conf_l, t.standing.conf_t)} · #{t.standing.rank ?? '–'}</span>}
            {t.rankings?.[0] && <Badge tone="amber">{t.rankings[0].poll} #{t.rankings[0].rank}</Badge>}
          </div>
          <div className="mt-1 text-xs text-ink-500">roster {fmt.ago(t.season?.roster_synced_at)} · schedule {fmt.ago(t.season?.schedule_synced_at)} · stats {fmt.ago(t.season?.stats_synced_at)} · box scores {fmt.ago(t.season?.boxscores_synced_at)}{t.season?.site_parse_failures ? ` · ${t.season.site_parse_failures} parse failures` : ''}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {runId ? <RunProgress runId={runId} onDone={() => { setRunId(null); refreshAll(); }} /> : <>
              <button className="btn-primary" onClick={() => sync.mutate(false)} disabled={sync.isPending}>Sync now</button>
              <button className="btn-ghost" onClick={() => sync.mutate(true)} disabled={sync.isPending} title="Ignore the fetch cache and re-download everything">Force re-sync</button>
            </>}
            {t.runs?.[0] && !runId && <span className="text-xs text-ink-500">last run: {t.runs[0].job} {t.runs[0].status} {fmt.ago(t.runs[0].finished_at ?? t.runs[0].started_at)}</span>}
          </div>
        </div>
        {s && <div className="ml-auto grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="Record" value={fmt.rec(s.w, s.l, s.t)} sub={`conf ${fmt.rec(s.conf_w, s.conf_l, s.conf_t)}`} />
          <Stat label="Home / Away / Neutral" value={`${fmt.rec(s.home_w, s.home_l, s.home_t)}`} sub={`${fmt.rec(s.away_w, s.away_l, s.away_t)} · ${fmt.rec(s.neutral_w, s.neutral_l, s.neutral_t)}`} />
          <Stat label="GF / GA" value={`${s.gf ?? '–'} / ${s.ga ?? '–'}`} sub={`${fmt.num(s.gf_pg, 2)} / ${fmt.num(s.ga_pg, 2)} per game · GD ${s.gd ?? '–'}`} />
          <Stat label="Shots / SOG per game" value={`${fmt.num(s.shots_pg, 1)} / ${fmt.num(s.sog_pg, 1)}`} sub={`${s.shots ?? '–'} / ${s.sog ?? '–'} total`} />
          <Stat label="Corners / Fouls / Offsides" value={`${s.corners ?? '–'} / ${s.fouls ?? '–'} / ${s.offsides ?? '–'}`} sub={`${fmt.num(s.corners_pg, 1)} CK per game`} />
          <Stat label="Clean sheets · Cards" value={`${s.clean_sheets ?? '–'} · ${s.yc ?? 0}Y ${s.rc ?? 0}R`} sub={`form ${s.form_last5 ?? '–'} · streak ${s.streak ?? '–'} · att ${fmt.num(s.avg_attendance)}`} />
        </div>}
        {!s && <div className="ml-auto text-sm text-ink-500">No aggregates yet — press Sync now.</div>}
      </div>

      <Tabs tabs={[{ id: 'roster', label: 'Roster & season stats', count: roster.data?.length }, { id: 'games', label: 'Games', count: games.data?.length }, { id: 'coaches', label: 'Coaches', count: t.coaches?.length }, { id: 'honors', label: 'Honors', count: honors.length }]} value={tab} onChange={setTab} />

      {tab === 'roster' && (
        <Section title="Roster & season stats" right={<label className="flex items-center gap-2 text-sm text-ink-400"><input type="checkbox" checked={per90} onChange={(e) => setPer90(e.target.checked)} /> per 90</label>}>
          <p className="text-xs text-ink-500">Computed from truth-source box scores. Amber cells differ from the school's own cumulative table (shown in parentheses).</p>
          {roster.isLoading ? <Spinner /> : <DataTable rows={roster.data ?? []} columns={rosterCols} rowKey={(r) => r.id} rowHref={(r) => keep(`/players/${r.player?.id}`)} defaultSort={{ key: 'jersey', dir: 'asc' }} dense empty="No roster — sync this program." />}
        </Section>
      )}
      {tab === 'games' && (games.isLoading ? <Spinner /> : <DataTable rows={games.data ?? []} columns={gameCols} rowKey={(g) => g.id} rowHref={(g) => keep(`/games/${g.id}`)} dense empty="No games yet." />)}
      {tab === 'coaches' && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(t.coaches ?? []).map((c: any) => <div key={c.college_coaches?.id} className="card flex items-center gap-3"><TeamLogo src={c.college_coaches?.headshot_url} name={c.college_coaches?.name} size={40} /><div><div className="font-semibold">{c.college_coaches?.name}</div><div className="text-xs text-ink-400">{c.title}{c.is_head && ' · head'}</div></div></div>)}{!t.coaches?.length && <p className="text-sm text-ink-500">No coaches stored.</p>}</div>}
      {tab === 'honors' && <ul className="space-y-1 text-sm">{honors.map((h: any, i: number) => <li key={i}><Link className="text-teal-400 hover:underline" to={keep(`/players/${h.id}`)}>{h.player}</Link> — {h.text}</li>)}{!honors.length && <p className="text-ink-500">No honors extracted.</p>}</ul>}
    </div>
  );
}
