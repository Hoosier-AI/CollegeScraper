// College Team of the Week (/team-of-the-week): a week's best-rated XI (Monday to Sunday, Eastern) in a 4-3-3 for a
// gender and division, or one conference, from the Plaibook box-score ratings: the pitch, the player of the week and
// the list with each player's game. The last finished week by default; the week in play is there as "so far".
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { api, fmt, qs } from '../lib/api';
import { genderLabel, useFilters, useHref } from '../lib/filters';
import { useUrlState } from '../lib/urlState';
import { EmptyState, ErrorBox, Field, PageHeader, PlayerAvatar, SegmentedControl, Select, Skeleton, TeamLogo } from '../components/primitives';
import { XIPitch, type ProLine } from '../components/pro/MatchParts';
import { RatingBadge } from '../components/Rating';

interface Prog { id: string; name: string; short_name: string | null; seo: string | null; gender: 'm' | 'w'; logo: string | null }
interface Line { game_id: string; player_id: string | null; name: string; slug: string | null; photo: string | null; class_year: string | null; pos: 'G' | 'D' | 'M' | 'F'; rating: number; minutes: number; goals: number; assists: number; saves: number | null; best: boolean; grid: string; game_date: string; is_home: boolean; team: Prog | null; opponent: Prog | null }
interface Data { week: string | null; current: string; weeks: { week: string; games: number }[]; xi: Line[]; season: number; division: string | null }

const DIV_OPTIONS = [{ value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }, { value: 'all', label: 'All' }];
const POS: Record<string, string> = { G: 'Goalkeeper', D: 'Defender', M: 'Midfielder', F: 'Forward' };
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
export const weekLabel = (wk: string) => `${fmt.day(wk)} – ${fmt.day(addDays(wk, 6))}`;

