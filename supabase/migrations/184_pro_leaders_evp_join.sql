-- 182's leaders view and percentiles, made fast again (2026-10-14): `has_real_row OR NOT EXISTS (events-only players)`
-- cannot become an anti join because of the OR, so the 17 s events-only list ran once per row and the hourly refresh
-- went from ~30 s to over 10 minutes. The list is built once and left-joined instead. Same results.

-- Events-only lines are a small slice of the match lines: an index on just them keeps the hourly refresh from reading
-- the whole table (17 s -> 4.5 s for the list). Built CONCURRENTLY by hand in prod; here plain for a fresh database.
CREATE INDEX IF NOT EXISTS pro_fixture_players_from_events_idx ON public.pro_fixture_players (fixture_id) INCLUDE (player_id) WHERE from_events;

DROP MATERIALIZED VIEW IF EXISTS public.pro_leader_rows_next;
CREATE MATERIALIZED VIEW public.pro_leader_rows_next AS
WITH ls AS MATERIALIZED (
  SELECT l.id AS league_id, l.current_season AS season, l.gender, l.country, l.scope, l.level,
    EXISTS (SELECT 1 FROM public.pro_player_season_stats c
            WHERE c.league_id = l.id AND c.season = l.current_season AND c.source IN ('provider', 'asa')) AS has_real
  FROM public.pro_leagues l
  WHERE l.enabled AND l.current_season IS NOT NULL
), base0 AS MATERIALIZED (
  SELECT s.*, coalesce(s.position, p.position) AS pos0
  FROM ls
  JOIN public.pro_player_season_stats s ON s.league_id = ls.league_id AND s.season = ls.season
  JOIN public.pro_players p ON p.id = s.player_id
  WHERE NOT p.noindex AND (s.source <> 'computed' OR NOT ls.has_real)
), fx AS (
  SELECT f.league_id, f.season, x.team_id, count(*)::int AS n
  FROM (SELECT DISTINCT b.league_id, b.season FROM base0 b WHERE b.source = 'provider') ps
  JOIN public.pro_fixtures f ON f.league_id = ps.league_id AND f.season = ps.season
  CROSS JOIN LATERAL (VALUES (f.home_team_id), (f.away_team_id)) x(team_id)
  GROUP BY 1, 2, 3
), base AS (
  SELECT s.* FROM base0 s
  LEFT JOIN fx ON fx.league_id = s.league_id AND fx.season = s.season AND fx.team_id = s.team_id
  WHERE NOT (s.source = 'provider' AND coalesce(fx.n, 0) > 0 AND s.apps > fx.n + 2)
), agg AS (
  SELECT s.player_id, s.league_id, s.season,
    (array_agg(s.team_id ORDER BY s.minutes DESC NULLS LAST))[1] AS team_id,
    (array_agg(s.pos0 ORDER BY s.minutes DESC NULLS LAST))[1] AS pos,
    sum(s.apps)::int AS apps, sum(s.minutes)::int AS minutes, sum(s.goals)::int AS goals, sum(s.assists)::int AS assists,
    round((sum(s.rating * s.minutes) FILTER (WHERE s.rating IS NOT NULL) / nullif(sum(s.minutes) FILTER (WHERE s.rating IS NOT NULL), 0))::numeric, 2) AS rating,
    sum(s.starts) AS starts, sum(s.shots) AS shots, sum(s.shots_on) AS shots_on, sum(s.key_passes) AS key_passes, sum(s.passes) AS passes,
    sum(s.tackles) AS tackles, sum(s.interceptions) AS interceptions, sum(s.duels_won) AS duels_won, sum(s.dribbles_won) AS dribbles_won,
    sum(s.saves) AS saves, sum(s.clean_sheets) AS clean_sheets, sum(s.yellow) AS yellow, sum(s.red) AS red, sum(s.pen_scored) AS pen_scored,
    sum(s.fouls_drawn) AS fouls_drawn, sum(s.blocks) AS blocks,
    -- The sums as the stat list reads them (apps .. assists above are int casts of the same sums).
    sum(s.apps) AS apps_v, sum(s.minutes) AS minutes_v, sum(s.goals) AS goals_v, sum(s.assists) AS assists_v,
    -- PPG and PPS (176): result points over appearances and over starts of 45+ minutes, 5+ of each to be listed.
    CASE WHEN sum(s.res_apps) >= 5 THEN round(sum(s.res_pts)::numeric / sum(s.res_apps), 2) END AS ppg,
    CASE WHEN sum(s.res_starts45) >= 5 THEN round(sum(s.res_pts45)::numeric / sum(s.res_starts45), 2) END AS pps,
    sum(s.res_apps)::int AS res_apps, sum(s.res_starts45)::int AS res_starts45,
    bool_or(s.source <> 'computed') AS has_real_row
  FROM base s GROUP BY 1, 2, 3
), evp AS MATERIALIZED (
  -- Players with appearances known only from match events (no lineup, so no minutes): their totals count those games
  -- but their minutes do not, so a per-90 would be inflated.
  SELECT DISTINCT fp.player_id, f.league_id, f.season
  FROM public.pro_fixture_players fp JOIN public.pro_fixtures f ON f.id = fp.fixture_id JOIN ls ON ls.league_id = f.league_id AND ls.season = f.season
  WHERE fp.from_events AND f.status = 'final'
)
SELECT a.*, (a.has_real_row OR e.player_id IS NULL) AS per90_ok,
  ls.gender AS l_gender, ls.country AS l_country, ls.scope AS l_scope, ls.level AS l_level,
  p.nationality, p.american, p.birth_date
