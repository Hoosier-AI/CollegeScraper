// Which job puts each quality check right, so the console's Fix button enqueues the right thing.
export interface QualityFix { job: string; params: Record<string, unknown>; label: string }

export function fixFor(checkId: string, season: number): QualityFix | null {
  switch (checkId) {
    case 'no_truth': case 'team_rows': case 'score_mismatch': case 'disagree': return { job: 'reconcile-games', params: { season, all: true }, label: 'Reconcile every final' };
    case 'player_goals': case 'minutes': return { job: 'fetch-games-ncaa', params: { season, recent_days: 7, refetch: true }, label: 'Re-fetch NCAA box scores (7 days)' };
    case 'standings_vs_computed': case 'record_vs_ncaa': case 'official_lag': case 'ncaa_duplicate': case 'computed_standings': return { job: 'standings', params: { season }, label: 'Re-run standings + verification' };
    case 'usc_unresolved': case 'usc_vs_ncaa': return { job: 'refresh-rankings', params: { season, categories: false }, label: 'Re-read the polls' };
    case 'unresolved': case 'unlinked_players': case 'standings_unresolved': case 'non_member_programs': case 'members_unlisted': return { job: 'resolve-orphans', params: { season }, label: 'Resolve orphans' };
    case 'agg_vs_site': return { job: 'compute-aggregates', params: { season, transfers: false }, label: 'Recompute aggregates' };
    case 'no_roster': return { job: 'sync-site', params: { season, only_never_synced: true, stages: ['roster'] }, label: 'Sync missing rosters' };
    default: return null;
  }
}