export default function TeamOfWeek() {
  const f = useFilters();
  const href = useHref();
  const [division, setDivision] = useUrlState('division', 'd1', { allow: ['d1', 'd2', 'd3', 'all'] });
  const [week, setWeek] = useUrlState('week');
  const [conference, setConference] = useUrlState('conference');
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ conferences: { id: string; name: string; division: string | null }[] }>('/api/meta') });
  const q = useQuery({
    queryKey: ['college-totw', f.season, f.gender, division, week, conference],
    queryFn: () => api<Data>(`/api/team-of-the-week${qs({ season: f.season, gender: f.gender, division, week, conference })}`),
    placeholderData: keepPreviousData,
  });
  const confOptions = useMemo(() => [{ value: '', label: 'Every conference' }, ...(meta.data?.conferences ?? []).filter((c) => division === 'all' || c.division === division).map((c) => ({ value: c.id, label: c.name }))], [meta.data, division]);
  const d = q.data;
  const confName = meta.data?.conferences.find((c) => c.id === conference)?.name;
  const scope = [confName ?? (division === 'all' ? 'every division' : division.toUpperCase()), genderLabel(f.gender)].join(' ');
  const lines: ProLine[] = (d?.xi ?? []).map((x, i) => ({ slot: i, player_id: null, name: x.name, display: x.name, slug: null, photo: x.photo, number: null, pos: x.pos, grid: x.grid, starter: true, captain: false, minutes: x.minutes, rating: x.rating, goals: x.goals, assists: x.assists, yellow: null, red: null, saves: x.saves, conceded: null, shots: null, shots_on: null, passes: null, key_passes: null, tackles: null }));
  const crests = new Map((d?.xi ?? []).map((x, i) => [i, x.team?.logo ?? null]));
  const best = d?.xi.find((x) => x.best);
  const playerHref = (x: Line) => (x.player_id ? href(`/players/${x.player_id}`) : null);
  const inPlay = d?.week && d.week === d.current;
  return (
    <div className="space-y-4">
      <PageHeader title="Team of the week" meta={d?.week ? `The best-rated XI of ${weekLabel(d.week)}${inPlay ? ' (so far)' : ''}, ${scope}, in a 4-3-3.` : `The best-rated XI of each week, ${scope}.`}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={(v) => { setDivision(v); setConference(''); setWeek(''); }} options={DIV_OPTIONS} />}</Field>
        <Field label="Conference">{(id) => <Select id={id} value={conference} onChange={(v) => { setConference(v); setWeek(''); }} options={confOptions} className="max-w-[220px]" />}</Field>
        {d && d.weeks.length > 0 && <Field label="Week">{(id) => <Select id={id} value={d.week ?? ''} onChange={setWeek} className="max-w-[200px]" options={d.weeks.map((w) => ({ value: w.week, label: `${weekLabel(w.week)}${w.week === d.current ? ' (so far)' : ''}` }))} />}</Field>}
      </PageHeader>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {d && !d.xi.length && <EmptyState title="No team of the week yet" body="It needs three or more games with box scores in the week. Pick another week, division or conference." />}
      {d && d.xi.length > 0 && (
        <div className={`grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] ${q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}`}>
          <XIPitch lines={lines} crests={crests} linkOf={(l) => playerHref(d.xi[l.slot]!)} label={`Team of the week, ${weekLabel(d.week!)}: ${d.xi.map((x) => `${x.name} (${x.rating.toFixed(1)})`).join(', ')}`} />
          <div className="space-y-3">
            {best && (
              <div className="flex items-center gap-3 rounded-lg bg-pitch-400/10 p-3 ring-1 ring-inset ring-pitch-400/30">
                <PlayerAvatar src={best.photo} name={best.name} size={52} crest={best.team?.logo} crestSeo={best.team?.seo} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-2xs font-medium text-pitch-300"><Star size={12} aria-hidden />Player of the week</p>
                  <p className="truncate font-semibold text-chalk-100">{playerHref(best) ? <Link to={playerHref(best)!} className="hover:text-pitch-300">{best.name}</Link> : best.name}</p>
                  <p className="truncate text-xs text-chalk-400">{[best.team?.name, best.goals ? `${best.goals} goal${best.goals > 1 ? 's' : ''}` : null, best.assists ? `${best.assists} assist${best.assists > 1 ? 's' : ''}` : null, best.pos === 'G' && best.saves ? `${best.saves} saves` : null].filter(Boolean).join(', ')}</p>
                </div>
                <RatingBadge v={best.rating} size="lg" />
              </div>
            )}
            <ul className="frame divide-y divide-field-700 text-sm">
              {d.xi.map((x) => (
                <li key={`${x.player_id ?? x.name}-${x.game_id}`} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="w-5 shrink-0 text-2xs font-semibold text-chalk-500" title={POS[x.pos]}>{x.pos}</span>
                  {x.team && <TeamLogo src={x.team.logo} seo={x.team.seo} name={x.team.name} size={18} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{playerHref(x) ? <Link to={playerHref(x)!} className="font-medium text-chalk-100 hover:text-pitch-300">{x.name}</Link> : <span className="font-medium text-chalk-100">{x.name}</span>}
                      <span className="text-xs text-chalk-500"> {[x.goals ? `${x.goals}G` : null, x.assists ? `${x.assists}A` : null, x.pos === 'G' && x.saves ? `${x.saves} saves` : null].filter(Boolean).join(' ')}</span></span>
                    <span className="block truncate text-2xs text-chalk-500">{x.team?.short_name ?? x.team?.name}{x.opponent ? `, ${x.is_home ? 'vs' : 'at'} ${x.opponent.short_name ?? x.opponent.name}` : ''}</span>
                  </span>
                  <Link to={href(`/matches/${x.game_id}`)} className="shrink-0 text-xs text-chalk-400 hover:text-pitch-300">{fmt.day(x.game_date)}</Link>
                  <RatingBadge v={x.rating} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-chalk-500">Plaibook ratings from each game's box score (goals, assists, shots on goal, saves, clean sheets, cards and the result), 45 minutes or more; each player's best game of the week. Positions as the box score or roster lists them.</p>
          </div>
        </div>
      )}
    </div>
  );
}
