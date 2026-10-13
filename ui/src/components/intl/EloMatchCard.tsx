// Plaibook Elo on an international match page. Before kickoff: each side's rating and the chances of each result
// (the expected score from the two ratings and the venue, split by how often such matches are drawn). Once played:
// each side's rating before and after, and why it moved. Data: /api/intl/matches/:slug/elo (src/pro/intl.ts matchElo).
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { TeamLogo } from '../primitives';
import { eloReason, type EloPoint } from './EloChart';
import { nationHref } from './NationHistory';
import type { NationRef } from '../../lib/intl';

interface Move { rating_after: number; delta: number; gf: number | null; ga: number | null; expected: number | null; k: number | null; goal_factor: number | null; venue: string | null; opp_rating: number | null }
interface Side { nation: NationRef | null; rating_before: number | null; rank: number | null; move: Move | null }
interface MatchElo { gender: 'm' | 'w'; neutral: boolean; played: boolean; home: Side; away: Side; prediction: { home_expected: number; home: number; draw: number; away: number } | null }

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function EloMatchCard({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['intl-match-elo', slug], queryFn: () => api<MatchElo>(`/api/intl/matches/${slug}/elo`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1, staleTime: 120_000 });
  const d = q.data;
  if (!d || !d.home.nation || !d.away.nation || !d.prediction) return null;
  const p = d.prediction;
  const name = (s: Side) => s.nation!.name;
  const asPoint = (s: Side, other: Side): EloPoint | null => (s.move ? { date: '', rating: s.move.rating_after, delta: s.move.delta, opponent: { key: other.nation!.key, name: name(other), slug: other.nation!.slug ?? other.nation!.key, logo: other.nation!.logo }, tournament: null,
    gf: s.move.gf, ga: s.move.ga, opp_rating: s.move.opp_rating, expected: s.move.expected, k: s.move.k, goal_factor: s.move.goal_factor, venue: s.move.venue, match_slug: null } : null);
  return (
    <section className="frame space-y-3 p-3" aria-label="Plaibook Elo">
      <h2 className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-chalk-100">
        Plaibook Elo {d.played ? 'before and after' : 'prediction'}
        <Link to="/intl/rankings" className="text-2xs font-normal text-pitch-300 hover:text-pitch-200">How it works</Link>
      </h2>
      <div>
        <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={`Chances before kickoff: ${name(d.home)} ${pct(p.home)}, draw ${pct(p.draw)}, ${name(d.away)} ${pct(p.away)}`}>
          <span className="bg-pitch-400" style={{ width: pct(p.home) }} />
          <span className="bg-field-600" style={{ width: pct(p.draw) }} />
          <span className="bg-note" style={{ width: pct(p.away) }} />
        </div>
        <div className="mt-1 grid grid-cols-3 text-xs tnum">
          <span className="text-chalk-200">{name(d.home)} <span className="font-semibold">{pct(p.home)}</span></span>
          <span className="text-center text-chalk-400">Draw {pct(p.draw)}</span>
          <span className="text-right text-chalk-200">{name(d.away)} <span className="font-semibold">{pct(p.away)}</span></span>
        </div>
        <p className="mt-1 text-2xs text-chalk-500">{d.played ? 'Before kickoff' : 'Chances'}, from the two ratings{d.neutral ? ' on neutral ground' : `, ${name(d.home)} at home (+100)`} and how often such matches end level.</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {([[d.home, d.away], [d.away, d.home]] as const).map(([s, o]) => {
          const pt = asPoint(s, o), r = pt ? eloReason(pt) : null;
          return (
            <li key={s.nation!.key} className="rounded-md border border-field-700 bg-field-950/40 p-2.5 text-xs">
              <Link to={nationHref(s.nation!)} className="flex items-center gap-2 font-medium text-chalk-100 hover:text-pitch-300"><TeamLogo src={s.nation!.logo} name={name(s)} size={18} />{name(s)}{s.rank ? <span className="text-2xs font-normal text-chalk-500">world #{s.rank} now</span> : null}</Link>
              {s.move ? (
                <>
                  <p className="mt-1 tnum text-chalk-300">{s.rating_before} → <span className="font-semibold text-chalk-100">{s.move.rating_after}</span> <span className={s.move.delta > 0 ? 'text-win' : s.move.delta < 0 ? 'text-loss' : ''}>({s.move.delta > 0 ? '+' : ''}{s.move.delta})</span></p>
                  {r && <p className="mt-0.5 text-chalk-400">{r.words}{r.formula ? <span className="ml-1 font-mono text-2xs text-chalk-500">{r.formula}</span> : null}</p>}
                </>
              ) : <p className="mt-1 tnum text-chalk-300">Rating {s.rating_before ?? '–'}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
