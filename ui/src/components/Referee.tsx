// Referee numbers, pro and college (migration 187): the card on a match page and the pieces the referee pages share.
// Every figure is per match over the matches that have it (cards need the match's events or box score, fouls both
// sides' stats), and sits beside the average for the same competitions so "4.6 cards a match" means something.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Flag as FlagIcon } from 'lucide-react';
import { api, fmt } from '../lib/api';
import { RailCard } from './primitives';
import { StatTile } from './pro/Hero';

export interface RefNumbers {
  matches?: number; games?: number;
  yellow_pg: number | null; red_pg: number | null; cards_pg: number | null; pens_pg: number | null; var_pg?: number | null; fouls_pg: number | null;
  home_pct: number | null; draw_pct?: number | null; away_pct?: number | null; goals_pg: number | null;
  with_events?: number; with_cards?: number; with_fouls?: number;
}
export interface RefCardData { slug: string; name: string; country?: string | null; career: RefNumbers | null; season: RefNumbers | null; average: RefNumbers | null }

export const played = (n: RefNumbers | null | undefined) => (n ? n.matches ?? n.games ?? 0 : 0);

/** The per-match figures in the order they are shown; `var` is pro only. */
export const REF_STATS: { key: keyof RefNumbers; label: string; short: string; d: number; pct?: boolean }[] = [
  { key: 'cards_pg', label: 'Cards a match', short: 'Cards', d: 2 },
  { key: 'yellow_pg', label: 'Yellow cards a match', short: 'Yellow', d: 2 },
  { key: 'red_pg', label: 'Red cards a match', short: 'Red', d: 2 },
  { key: 'pens_pg', label: 'Penalties a match', short: 'Pens', d: 2 },
  { key: 'fouls_pg', label: 'Fouls a match', short: 'Fouls', d: 1 },
  { key: 'var_pg', label: 'VAR checks a match', short: 'VAR', d: 2 },
  { key: 'home_pct', label: 'Home wins', short: 'Home win', d: 0, pct: true },
  { key: 'goals_pg', label: 'Goals a match', short: 'Goals', d: 2 },
];

export const refValue = (v: number | null | undefined, s: { d: number; pct?: boolean }) => (v == null ? '–' : s.pct ? `${Math.round(Number(v) * 100)}%` : fmt.num(v, s.d));

/** How a figure compares with the average, in words (colour is never the only cue). Within 10% reads as average. */
export function versus(v: number | null | undefined, avg: number | null | undefined): { word: string; tone: string } | null {
  if (v == null || avg == null || avg === 0) return null;
  const r = Number(v) / Number(avg);
  if (r >= 1.1) return { word: 'above average', tone: 'text-note' };
  if (r <= 0.9) return { word: 'below average', tone: 'text-pitch-300' };
  return { word: 'about average', tone: 'text-chalk-400' };
}

/** The referee card beside a match: this season's numbers in this competition when there are three or more matches,
 *  else the career's, each against the competition's average this season. Hidden when we have nothing. */
