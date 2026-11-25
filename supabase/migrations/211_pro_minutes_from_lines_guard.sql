-- pro_minutes_from_lines (migration 210) trusted every league's match lines. MLS Next Pro's overstate: its clubs' lines
-- add up to 1,053-1,068 minutes a game (eleven players for ninety is 990; MLS, the NWSL and the USL are 943-1,008),
-- and 19% of its players have more line minutes than American Soccer Analysis counts with stoppage time included
-- (0.1-2% in the other leagues). A league season whose lines add up to more than 1,030 a club and game is left with
-- the provider's totals. The four MLS Next Pro seasons already changed (2022-2025) get the provider's totals back from
-- a fresh league_players crawl.

CREATE OR REPLACE FUNCTION public.pro_minutes_from_lines(p_league integer, p_season integer)
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer; per_game numeric;
BEGIN
  SELECT sum(p.minutes)::numeric / nullif(count(DISTINCT (f.id, p.team_id)), 0) INTO per_game
    FROM pro_fixtures f JOIN pro_fixture_players p ON p.fixture_id = f.id
   WHERE f.league_id = p_league AND f.season = p_season AND f.status = 'final' AND p.minutes > 0;
  IF per_game IS NULL OR per_game > 1030 THEN RETURN 0; END IF;
  WITH ln AS (
    SELECT s.player_id, s.team_id, sum(coalesce(p.minutes, 0)) AS m, count(*) FILTER (WHERE coalesce(p.minutes, 0) > 0) AS apps
      FROM pro_player_season_stats s
      JOIN pro_fixtures f ON f.league_id = s.league_id AND f.season = s.season AND f.status = 'final'
                         AND (f.final_at IS NULL OR f.final_at <= s.computed_at)
      JOIN pro_fixture_players p ON p.fixture_id = f.id AND p.player_id = s.player_id AND p.team_id = s.team_id
     WHERE s.league_id = p_league AND s.season = p_season AND s.source = 'provider'
     GROUP BY s.player_id, s.team_id
  )
  UPDATE pro_player_season_stats s SET minutes = ln.m
    FROM ln
   WHERE s.league_id = p_league AND s.season = p_season AND s.source = 'provider'
     AND s.player_id = ln.player_id AND s.team_id = ln.team_id
     AND ln.apps > 0 AND ln.apps = coalesce(s.apps, 0) AND ln.m > 0 AND s.minutes IS DISTINCT FROM ln.m;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;

UPDATE public.pro_crawl_tasks SET due_at = now(), last_done_at = NULL, page = 0
 WHERE kind = 'league_players' AND key IN ('909|2022', '909|2023', '909|2024', '909|2025');
