// One college player. Tabs in the order every area uses: Overview (career figures, splits, national ranks, honors),
// Stats (season by season), Matches (game log), Career (transfers, the pro career), News.
import { PlayerRail } from '../components/player/PlayerRail';
import { GameForm, type FormGame } from '../components/player/GameForm';
import { FormLine } from '../components/pro/Charts';
import { RatingBadge } from '../components/Rating';
import { SeasonBars } from '../components/pro/Charts';
import { PageActions } from '../components/PageActions';
import { Link, useLocation, useParams } from 'react-router-dom';
import { NewsFeed } from '../components/news/News';
import { Crumbs } from '../components/shell';
import { positionWord } from '../components/player/KeyFacts';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ExternalLink, Trophy } from 'lucide-react';
import { api, fmt, resultOf, useAdmin } from '../lib/api';
import { useHref, genderLabel } from '../lib/filters';
import { useUrlState } from '../lib/urlState';
import { useEntityId } from '../lib/entity';
import { DataTable, type Column, type Preset } from '../components/DataTable';
import { PlayerAvatar, Badge, EmptyState, ErrorBox, Figure, JsonViewer, ResultBadge, Section, Skeleton, TabsNav, TeamLogo, PageWithRail, HeroStat } from '../components/primitives';

type Tab = 'overview' | 'stats' | 'matches' | 'career' | 'news';

const PRESETS: Preset[] = [
  { id: 'overview', label: 'Overview', columns: ['program', 'jersey', 'position', 'class_raw', 'gp', 'gs', 'minutes', 'goals', 'assists', 'points', 'ppg', 'pps', 'shots', 'sog'] },
  { id: 'rates', label: 'Per 90 & ranks', columns: ['program', 'minutes', 'goals_p90', 'assists_p90', 'conversion_pct', 'shots_per_goal', 'minutes_per_goal', 'minutes_share', 'div_rank_points', 'conf_rank_points', 'pct_points_p90', 'pct_goals_p90'] },
  { id: 'gk', label: 'Goalkeeping', columns: ['program', 'gp', 'gs', 'ga', 'gaa', 'saves', 'save_pct', 'shutouts', 'clean_sheets', 'pct_save_pct'] },
  { id: 'discipline', label: 'Discipline & extras', columns: ['program', 'gp', 'fouls', 'yc', 'rc', 'gwg', 'halves'] },
];
const SPLIT_LABEL: Record<string, string> = { home: 'Home', away: 'Away', neutral: 'Neutral', conf: 'Conference', nonconf: 'Non-conference', vs_ranked: 'Against ranked teams' };

