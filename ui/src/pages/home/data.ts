// The home page's data: today's college matches (and the next few days, for a quiet day), the pro front page
// (/api/pro/home: today's matches, the US scene, Americans abroad) and the international one (/api/intl/home). Each
// refreshes every 30 seconds while something is live, every two minutes otherwise.
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { todayEastern } from '../../lib/dates';
import type { MatchLike } from '../../components/match/MatchRow';
import type { ProDay, ProLeagueRef } from '../../lib/pro';
import type { AbroadLine } from '../../components/pro/Abroad';
import type { IntlHome } from '../../lib/intl';

export interface CollegeDay { games: (MatchLike & { kickoff_tbd?: boolean })[]; live: number }
export interface ProHome {
  date: string; matches: ProDay; next_us: ProDay | null; abroad: { lines: AbroadLine[]; at: string | null } | null;
  featured: (ProLeagueRef & { current_season: number | null })[]; counts: { leagues: number; teams: number; players: number; matches: number };
}

const every = (live: number) => (live > 0 ? 30_000 : 120_000);

export function useCollegeDays(gender: 'm' | 'w') {
  const date = todayEastern();
  return useQuery({
    queryKey: ['home-college', date, gender],
    queryFn: () => api<CollegeDay>(`/api/matches${qs({ date, days: 5, gender })}`),
    refetchInterval: (q) => every(q.state.data?.live ?? 0),
  });
}

export function useProHome() {
  const date = todayEastern();
  return useQuery({
    queryKey: ['pro-home', date],
    queryFn: () => api<ProHome>(`/api/pro/home${qs({ date })}`),
    refetchInterval: (q) => every(q.state.data?.matches.live ?? 0),
  });
}

export function useIntlHome() {
  const date = todayEastern();
  return useQuery({
    queryKey: ['intl-home', date],
    queryFn: () => api<IntlHome>(`/api/intl/home${qs({ date })}`),
    refetchInterval: (q) => every(q.state.data?.matches.live ?? 0),
  });
}