export function RefereeCard({ d, to, avgLabel, seasonLabel, showVar }: { d: RefCardData | null | undefined; to: string; avgLabel: string; seasonLabel: string; showVar?: boolean }) {
  if (!d || !d.career || !played(d.career)) return null;
  const useSeason = played(d.season) >= 3;
  const me = useSeason ? d.season! : d.career;
  const stats = REF_STATS.filter((s) => ['cards_pg', 'pens_pg', 'fouls_pg', 'home_pct', ...(showVar ? ['var_pg'] : [])].includes(s.key as string) && me[s.key] != null);
  return (
    <RailCard title="Referee" to={to} toLabel="Profile">
      <Link to={to} className="flex items-center gap-2 font-medium text-chalk-100 hover:text-pitch-300">
        <FlagIcon size={14} aria-hidden className="shrink-0 text-chalk-400" />
        <span className="min-w-0 truncate">{d.name}</span>
        {d.country && <span className="shrink-0 text-xs font-normal text-chalk-400">{d.country}</span>}
      </Link>
      <p className="mt-1 text-xs text-chalk-400">
        {useSeason ? `${played(d.season)} matches ${seasonLabel}` : `${played(d.career)} ${played(d.career) === 1 ? 'match' : 'matches'} in our records`}
        {useSeason && played(d.career) > played(d.season) ? `, ${played(d.career)} in all` : ''}
      </p>
      {stats.length > 0 && (
        <dl className="mt-2 space-y-1.5">
          {stats.map((s) => {
            const avg = d.average?.[s.key] as number | null | undefined;
            const vs = versus(me[s.key] as number | null, avg);
            return (
              <div key={s.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                <dt className="truncate text-chalk-300">{s.label}</dt>
                <dd className="text-right font-semibold text-chalk-100 tnum">{refValue(me[s.key] as number | null, s)}</dd>
                {avg != null && <dd className="col-span-2 -mt-0.5 text-2xs text-chalk-500">{avgLabel} {refValue(avg, s)}{vs && <>, <span className={vs.tone}>{vs.word}</span></>}</dd>}
              </div>
            );
          })}
        </dl>
      )}
      {played(d.career) < 5 && <p className="mt-2 text-2xs text-chalk-500">Only {played(d.career)} {played(d.career) === 1 ? 'match' : 'matches'} in our records, so these numbers move a lot.</p>}
    </RailCard>
  );
}

/** The head of a referee's page: the four figures people ask about, each against the same competitions' average. */
export function RefereeTiles({ me, peer, showVar, college }: { me: RefNumbers; peer: Partial<RefNumbers> | null; showVar?: boolean; college?: boolean }) {
  const keys: (keyof RefNumbers)[] = ['cards_pg', 'pens_pg', 'fouls_pg', 'home_pct', ...(showVar ? ['var_pg' as const] : [])];
  return (
    <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${keys.length >= 5 ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
      <StatTile label={college ? 'Games' : 'Matches'} value={fmt.num(played(me))} accent />
      {keys.map((k) => {
        const s = REF_STATS.find((x) => x.key === k)!;
        const avg = peer?.[k] as number | null | undefined;
        const vs = versus(me[k] as number | null, avg);
        const label = college ? (k === 'pens_pg' ? 'Penalty kicks a game' : s.label.replace('a match', 'a game')) : s.label;
        return me[k] == null ? null : <StatTile key={k} label={label} value={refValue(me[k] as number, s)} sub={avg != null ? <>avg {refValue(avg, s)}{vs ? <span className={vs.tone}>, {vs.word}</span> : null}</> : undefined} />;
      })}
    </div>
  );
}

/** The pro match page's card: loads on its own so the page never waits for it; nothing when no referee is named. */
export function ProRefereeCard({ fixtureId, competition }: { fixtureId: number; competition: string }) {
  const q = useQuery({ queryKey: ['pro-ref-card', fixtureId], queryFn: () => api<{ referee: RefCardData | null }>(`/api/pro/fixtures/${fixtureId}/referee`), staleTime: 600_000 });
  const d = q.data?.referee;
  if (!d) return null;
  return <RefereeCard d={d} to={`/pro/referees/${d.slug}`} avgLabel={`${competition} average`} seasonLabel={`in ${competition} this season`} showVar={(d.career?.var_pg ?? 0) > 0} />;
}

/** The college match page's card, once the box score names a referee. */
export function CollegeRefereeCard({ gameId, division, gender }: { gameId: string; division: string | null; gender: 'm' | 'w' }) {
  const q = useQuery({ queryKey: ['college-ref-card', gameId], queryFn: () => api<{ referee: RefCardData | null }>(`/api/games/${gameId}/referee`), staleTime: 600_000 });
  const d = q.data?.referee;
  if (!d) return null;
  const group = `${division ? division.toUpperCase() : ''} ${gender === 'w' ? "women's" : "men's"}`.trim();
  return <RefereeCard d={d} to={`/referees/${d.slug}`} avgLabel={`${group} average`} seasonLabel={`in ${group} this season`} />;
}
