// News on the site (src/news on the server): stories linked to our teams, players, leagues and conferences. We show the
// headline (linking out to the publisher), the picture the publisher's feed supplies (loaded from the publisher), the
// outlet, the time and our own tags; never the publisher's text.
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, qs } from './api';

export type NewsKind = 'injury' | 'transfer' | 'loan' | 'contract' | 'commitment' | 'coaching' | 'callup' | 'award' | 'ranking' | 'milestone' | 'report' | 'preview' | 'suspension';
export interface NewsLink { type: 'program' | 'college_player' | 'conference' | 'pro_team' | 'pro_player' | 'pro_league'; id: string; label: string; href: string | null; primary: boolean }
export interface Story {
  id: number; url: string; title: string; publisher: string; published_at: string; kinds: NewsKind[]; scope: string[];
  gender: 'm' | 'w' | null; importance: number; outlets: number; also: { publisher: string; url: string }[]; links: NewsLink[];
  /** The picture the publisher's feed gives the story, loaded from the publisher; null when it gives none. */
  image_url?: string | null;
}
export interface NewsPage { stories: Story[]; top?: Story[]; kinds: Record<NewsKind, string>; next_before: string | null }

/** What a list of stories is about: one area, or one or more teams, players, leagues or conferences. */
export interface NewsQuery {
  scope?: 'college' | 'pro' | 'international';
  program?: string; player?: string; conference?: string;
  team?: string; pro_player?: string; league?: string; country?: string; american?: boolean;
  kind?: NewsKind[]; gender?: 'm' | 'w' | null; limit?: number; top?: boolean;
}

export function newsUrl(q: NewsQuery, before?: string | null): string {
  return `/api/news${qs({
    scope: q.scope, program: q.program, player: q.player, conference: q.conference, team: q.team, pro_player: q.pro_player, league: q.league,
    country: q.country, american: q.american ? '1' : undefined, kind: q.kind?.length ? q.kind.join(',') : undefined, gender: q.gender ?? undefined,
    limit: q.limit, top: q.top && !before ? '1' : undefined, before: before ?? undefined,
  })}`;
}

export function useNews(q: NewsQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['news', q],
    queryFn: ({ pageParam }) => api<NewsPage>(newsUrl(q, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before,
    enabled,
    staleTime: 60_000,
  });
}

export const KIND_LABEL: Record<NewsKind, string> = {
  injury: 'Injury', suspension: 'Suspension', transfer: 'Transfer', loan: 'Loan', contract: 'Contract', commitment: 'Commitment',
  coaching: 'Coaching', callup: 'Call-up', award: 'Award', ranking: 'Ranking', milestone: 'Milestone', report: 'Match report', preview: 'Preview',
};

/** The filters people use most, per area (college stories have commitments, pro ones have transfers). */
export const COLLEGE_FILTERS: { id: string; label: string; kinds: NewsKind[] }[] = [
  { id: 'all', label: 'All', kinds: [] },
  { id: 'team-news', label: 'Team news', kinds: ['injury', 'suspension', 'callup'] },
  { id: 'commitments', label: 'Commitments', kinds: ['commitment'] },
  { id: 'coaching', label: 'Coaching', kinds: ['coaching'] },
  { id: 'awards', label: 'Awards', kinds: ['award', 'milestone'] },
  { id: 'results', label: 'Results', kinds: ['report'] },
  { id: 'previews', label: 'Previews', kinds: ['preview'] },
];
export const PRO_FILTERS: { id: string; label: string; kinds: NewsKind[] }[] = [
  { id: 'all', label: 'All', kinds: [] },
  { id: 'team-news', label: 'Injuries and bans', kinds: ['injury', 'suspension'] },
  { id: 'transfers', label: 'Transfers', kinds: ['transfer', 'loan', 'contract'] },
  { id: 'coaching', label: 'Coaching', kinds: ['coaching'] },
  { id: 'callups', label: 'Call-ups', kinds: ['callup'] },
  { id: 'awards', label: 'Awards', kinds: ['award', 'milestone'] },
  { id: 'results', label: 'Results', kinds: ['report'] },
];
/** Before a match: what can change the line-ups, first. */
export const TEAM_NEWS_KINDS: NewsKind[] = ['injury', 'suspension', 'callup', 'coaching', 'transfer', 'loan'];
