-- 202: a page view never ranks a league. 200 refreshed a league season inline on the first view after 12 hours;
-- crawlers walking players across hundreds of leagues turned that into bursts of 20-second rankings. Now the page reads
-- the stored rows (stale or not) and the hourly pro-leaders job refreshes league seasons in the background, current
-- seasons with recent matches first (pro_percentiles_due). Rollback: re-run 200's pro_player_percentiles.
CREATE OR REPLACE FUNCTION public.pro_player_percentiles(p_player integer, p_league integer, p_season integer)
 RETURNS TABLE(stat text, value numeric, pct numeric, peers integer)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT r.stat, r.value, r.pct, r.peers FROM pro_percentile_rows r
   WHERE r.league_id = p_league AND r.season = p_season AND r.player_id = p_player
$$;

-- League seasons whose rows are missing or over 12 hours old: current seasons of enabled leagues that have season
-- lines, those with a final in the last three days first, then by league priority.
CREATE OR REPLACE FUNCTION public.pro_percentiles_due(p_limit integer DEFAULT 40)
 RETURNS TABLE(league_id integer, season integer)
 LANGUAGE sql STABLE SET search_path TO 'public' SET statement_timeout TO '120s'
AS $$
  SELECT l.id, l.current_season FROM pro_leagues l
    LEFT JOIN pro_percentile_seasons s ON s.league_id = l.id AND s.season = l.current_season
   WHERE l.enabled AND l.current_season IS NOT NULL
     AND (s.refreshed_at IS NULL OR s.refreshed_at < now() - interval '12 hours')
     AND EXISTS (SELECT 1 FROM pro_player_season_stats x WHERE x.league_id = l.id AND x.season = l.current_season AND x.minutes >= 450)
   ORDER BY EXISTS (SELECT 1 FROM pro_fixtures f WHERE f.league_id = l.id AND f.season = l.current_season AND f.status = 'final' AND f.kickoff > now() - interval '3 days') DESC,
            s.refreshed_at NULLS FIRST, l.priority
   LIMIT p_limit
$$;
REVOKE ALL ON FUNCTION public.pro_percentiles_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_percentiles_due(integer) TO service_role;
