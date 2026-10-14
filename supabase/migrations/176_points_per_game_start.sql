-- PPG and PPS for every player (2026-10-14): a player earns his team's result in each game he plays, 3 for a win,
-- 1 for a tie, 0 for a loss. PPG averages it over his appearances; PPS over his starts of 45+ minutes. A game decided
-- on penalties is a tie (the score is level). Worked out by functions of their own, run after each season-total
-- refresh, so the long college and pro aggregate functions stay as they are.

ALTER TABLE college_player_season_stats
  ADD COLUMN IF NOT EXISTS res_apps int, ADD COLUMN IF NOT EXISTS res_pts int, ADD COLUMN IF NOT EXISTS ppg numeric(4,2),
  ADD COLUMN IF NOT EXISTS pps_starts int, ADD COLUMN IF NOT EXISTS pps_pts int, ADD COLUMN IF NOT EXISTS pps numeric(4,2);

ALTER TABLE pro_player_season_stats
  ADD COLUMN IF NOT EXISTS res_apps int, ADD COLUMN IF NOT EXISTS res_pts int,
  ADD COLUMN IF NOT EXISTS res_starts45 int, ADD COLUMN IF NOT EXISTS res_pts45 int;

-- College: the truth-source line of each finished game, with minutes and the starter mark borrowed from the other
-- source when the truth source does not publish them (as college_refresh_season_aggregates does).
CREATE OR REPLACE FUNCTION public.college_refresh_result_points(p_season integer, p_program uuid DEFAULT NULL::uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE n integer;
BEGIN
  DROP TABLE IF EXISTS _rp_lines;
  CREATE TEMP TABLE _rp_lines ON COMMIT DROP AS
    SELECT gps.game_id, gps.program_id, gps.source, gps.player_season_id, gps.minutes, gps.starter, gps.participated
      FROM college_game_player_stats gps JOIN college_games g ON g.id = gps.game_id
     WHERE g.season = p_season AND g.status = 'final' AND g.source_of_truth IS NOT NULL AND gps.player_season_id IS NOT NULL
       AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL AND (p_program IS NULL OR gps.program_id = p_program);
  ANALYZE _rp_lines;
  WITH truth AS (
    SELECT t.player_season_id, t.participated,
           coalesce(t.minutes, alt.minutes) AS minutes, (t.starter OR coalesce(alt.starter, false)) AS starter,
           CASE WHEN g.home_score = g.away_score THEN 1
                WHEN (t.program_id = g.home_program_id) = (g.home_score > g.away_score) THEN 3 ELSE 0 END AS pts
      FROM _rp_lines t JOIN college_games g ON g.id = t.game_id
      LEFT JOIN _rp_lines alt ON alt.game_id = t.game_id AND alt.program_id = t.program_id AND alt.player_season_id = t.player_season_id AND alt.source <> t.source
     WHERE t.source = g.source_of_truth
  ), agg AS (
    SELECT player_season_id,
           count(*) FILTER (WHERE participated OR coalesce(minutes, 0) > 0) AS apps,
           coalesce(sum(pts) FILTER (WHERE participated OR coalesce(minutes, 0) > 0), 0) AS pts,
           count(*) FILTER (WHERE starter AND minutes >= 45) AS s45,
           coalesce(sum(pts) FILTER (WHERE starter AND minutes >= 45), 0) AS p45
      FROM truth GROUP BY player_season_id
  ), u AS (
    UPDATE college_player_season_stats s SET res_apps = a.apps, res_pts = a.pts,
           ppg = CASE WHEN a.apps > 0 THEN round(a.pts::numeric / a.apps, 2) END,
           pps_starts = a.s45, pps_pts = a.p45, pps = CASE WHEN a.s45 > 0 THEN round(a.p45::numeric / a.s45, 2) END
      FROM agg a WHERE a.player_season_id = s.player_season_id
    RETURNING 1
  ) SELECT count(*) INTO n FROM u;
  RETURN n;
END $function$;

-- Pro: every finished fixture line of the league season (provider and ASA season rows have no per-match basis, so
-- the sums come from pro_fixture_players for every season row of the player, club, competition and season).
CREATE OR REPLACE FUNCTION public.pro_refresh_result_points(p_league integer, p_season integer)
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH lines AS (
    SELECT fp.player_id, fp.team_id, fp.starter, fp.minutes, fp.from_events,
           CASE WHEN f.home_goals = f.away_goals THEN 1
                WHEN (fp.team_id = f.home_team_id) = (f.home_goals > f.away_goals) THEN 3 ELSE 0 END AS pts
      FROM pro_fixture_players fp JOIN pro_fixtures f ON f.id = fp.fixture_id
     WHERE f.league_id = p_league AND f.season = p_season AND f.status = 'final' AND fp.player_id IS NOT NULL
       AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
  ), agg AS (
    SELECT player_id, team_id,
           count(*) FILTER (WHERE coalesce(minutes, 0) > 0 OR from_events) AS apps,
           coalesce(sum(pts) FILTER (WHERE coalesce(minutes, 0) > 0 OR from_events), 0) AS pts,
           count(*) FILTER (WHERE starter AND minutes >= 45) AS s45,
           coalesce(sum(pts) FILTER (WHERE starter AND minutes >= 45), 0) AS p45
      FROM lines GROUP BY player_id, team_id
  ), u AS (
    UPDATE pro_player_season_stats s SET res_apps = a.apps, res_pts = a.pts, res_starts45 = a.s45, res_pts45 = a.p45
      FROM agg a WHERE s.player_id = a.player_id AND s.team_id = a.team_id AND s.league_id = p_league AND s.season = p_season
    RETURNING 1
  ) SELECT count(*)::int FROM u;
$function$;

-- Every pro league season at once (the first fill; afterwards each refresh runs its own).
CREATE OR REPLACE FUNCTION public.pro_refresh_result_points_all(p_since integer DEFAULT 2000)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '0' AS $function$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT DISTINCT league_id, season FROM pro_player_season_stats WHERE season >= p_since LOOP
    n := n + pro_refresh_result_points(r.league_id, r.season);
  END LOOP;
  RETURN n;
END $function$;
