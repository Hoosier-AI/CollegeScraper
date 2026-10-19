-- 201: the pro-plan job's "players with minutes in these competitions" in one query.
-- It paged through pro_player_season_stats 1,000 rows at a time with OFFSET (up to 1.4M rows in full mode): each page
-- re-reads every row before it, so the job alone was ~16% of the database's disk reads on 2026-10-19. One distinct
-- list, returned as a single array (no paging). Rollback: drop the function (the job falls back to paging).
CREATE OR REPLACE FUNCTION public.pro_players_in_leagues(p_leagues integer[], p_min_season integer) RETURNS integer[]
LANGUAGE sql STABLE SET search_path TO 'public' SET statement_timeout TO '300s' AS $$
  SELECT coalesce(array_agg(DISTINCT player_id), '{}') FROM pro_player_season_stats
   WHERE league_id = ANY(p_leagues) AND season >= p_min_season AND minutes > 0 AND player_id > 0
$$;
REVOKE ALL ON FUNCTION public.pro_players_in_leagues(integer[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_players_in_leagues(integer[], integer) TO service_role;
