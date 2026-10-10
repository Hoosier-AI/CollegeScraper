-- How much of the pro football world the crawl has (the hub's Crawling page, "Whole world"): leagues whose season in
-- play has matches, clubs with a squad, players in a squad or with season stats, finished matches with detail, and
-- the database's size. Read through a 5-minute cache in the service. Rollback: drop the function.
CREATE OR REPLACE FUNCTION public.pro_world_coverage() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '60s' AS $$
  SELECT jsonb_build_object(
    'leagues_enabled', (SELECT count(*) FROM pro_leagues WHERE enabled),
    'leagues_current_with_fixtures', (SELECT count(*) FROM pro_leagues l JOIN pro_seasons s ON s.league_id = l.id AND s.season = l.current_season WHERE l.enabled AND s.fixtures_synced_at IS NOT NULL),
    'clubs_total', (SELECT count(*) FROM pro_teams WHERE id > 0 AND NOT national),
    'clubs_in_current_seasons', (SELECT count(DISTINCT lt.team_id) FROM pro_league_teams lt JOIN pro_leagues l ON l.id = lt.league_id AND lt.season = l.current_season WHERE l.enabled AND lt.team_id > 0),
    'clubs_with_squad', (SELECT count(DISTINCT team_id) FROM pro_squads),
    'players_total', (SELECT count(*) FROM pro_players WHERE id > 0),
    'players_in_squads', (SELECT count(DISTINCT player_id) FROM pro_squads),
    'players_with_season_stats', (SELECT count(DISTINCT player_id) FROM pro_player_season_stats),
    'finals', (SELECT count(*) FROM pro_fixtures WHERE status = 'final' AND coalesce(source, 'api-football') = 'api-football'),
    'finals_detailed', (SELECT count(*) FROM pro_fixtures WHERE status = 'final' AND coalesce(source, 'api-football') = 'api-football' AND detail_fetched_at IS NOT NULL),
    'transfers', (SELECT count(*) FROM pro_transfers),
    'db_bytes', pg_database_size(current_database()),
    'at', now()
  );
$$;
REVOKE ALL ON FUNCTION public.pro_world_coverage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_world_coverage() TO service_role;
