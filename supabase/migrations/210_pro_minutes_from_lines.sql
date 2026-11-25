-- Pro season minutes (2026-11-24). The provider's season total runs short of the sum of its own match lines: in the
-- 2026 NWSL 111 of the 223 players with the same number of appearances in both were over 30 minutes short (about 100
-- on average), in MLS 78 of 864. American Soccer Analysis, which counts stoppage time, is closer to the lines than to
-- the total in both leagues. So where the match lines cover every appearance the provider counts, the season's minutes
-- are their sum; where they do not (a match without player lines), the provider's total stays.
--
-- Only finals that ended before the row was fetched are summed: the site adds later ones at read time (catchUp.ts),
-- and counting them here would count them twice. Called by the league_players crawl task when it completes a league
-- season. Idempotent. Rollback: drop the function; the next crawl writes the provider's minutes back.

CREATE OR REPLACE FUNCTION public.pro_minutes_from_lines(p_league integer, p_season integer)
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
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

REVOKE ALL ON FUNCTION public.pro_minutes_from_lines(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_minutes_from_lines(integer, integer) TO service_role;

notify pgrst, 'reload schema';
