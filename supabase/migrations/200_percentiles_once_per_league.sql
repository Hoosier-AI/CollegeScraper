-- 200: player percentiles computed once per league season, not once per page view.
-- pro_player_percentiles (182) ranked a whole league season on every player page view, scanning the 2 GB match-line
-- table each time. 2026-10-19: ~45,000 calls in 10 hours at ~1 s each were the largest share of the database's disk
-- reads, on a database that had run out of disk bandwidth (site pages timing out, jobs failing on connection waits).
-- Now: pro_refresh_percentiles(league, season) ranks every player of a league season into pro_percentile_rows; the
-- page's pro_player_percentiles reads its rows, refreshing the league season first when it has none or they are over
-- 12 hours old (so the first view after a match day pays once, every other view is an index read). Same output.
-- Rollback: re-run 182's pro_player_percentiles; drop pro_refresh_percentiles, pro_percentile_rows, pro_percentile_seasons.

CREATE TABLE IF NOT EXISTS public.pro_percentile_rows (
  league_id integer NOT NULL, season integer NOT NULL, player_id integer NOT NULL, stat text NOT NULL,
  value numeric, pct numeric, peers integer,
  PRIMARY KEY (league_id, season, player_id, stat)
);
CREATE INDEX IF NOT EXISTS pro_percentile_rows_player_idx ON public.pro_percentile_rows (player_id, league_id, season);
CREATE TABLE IF NOT EXISTS public.pro_percentile_seasons (
  league_id integer NOT NULL, season integer NOT NULL, refreshed_at timestamptz NOT NULL DEFAULT now(), players integer,
  PRIMARY KEY (league_id, season)
);
ALTER TABLE public.pro_percentile_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_percentile_seasons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_percentile_rows, public.pro_percentile_seasons FROM anon, authenticated;

-- Every player of the league season at once: 182's query, ranked within each player's own position group.
CREATE OR REPLACE FUNCTION public.pro_refresh_percentiles(p_league integer, p_season integer) RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_rows integer;
BEGIN
  -- One refresh of a league season at a time; a second caller waits for it and then reads its rows.
  PERFORM pg_advisory_xact_lock(hashtext('pro_percentiles'), p_league * 10000 + (p_season % 10000));
  IF EXISTS (SELECT 1 FROM pro_percentile_seasons WHERE league_id = p_league AND season = p_season AND refreshed_at > now() - interval '12 hours') THEN
    RETURN 0;
  END IF;
  DELETE FROM pro_percentile_rows WHERE league_id = p_league AND season = p_season;
  INSERT INTO pro_percentile_rows (league_id, season, player_id, stat, value, pct, peers)
  WITH ls AS (
    SELECT EXISTS (SELECT 1 FROM pro_player_season_stats c WHERE c.league_id = p_league AND c.season = p_season AND c.source IN ('provider', 'asa')) AS has_real
  ), fx AS (
    SELECT x.team_id, count(*)::int AS n FROM pro_fixtures f CROSS JOIN LATERAL (VALUES (f.home_team_id), (f.away_team_id)) x(team_id)
     WHERE f.league_id = p_league AND f.season = p_season GROUP BY 1
  ), base AS (
    SELECT s.*, coalesce(s.position, p.position) AS pos0
      FROM ls, pro_player_season_stats s JOIN pro_players p ON p.id = s.player_id
      LEFT JOIN fx ON fx.team_id = s.team_id
     WHERE s.league_id = p_league AND s.season = p_season AND NOT p.noindex AND (s.source <> 'computed' OR NOT ls.has_real)
       AND NOT (s.source = 'provider' AND coalesce(fx.n, 0) > 0 AND s.apps > fx.n + 2)
  ), evp AS (
    SELECT DISTINCT fp.player_id FROM pro_fixture_players fp JOIN pro_fixtures f ON f.id = fp.fixture_id
     WHERE f.league_id = p_league AND f.season = p_season AND f.status = 'final' AND fp.from_events
  ), agg AS (
    SELECT player_id, (array_agg(pos0 ORDER BY minutes DESC NULLS LAST))[1] AS pos, sum(minutes) AS minutes,
      sum(goals) AS goals, sum(assists) AS assists, sum(shots) AS shots, sum(shots_on) AS shots_on, sum(key_passes) AS key_passes,
      sum(passes) AS passes, sum(tackles) AS tackles, sum(interceptions) AS interceptions, sum(duels_won) AS duels_won,
      sum(dribbles_won) AS dribbles_won, sum(saves) AS saves,
      sum(pass_accuracy * minutes) FILTER (WHERE pass_accuracy IS NOT NULL) / nullif(sum(minutes) FILTER (WHERE pass_accuracy IS NOT NULL), 0) AS pass_accuracy,
      sum(rating * minutes) FILTER (WHERE rating IS NOT NULL) / nullif(sum(minutes) FILTER (WHERE rating IS NOT NULL), 0) AS rating,
      bool_or(source <> 'computed') AS real_row
    FROM base GROUP BY player_id HAVING sum(minutes) >= 450
  ), rows AS (
    SELECT a.* FROM agg a WHERE a.real_row OR NOT EXISTS (SELECT 1 FROM evp e WHERE e.player_id = a.player_id)
  ), long AS (
    SELECT player_id, pos, k, v FROM rows, LATERAL (VALUES
      ('goals', goals * 90.0 / minutes), ('assists', assists * 90.0 / minutes), ('shots', shots * 90.0 / minutes),
      ('shots_on', shots_on * 90.0 / minutes), ('key_passes', key_passes * 90.0 / minutes), ('passes', passes * 90.0 / minutes),
      ('pass_accuracy', pass_accuracy::numeric), ('tackles', tackles * 90.0 / minutes), ('interceptions', interceptions * 90.0 / minutes),
      ('duels_won', duels_won * 90.0 / minutes), ('dribbles_won', dribbles_won * 90.0 / minutes), ('saves', saves * 90.0 / minutes),
      ('rating', rating::numeric)
    ) x(k, v) WHERE v IS NOT NULL
  ), ranked AS (
    SELECT player_id, k, v, percent_rank() OVER (PARTITION BY pos, k ORDER BY v) AS pr, count(*) OVER (PARTITION BY pos, k) AS n FROM long
  )
  SELECT p_league, p_season, player_id, k, round(v::numeric, 2), round(pr::numeric, 3), n::int FROM ranked WHERE n >= 5;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  INSERT INTO pro_percentile_seasons (league_id, season, refreshed_at, players)
  VALUES (p_league, p_season, now(), v_rows)
  ON CONFLICT (league_id, season) DO UPDATE SET refreshed_at = excluded.refreshed_at, players = excluded.players;
  RETURN v_rows;
END $$;

-- The page's call, same signature and output as 182: the stored rows, refreshed first when missing or stale.
CREATE OR REPLACE FUNCTION public.pro_player_percentiles(p_player integer, p_league integer, p_season integer)
 RETURNS TABLE(stat text, value numeric, pct numeric, peers integer)
 LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pro_percentile_seasons s WHERE s.league_id = p_league AND s.season = p_season AND s.refreshed_at > now() - interval '12 hours') THEN
    PERFORM public.pro_refresh_percentiles(p_league, p_season);
  END IF;
  RETURN QUERY SELECT r.stat, r.value, r.pct, r.peers FROM pro_percentile_rows r
   WHERE r.league_id = p_league AND r.season = p_season AND r.player_id = p_player;
END $$;

REVOKE ALL ON FUNCTION public.pro_refresh_percentiles(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_refresh_percentiles(integer, integer) TO service_role;