export default function Player() {
  const { id: param = '' } = useParams();
  const entity = useEntityId('player', param);
  const id = entity.id;
  const admin = useAdmin();
  const href = useHref();
  const [preset, setPreset] = useUrlState('cols', 'overview', { replace: true, resetPage: false, allow: PRESETS.map((p) => p.id) });
  const [tab] = useUrlState('tab', 'overview', { allow: ['overview', 'stats', 'matches', 'career', 'news'] });
  const { pathname } = useLocation();
  const q = useQuery({ queryKey: ['player', id], queryFn: () => api<any>(`/api/players/${id}`), enabled: !!id });
  // Plaibook Stats Pro: a confident link to this player's professional career.
  const pro = useQuery({ queryKey: ['pro-from-college', id], queryFn: () => api<{ pro: { name: string; slug: string } | null }>(`/api/pro/from-college/${id}`), enabled: !!id, staleTime: 300_000 });
  if (entity.missing) return <EmptyState title="No such player" body="The link may be out of date." action={<Link className="btn-ghost btn-sm" to="/players">Browse players</Link>} />;
  if (entity.error) return <ErrorBox error={entity.error} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-40" /><Skeleton className="h-48" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const p = q.data?.player;
  if (!p) return <EmptyState title="No such player" body="The link may be out of date." action={<Link className="btn-ghost btn-sm" to="/players">Browse players</Link>} />;
  const seasons: any[] = q.data.seasons ?? [], honors: any[] = q.data.honors ?? [], career = q.data.career, transfers: any[] = q.data.transfers ?? [], gameLog: any[] = q.data.gameLog ?? [];
  const latest = seasons[0];
  const st = latest?.stats;
  const isGk = seasons.some((s) => s.stats?.gk_minutes > 0 || s.position === 'GK');
  const n = (v: unknown, d = 0) => fmt.num(v, d);
  const sc = (key: string, label: string, title: string, opts: { d?: number; pct?: boolean } = {}): Column<any> => ({ key, label, title, num: true, priority: 3, value: (s) => s.stats?.[key], render: (s) => ((key === 'ppg' && (s.stats?.res_apps ?? 0) < 5) || (key === 'pps' && (s.stats?.pps_starts ?? 0) < 5) ? '–' : key.startsWith('pct_') ? fmt.pctile(s.stats?.[key]) : opts.pct ? fmt.pct(s.stats?.[key]) : n(s.stats?.[key], opts.d ?? 0)) });
  const seasonCols: Column<any>[] = [
    { key: 'season', label: 'Season', primary: true, render: (s) => String(s.season) },
    { key: 'program', label: 'Team', priority: 3, value: (s) => s.program?.name, render: (s) => <Link className="flex items-center gap-2 hover:text-pitch-300" to={href(`/teams/${s.program?.id}`, { season: s.season, gender: s.program?.gender })}><TeamLogo src={s.program?.college_schools?.logo_svg_url} name={s.program?.name} size={20} />{s.program?.name}</Link> },
    { key: 'jersey', label: '#', title: 'Jersey', num: true, priority: 3 }, { key: 'position', label: 'Pos', title: 'Position', priority: 3 }, { key: 'class_raw', label: 'Class', priority: 3 },
    sc('gp', 'GP', 'Games played'), sc('gs', 'GS', 'Games started'), sc('ppg', 'PPG', 'Points per game: his team\'s result in each game he played, 3 for a win, 1 for a tie', { d: 2 }), sc('pps', 'PPS', 'Points per start: the same over starts of 45+ minutes', { d: 2 }), sc('minutes', 'Min', 'Minutes'), sc('goals', 'G', 'Goals'), sc('assists', 'A', 'Assists'), sc('points', 'Pts', 'Points'), sc('shots', 'Sh', 'Shots'), sc('sog', 'SOG', 'Shots on goal'),
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
    { key: 'minutes', label: 'Min', num: true }, { key: 'rating', label: 'Rating', title: 'Plaibook match rating (0 to 10, from the box score)', num: true, render: (r) => <RatingBadge v={r.rating} /> }, { key: 'goals', label: 'G', num: true }, { key: 'assists', label: 'A', num: true }, { key: 'shots', label: 'Sh', num: true, priority: 2 }, { key: 'shots_on_goal', label: 'SOG', num: true, priority: 2 },
    { key: 'fouls', label: 'Fouls', num: true, priority: 2 }, { key: 'yellow_cards', label: 'YC', num: true, priority: 2 }, { key: 'red_cards', label: 'RC', num: true, priority: 2 },
    ...(isGk ? [{ key: 'goals_allowed', label: 'GA', num: true, render: (r: any) => r.is_goalie ? n(r.goals_allowed) : '' }, { key: 'saves', label: 'Saves', num: true, render: (r: any) => r.is_goalie ? n(r.saves) : '' }] as Column<any>[] : []),
  ];
  const bioLine = latest ? [latest.class_raw ? `${latest.class_raw}${latest.is_redshirt ? ' (redshirt)' : ''}` : null, latest.height_cm ? `${Math.floor(latest.height_cm / 30.48)}′${Math.round(latest.height_cm / 2.54 % 12)}″` : null, latest.weight_lb ? `${latest.weight_lb} lb` : null].filter(Boolean).join(', ') : '';
  const bioUrl = latest?.bio_url ?? p.bio_url;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'stats', label: 'Stats', count: seasons.length || undefined }, { id: 'matches', label: 'Matches', count: gameLog.length || undefined },
    { id: 'career', label: 'Career' }, { id: 'news', label: 'News' },
  ];
  // Charts: goals and assists by season (two or more), and the latest season's last 12 games.
  const bySeason = [...seasons].filter((s) => s.stats).sort((a, b) => a.season - b.season).map((s) => ({ label: String(s.season), a: s.stats.goals ?? 0, b: s.stats.assists ?? 0 }));
  const form: FormGame[] = gameLog.filter((r) => r.game?.status === 'final' && r.game.season === latest?.season && r.participated !== false)
    .sort((a, b) => String(a.game.game_date).localeCompare(String(b.game.game_date))).slice(-12)
    .map((r) => { const g = r.game, home = g.home_program_id === own(r); const us = home ? g.home_score : g.away_score, them = home ? g.away_score : g.home_score;
      return { href: href(`/matches/${g.id}`), date: fmt.day(g.game_date), opponent: `${home ? 'vs' : 'at'} ${(home ? g.away_name : g.home_name) ?? '?'}`, result: resultOf(us, them) as FormGame['result'], minutes: r.minutes ?? null, goals: r.goals ?? 0, assists: r.assists ?? 0, started: !!r.starter }; });
  // Match ratings, the latest season's last 15 rated games (oldest first).
  const ratings = gameLog.filter((r) => r.rating != null && r.game?.season === latest?.season).sort((a, b) => String(a.game.game_date).localeCompare(String(b.game.game_date))).slice(-15)
    .map((r) => { const g = r.game, home = g.home_program_id === own(r); return { label: fmt.day(g.game_date), value: Number(r.rating), href: href(`/matches/${g.id}`), title: `${fmt.day(g.game_date)} ${home ? 'vs' : 'at'} ${(home ? g.away_name : g.home_name) ?? '?'}: ${Number(r.rating).toFixed(1)}` }; });
  const hasCharts = bySeason.length > 1 || form.length >= 3 || ratings.length >= 5;
  const hasOverview = hasCharts || (career && seasons.length > 1) || latest?.splits?.length > 0 || latest?.ranks?.length > 0 || honors.length > 0;
  return (
    <div className="space-y-5">
      <Crumbs items={[{ label: p.display_name }]} />
      <header className="card flex flex-col gap-5 p-4 sm:p-6 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="flex min-w-0 items-start gap-4">
        <span className="shrink-0 [&>*]:!h-16 [&>*]:!w-16 sm:[&>*]:!h-[88px] sm:[&>*]:!w-[88px]"><PlayerAvatar src={latest?.headshot_url ?? p.headshot_url} name={p.display_name} size={88} crest={latest?.program?.college_schools?.logo_svg_url} crestSeo={latest?.program?.school_seo} /></span>
        <div className="min-w-0">
          <h1 className="display text-3xl leading-none sm:text-4xl">{p.display_name}{p.suppress && <Badge tone="red" className="ml-2 align-middle">suppressed</Badge>}</h1>
          {latest?.program && <p className="mt-2 text-sm text-chalk-300"><Link className="font-medium text-chalk-100 hover:text-pitch-300" to={href(`/teams/${latest.program.id}`, { season: latest.season, gender: latest.program.gender })}>{latest.program.name}</Link> {genderLabel(latest.program.gender)} soccer{positionWord(latest.position ?? latest.position_raw) ? `, ${positionWord(latest.position ?? latest.position_raw)!.toLowerCase()}` : ''}{latest.jersey != null ? `, No. ${latest.jersey}` : ''}{bioLine ? `, ${bioLine}` : ''}</p>}
          <p className="mt-1 text-sm text-chalk-400">{[latest?.hometown_raw ? `From ${latest.hometown_raw}` : null, (latest?.high_school ?? p.high_school) ? `${latest?.high_school ?? p.high_school}` : null, latest?.previous_school ? `previously ${latest.previous_school}` : null, latest?.major ? `studying ${latest.major}` : null].filter(Boolean).join('; ') || 'No bio collected yet.'}</p>
          <p className="mt-1 flex flex-wrap gap-x-4 text-xs">{bioUrl && <a className="inline-flex items-center gap-1 text-pitch-400 hover:text-pitch-300" href={bioUrl} target="_blank" rel="noreferrer">School bio <ExternalLink size={12} aria-hidden /></a>}<Link className="text-pitch-400 hover:text-pitch-300" to={`/compare?a=${p.id}`}>Compare with another player</Link></p>
          <PageActions className="mt-3" title={p.display_name}
            follow={{ kind: 'player', id: p.id, name: p.display_name, href: `/players/${p.slug ?? p.id}`, image: latest?.headshot_url ?? p.headshot_url ?? null, sub: latest?.program?.name ?? null }} />
          {pro.data?.pro && <p className="mt-2"><Link to={`/pro/players/${pro.data.pro.slug}`} className="inline-flex items-center gap-1.5 rounded-md bg-pitch-400/15 px-2 py-1 text-xs font-medium text-pitch-300 hover:bg-pitch-400/25"><Trophy size={13} aria-hidden /> Now playing professionally: pro career and stats</Link></p>}
        </div>
        </div>
        {st && (() => {
          const avg = (pts: number | null | undefined, k: number | null | undefined) => (pts != null && k && k >= 5 ? (pts / k).toFixed(2) : '–');
          return (
            <dl className="grid min-w-0 grid-cols-3 gap-x-5 gap-y-3 sm:grid-cols-6 lg:max-w-[44rem] lg:flex-1">
              {isGk ? <>
                <HeroStat label={`${latest.season} save %`} value={fmt.pct(st.save_pct)} sub={`${st.saves ?? 0} saves`} accent />
                <HeroStat label="Goals against avg" value={n(st.gaa, 2)} sub={`${st.ga ?? 0} conceded`} />
                <HeroStat label="Shutouts" value={st.shutouts ?? 0} />
                <HeroStat label="Games" value={st.gp ?? 0} sub={`${st.gs ?? 0} starts`} />
              </> : <>
                <HeroStat label={`${latest.season} goals`} value={st.goals ?? 0} sub={st.pct_goals_p90 != null ? `${fmt.pctile(st.pct_goals_p90)} pctl per 90` : undefined} accent />
                <HeroStat label="Assists" value={st.assists ?? 0} sub={`${st.points ?? 0} points`} />
                <HeroStat label="Games" value={st.gp ?? 0} sub={`${st.gs ?? 0} starts`} />
                <HeroStat label="Minutes" value={n(st.minutes)} sub={st.goals_p90 != null ? `${n(st.goals_p90, 2)} goals per 90` : undefined} />
              </>}
              <HeroStat label="Points a game" value={avg(st.res_pts, st.res_apps)} sub={`${st.res_apps ?? 0} games`} />
              <HeroStat label="Points a start" value={avg(st.pps_pts, st.pps_starts)} sub={`${st.pps_starts ?? 0} starts of 45+`} />
            </dl>
          );
        })()}
      </header>
      <TabsNav label="Player sections" tabs={tabs} value={tab as Tab} hrefFor={(x) => href(pathname, { tab: x === 'overview' ? null : x })} />
      <PageWithRail label={`${p.display_name} at a glance`} rail={<PlayerRail id={p.id} latest={latest} gameLog={gameLog} keeper={isGk} own={own} href={href} news={tab !== 'news'} />}>
      {tab === 'overview' && <div className="space-y-6">
      {hasCharts && (
        <div className={`grid grid-cols-1 items-start gap-3 ${bySeason.length > 1 ? 'xl:grid-cols-2' : ''}`}>
          <GameForm games={form} caption={`Last ${form.length} games, ${latest?.season}`} />
          <FormLine points={ratings} caption={`Match ratings, ${latest?.season}`} />
          {bySeason.length > 1 && <SeasonBars rows={bySeason} a="Goals" b="Assists" caption="Goals and assists by season" />}
        </div>
      )}
      {career && seasons.length > 1 && (
        <div className="grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-6">
          <Figure label="Seasons" value={career.seasons} sub={`${career.programs} program${career.programs === 1 ? '' : 's'}`} />
          <Figure label="Games" value={career.gp ?? 0} sub={`${career.gs ?? 0} starts`} />
          <Figure label="Minutes" value={n(career.minutes)} />
          <Figure label="Goals" value={career.goals ?? 0} /><Figure label="Assists" value={career.assists ?? 0} /><Figure label="Shots" value={career.shots ?? 0} sub={`${career.sog ?? 0} on goal`} />
        </div>
      )}
      </div>}
      {tab === 'stats' && <Section title="Seasons">
        <DataTable rows={seasons} columns={seasonCols} rowKey={(s) => s.id} caption="Season by season" presets={PRESETS} preset={preset} onPreset={setPreset} dense empty={<EmptyState title="No seasons recorded" />} />
      </Section>}
      {tab === 'overview' && <div className="space-y-6">
      {latest?.splits?.length > 0 && (
        <Section title={`Splits, ${latest.season}`}>
          <div className="frame overflow-x-auto"><table className="w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Season splits</caption>
            <thead><tr><th scope="col" className="th">Split</th><th scope="col" className="th text-right">GP</th><th scope="col" className="th text-right">GS</th><th scope="col" className="th text-right">Min</th><th scope="col" className="th text-right">G</th><th scope="col" className="th text-right">A</th><th scope="col" className="th text-right">Pts</th><th scope="col" className="th hidden text-right sm:table-cell">Sh</th><th scope="col" className="th hidden text-right sm:table-cell">SOG</th>{isGk && <><th scope="col" className="th text-right">Saves</th><th scope="col" className="th text-right">GA</th></>}</tr></thead>
            <tbody>{['home', 'away', 'neutral', 'conf', 'nonconf', 'vs_ranked'].map((k) => latest.splits.find((x: any) => x.split === k)).filter(Boolean).map((x: any) => <tr key={x.split}><th scope="row" className="td text-left font-normal text-chalk-300">{SPLIT_LABEL[x.split] ?? x.split}</th><td className="td num">{x.gp}</td><td className="td num">{x.gs}</td><td className="td num">{n(x.minutes)}</td><td className="td num">{n(x.goals)}</td><td className="td num">{n(x.assists)}</td><td className="td num">{n(x.points)}</td><td className="td num hidden sm:table-cell">{n(x.shots)}</td><td className="td num hidden sm:table-cell">{n(x.sog)}</td>{isGk && <><td className="td num">{n(x.saves)}</td><td className="td num">{n(x.ga)}</td></>}</tr>)}</tbody>
          </table></div>
        </Section>
      )}
      {honors.length > 0 && <Section title="Honors"><ul className="frame divide-y divide-field-700 text-sm">{honors.map((h: any) => <li key={h.id} className="flex items-center gap-2 px-3 py-2"><span>{h.text}</span>{h.source_url && <a className="ml-auto inline-flex items-center gap-1 text-xs text-pitch-400 hover:text-pitch-300" href={h.source_url} target="_blank" rel="noreferrer">source <ExternalLink size={11} aria-hidden /></a>}</li>)}</ul></Section>}
      {!hasOverview && <EmptyState title="Nothing more to show yet" body="Splits, national ranks and honors appear as the season's box scores and bios are collected." />}
      </div>}
      {tab === 'career' && <div className="space-y-6">
        {pro.data?.pro && <Section title="Pro career"><Link to={`/pro/players/${pro.data.pro.slug}`} className="frame flex items-center gap-3 px-3 py-3 text-sm hover:bg-field-800"><Trophy size={18} aria-hidden className="text-pitch-300" /><span className="font-medium text-chalk-100">{pro.data.pro.name} plays professionally</span><span className="ml-auto text-xs text-pitch-300">Pro career and stats</span></Link></Section>}
        <Section title="Colleges">
          <ul className="frame divide-y divide-field-700 text-sm">{[...new Map(seasons.filter((s) => s.program).map((s) => [s.program.id, s])).values()].map((s: any) => { const yrs = seasons.filter((x) => x.program?.id === s.program.id).map((x) => x.season).sort(); return <li key={s.program.id}><Link to={href(`/teams/${s.program.id}`, { season: s.season, gender: s.program.gender })} className="flex items-center gap-2 px-3 py-2 hover:bg-field-800"><TeamLogo src={s.program.college_schools?.logo_svg_url} name={s.program.name} size={20} /><span className="font-medium text-chalk-100">{s.program.name}</span><span className="ml-auto text-xs text-chalk-400 tnum">{yrs[0] === yrs[yrs.length - 1] ? yrs[0] : `${yrs[0]}–${yrs[yrs.length - 1]}`}</span></Link></li>; })}</ul>
        </Section>
        {transfers.length > 0 && <Section title="Transfers"><ul className="frame divide-y divide-field-700 text-sm">{transfers.map((t: any) => {
          const school = (x: any, season: number) => x ? <Link to={href(`/teams/${x.id}`, { season, gender: x.gender })} className="inline-flex items-center gap-1.5 font-medium text-chalk-100 hover:text-pitch-300"><TeamLogo src={x.logo} seo={x.seo} name={x.name} size={18} />{x.name}</Link> : <span className="text-chalk-400">another school</span>;
          return <li key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">{school(t.from, t.from_season)}<span className="text-xs text-chalk-500">{t.from_season}</span><ArrowRight size={14} aria-hidden className="text-chalk-500" />{school(t.to, t.to_season)}<span className="text-xs text-chalk-500">{t.to_season}</span>{admin && <span className="text-xs text-chalk-500">(confidence {t.confidence}, {t.evidence?.rule})</span>}</li>;
        })}</ul></Section>}
      </div>}
      {tab === 'news' && id && <NewsFeed q={{ player: id }} hide={`college_player:${id}`} empty="No news for this player yet" />}
      {tab === 'matches' && <Section title="Game log">
        <DataTable rows={gameLog} columns={logCols} rowKey={(r) => `${r.game.id}-${r.source}`} caption="Game by game" rowHref={(r) => href(`/matches/${r.game.id}`)} dense defaultSort={{ key: 'date', dir: 'desc' }} empty={<EmptyState title="No box scores yet" body="Game-by-game lines appear once box scores are collected." />} />
      </Section>}
      </PageWithRail>
      {admin && <JsonViewer title="Identity row" value={p} />}
    </div>
  );
}
