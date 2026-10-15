// A club's Plaibook Elo (rating, world and country rank, last 30 days) and the seasons it finished top of a league
// table, beside the squad. Hidden when the club has neither (national teams and clubs with few results).
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { api } from '../../lib/api';
import { proPath, type ProLeagueRef } from '../../lib/pro';
import { RailCard } from '../primitives';

interface Extras { elo: { rating: number; rank: number | null; country: string | null; country_rank: number | null; change_30d: number | null; games: number; as_of: string } | null; tops: { league: ProLeagueRef & { slug: string; scope?: 'club' | 'intl' }; season: number; group: string | null; points: number | null }[] }

export function ClubExtras({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['pro-team-extras', slug], queryFn: () => api<Extras>(`/api/pro/teams/${slug}/extras`), staleTime: 600_000 });
  const d = q.data;
  if (!d || (!d.elo && !d.tops.length)) return null;
  const e = d.elo;
  return (
    <>
      {e && (
        <RailCard title="Plaibook Elo" to="/pro/rankings?scope=world" toLabel="Rankings">
          <div className="flex items-baseline gap-3">
            <span className="display text-3xl text-chalk-100 tnum">{e.rating}</span>
            {e.change_30d != null && e.change_30d !== 0 && <span className={`text-sm tnum ${e.change_30d > 0 ? 'text-win' : 'text-loss'}`}>{e.change_30d > 0 ? '+' : ''}{e.change_30d} in 30 days</span>}
          </div>
          <p className="mt-1 text-xs text-chalk-400">{[e.rank ? `No. ${e.rank} in the world` : null, e.country && e.country_rank ? `No. ${e.country_rank} in ${e.country}` : null].filter(Boolean).join(', ')}. Our own rating from every result since 2023.</p>
        </RailCard>
      )}
      {d.tops.length > 0 && (
        <RailCard title="Top of the table">
          <ul className="space-y-1">
            {d.tops.slice(0, 10).map((x, i) => (
              <li key={i} className="flex items-center gap-2">
                <Trophy size={14} aria-hidden className="shrink-0 text-note" />
                <Link to={proPath.league(x.league.slug, x.season, null, x.league.scope ?? 'club')} className="min-w-0 flex-1 truncate text-chalk-200 hover:text-pitch-300">{x.league.name}{x.group ? `, ${x.group}` : ''}</Link>
                <span className="text-xs text-chalk-400 tnum">{x.season}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-2xs text-chalk-500">Seasons the club finished first in a league table we hold. Where a title is decided in playoffs, the champion can differ.</p>
        </RailCard>
      )}
    </>
  );
}