FROM agg a
JOIN ls ON ls.league_id = a.league_id AND ls.season = a.season
JOIN public.pro_players p ON p.id = a.player_id
LEFT JOIN evp e ON e.player_id = a.player_id AND e.league_id = a.league_id AND e.season = a.season;

CREATE UNIQUE INDEX pro_leader_rows_next_key ON public.pro_leader_rows_next (player_id, league_id, season);
CREATE INDEX pro_leader_rows_next_league_idx ON public.pro_leader_rows_next (league_id);

BEGIN;
DROP MATERIALIZED VIEW IF EXISTS public.pro_leader_rows;
ALTER MATERIALIZED VIEW public.pro_leader_rows_next RENAME TO pro_leader_rows;
ALTER INDEX public.pro_leader_rows_next_key RENAME TO pro_leader_rows_key;
ALTER INDEX public.pro_leader_rows_next_league_idx RENAME TO pro_leader_rows_league_idx;
-- A new view has no statistics: without them the hourly REFRESH CONCURRENTLY diff plans a nested loop (10+ minutes).
ANALYZE public.pro_leader_rows;

CREATE OR REPLACE FUNCTION public.pro_player_percentiles(p_player integer, p_league integer, p_season integer)
 RETURNS TABLE(stat text, value numeric, pct numeric, peers integer)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH ls AS (
    SELECT EXISTS (SELECT 1 FROM public.pro_player_season_stats c WHERE c.league_id = p_league AND c.season = p_season AND c.source IN ('provider', 'asa')) AS has_real
  ), fx AS (
    SELECT x.team_id, count(*)::int AS n FROM public.pro_fixtures f CROSS JOIN LATERAL (VALUES (f.home_team_id), (f.away_team_id)) x(team_id)
     WHERE f.league_id = p_league AND f.season = p_season GROUP BY 1
  ), base AS (
    SELECT s.*, coalesce(s.position, p.position) AS pos0
      FROM ls, public.pro_player_season_stats s JOIN public.pro_players p ON p.id = s.player_id
      LEFT JOIN fx ON fx.team_id = s.team_id
     WHERE s.league_id = p_league AND s.season = p_season AND NOT p.noindex AND (s.source <> 'computed' OR NOT ls.has_real)
       AND NOT (s.source = 'provider' AND coalesce(fx.n, 0) > 0 AND s.apps > fx.n + 2)
  ), evp AS (
    SELECT DISTINCT fp.player_id FROM public.pro_fixture_players fp JOIN public.pro_fixtures f ON f.id = fp.fixture_id
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
    SELECT a.* FROM agg a LEFT JOIN evp e ON e.player_id = a.player_id WHERE a.real_row OR e.player_id IS NULL
  ), me AS (SELECT pos FROM rows WHERE player_id = p_player),
  peers AS (SELECT r.* FROM rows r, me WHERE r.pos IS NOT DISTINCT FROM me.pos),
  long AS (
    SELECT player_id, k, v FROM peers, LATERAL (VALUES
      ('goals', goals * 90.0 / minutes), ('assists', assists * 90.0 / minutes), ('shots', shots * 90.0 / minutes),
      ('shots_on', shots_on * 90.0 / minutes), ('key_passes', key_passes * 90.0 / minutes), ('passes', passes * 90.0 / minutes),
      ('pass_accuracy', pass_accuracy::numeric), ('tackles', tackles * 90.0 / minutes), ('interceptions', interceptions * 90.0 / minutes),
      ('duels_won', duels_won * 90.0 / minutes), ('dribbles_won', dribbles_won * 90.0 / minutes), ('saves', saves * 90.0 / minutes),
      ('rating', rating::numeric)
    ) x(k, v) WHERE v IS NOT NULL
  ), ranked AS (
    SELECT player_id, k, v, percent_rank() OVER (PARTITION BY k ORDER BY v) AS pr, count(*) OVER (PARTITION BY k) AS n FROM long
  )
  SELECT k, round(v::numeric, 2), round(pr::numeric, 3), n::int FROM ranked WHERE player_id = p_player AND n >= 5
$function$;

notify pgrst, 'reload schema';
