-- Men's or women's for every pro player (2026-10-12): 662k of 664k players had no gender, and the college-to-pro name
-- matcher skips a player without one (Sam Sarver, FC Dallas, was never matched to Indiana). Taken from the
-- competitions the player has season stats or match lines in (pro_leagues.gender), else the clubs whose squad lists
-- them (pro_teams.gender). Refreshed daily by pro-rank with pro_refresh_americans. Rollback: drop the function.
CREATE OR REPLACE FUNCTION public.pro_refresh_player_gender() RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public' SET statement_timeout TO '600s' AS $$
DECLARE n integer;
BEGIN
  WITH seen AS (
    SELECT s.player_id, l.gender FROM public.pro_player_season_stats s JOIN public.pro_leagues l ON l.id = s.league_id WHERE l.gender IN ('m', 'w')
    UNION ALL
    SELECT q.player_id, t.gender FROM public.pro_squads q JOIN public.pro_teams t ON t.id = q.team_id WHERE t.gender IN ('m', 'w')
  ), g AS (
    SELECT player_id, CASE WHEN count(*) FILTER (WHERE gender = 'w') > count(*) FILTER (WHERE gender = 'm') THEN 'w' ELSE 'm' END AS gender
    FROM seen GROUP BY player_id
  )
  UPDATE public.pro_players p SET gender = g.gender FROM g
   WHERE g.player_id = p.id AND p.gender IS DISTINCT FROM g.gender;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pro_refresh_player_gender() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_refresh_player_gender() TO service_role;
