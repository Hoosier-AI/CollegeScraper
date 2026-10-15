-- Per-90s and percentiles without inflated rows (2026-10-14): players whose appearances are partly known only from
-- match events (no minutes) are kept out of per-90 lists and percentiles; percentiles are per player across clubs,
-- without misfiled provider rows. Plus the stat-audit and college Elo history tables.

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
), evp AS (
  -- Players with appearances known only from match events (no lineup, so no minutes): their totals count those games
  -- but their minutes do not, so a per-90 would be inflated.
  SELECT DISTINCT fp.player_id, f.league_id, f.season
  FROM public.pro_fixture_players fp JOIN public.pro_fixtures f ON f.id = fp.fixture_id JOIN ls ON ls.league_id = f.league_id AND ls.season = f.season
  WHERE fp.from_events AND f.status = 'final'
)
SELECT a.*, (a.has_real_row OR NOT EXISTS (SELECT 1 FROM evp e WHERE e.player_id = a.player_id AND e.league_id = a.league_id AND e.season = a.season)) AS per90_ok,
  ls.gender AS l_gender, ls.country AS l_country, ls.scope AS l_scope, ls.level AS l_level,
  p.nationality, p.american, p.birth_date
FROM agg a
JOIN ls ON ls.league_id = a.league_id AND ls.season = a.season
JOIN public.pro_players p ON p.id = a.player_id;

CREATE UNIQUE INDEX pro_leader_rows_next_key ON public.pro_leader_rows_next (player_id, league_id, season);
CREATE INDEX pro_leader_rows_next_league_idx ON public.pro_leader_rows_next (league_id);

BEGIN;
DROP MATERIALIZED VIEW IF EXISTS public.pro_leader_rows;
ALTER MATERIALIZED VIEW public.pro_leader_rows_next RENAME TO pro_leader_rows;
ALTER INDEX public.pro_leader_rows_next_key RENAME TO pro_leader_rows_key;
ALTER INDEX public.pro_leader_rows_next_league_idx RENAME TO pro_leader_rows_league_idx;
REVOKE ALL ON public.pro_leader_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pro_leader_rows TO service_role;
COMMIT;



CREATE OR REPLACE FUNCTION public.pro_leaders(p_stat text DEFAULT 'goals'::text, p_league integer DEFAULT NULL::integer, p_season integer DEFAULT NULL::integer, p_position text DEFAULT NULL::text, p_nationality text DEFAULT NULL::text, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_min_minutes integer DEFAULT 0, p_per90 boolean DEFAULT false, p_gender text DEFAULT NULL::text, p_abroad text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_country text DEFAULT NULL::text, p_scope text DEFAULT NULL::text, p_level text DEFAULT NULL::text)
 RETURNS TABLE(player_id integer, name text, slug text, photo text, nationality text, birth_date date, pos text, team_id integer, league_id integer, season integer, apps integer, minutes integer, goals integer, assists integer, rating numeric, value numeric, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
AS $function$
DECLARE val text; col text;
BEGIN
  IF p_stat NOT IN ('goals','assists','apps','minutes','shots','shots_on','key_passes','passes','tackles','interceptions',
    'duels_won','dribbles_won','saves','clean_sheets','yellow','red','rating','pen_scored','fouls_drawn','blocks','starts','ppg','pps') THEN
    p_stat := 'goals';
  END IF;

  -- Current seasons: the precomputed rows.
  IF p_season IS NULL THEN
    col := CASE WHEN p_stat IN ('apps', 'minutes', 'goals', 'assists') THEN p_stat || '_v' ELSE p_stat END;
    RETURN QUERY EXECUTE format($q$
      WITH page AS (
        SELECT r.player_id, r.league_id, r.season, r.team_id, r.pos, r.apps, r.minutes, r.goals, r.assists, r.rating,
          round((CASE WHEN $9 AND %2$L NOT IN ('rating','minutes','apps','starts','ppg','pps') THEN r.%1$I * 90.0 / nullif(r.minutes, 0) ELSE r.%1$I END)::numeric, 2) AS value,
          count(*) OVER () AS total
        FROM public.pro_leader_rows r
        WHERE ($2 IS NULL OR r.league_id = $2)
          AND ($5 IS NULL OR r.nationality = $5 OR ($5 = 'USA' AND r.american))
          AND ($6 IS NULL OR r.birth_date <= (current_date - make_interval(years => $6)))
          AND ($7 IS NULL OR r.birth_date > (current_date - make_interval(years => $7 + 1)))
          AND ($10 IS NULL OR r.l_gender = $10)
          AND ($11 IS NULL OR coalesce(r.l_country, '') <> $11)
          AND ($14 IS NULL OR r.l_country = $14)
          AND ($15 IS NULL OR r.l_scope = $15)
          AND ($16 IS NULL OR r.l_level = $16)
          AND r.%1$I IS NOT NULL AND coalesce(r.minutes, 0) >= coalesce($8, 0) AND ($4 IS NULL OR r.pos = $4)
          AND (NOT $9 OR r.per90_ok OR %2$L IN ('rating','minutes','apps','starts','ppg','pps'))
        ORDER BY value DESC NULLS LAST, r.minutes ASC, r.player_id
        LIMIT $12 OFFSET $13
      )
      SELECT a.player_id, p.display_name, p.slug, p.photo, p.nationality, p.birth_date, a.pos, a.team_id, a.league_id, a.season, a.apps, a.minutes, a.goals, a.assists, a.rating,
        a.value, a.total
      FROM page a JOIN public.pro_players p ON p.id = a.player_id
      ORDER BY a.value DESC NULLS LAST, a.minutes ASC, a.player_id
    $q$, col, p_stat)
    USING p_stat, p_league, p_season, p_position, p_nationality, p_min_age, p_max_age, p_min_minutes, p_per90, p_gender, p_abroad, least(p_limit, 200), p_offset, p_country, p_scope, p_level;
    RETURN;
  END IF;

  -- A season asked for: 171's live read.
  val := CASE WHEN p_stat = 'rating'
    THEN 'round((sum(s.rating * s.minutes) FILTER (WHERE s.rating IS NOT NULL) / nullif(sum(s.minutes) FILTER (WHERE s.rating IS NOT NULL), 0))::numeric, 2)'
    WHEN p_stat = 'ppg' THEN 'CASE WHEN sum(s.res_apps) >= 5 THEN round(sum(s.res_pts)::numeric / sum(s.res_apps), 2) END'
    WHEN p_stat = 'pps' THEN 'CASE WHEN sum(s.res_starts45) >= 5 THEN round(sum(s.res_pts45)::numeric / sum(s.res_starts45), 2) END'
    ELSE format('sum(s.%I)', p_stat) END;
  RETURN QUERY EXECUTE format($q$
    WITH ls AS MATERIALIZED (
      SELECT x.league_id, x.season, EXISTS (SELECT 1 FROM public.pro_player_season_stats c
               WHERE c.league_id = x.league_id AND c.season = x.season AND c.source IN ('provider', 'asa')) AS has_real
      FROM (
        SELECT l.id AS league_id, coalesce($3, l.current_season) AS season
        FROM public.pro_leagues l
        WHERE l.enabled
          AND ($2 IS NULL OR l.id = $2)
          AND ($10 IS NULL OR l.gender = $10)
          AND ($11 IS NULL OR coalesce(l.country, '') <> $11)
          AND ($14 IS NULL OR l.country = $14)
          AND ($15 IS NULL OR l.scope = $15)
          AND ($16 IS NULL OR l.level = $16)
      ) x
      WHERE x.season IS NOT NULL
    ), base0 AS MATERIALIZED (
      SELECT s.*, coalesce(s.position, p.position) AS pos0
      FROM ls
      JOIN public.pro_player_season_stats s ON s.league_id = ls.league_id AND s.season = ls.season
      JOIN public.pro_players p ON p.id = s.player_id
      WHERE NOT p.noindex
        AND ($5 IS NULL OR p.nationality = $5 OR ($5 = 'USA' AND p.american))
        AND ($6 IS NULL OR p.birth_date <= (current_date - make_interval(years => $6)))
        AND ($7 IS NULL OR p.birth_date > (current_date - make_interval(years => $7 + 1)))
        AND (s.source <> 'computed' OR NOT ls.has_real)
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
        %1$s AS v
      FROM base s GROUP BY 1, 2, 3
    ), page AS (
      SELECT a.*, round((CASE WHEN $9 AND %2$L NOT IN ('rating','minutes','apps','starts','ppg','pps') THEN a.v * 90.0 / nullif(a.minutes, 0) ELSE a.v END)::numeric, 2) AS value,
        count(*) OVER () AS total
      FROM agg a
      WHERE a.v IS NOT NULL AND coalesce(a.minutes, 0) >= coalesce($8, 0) AND ($4 IS NULL OR a.pos = $4)
      ORDER BY value DESC NULLS LAST, a.minutes ASC, a.player_id
      LIMIT $12 OFFSET $13
    )
    SELECT a.player_id, p.display_name, p.slug, p.photo, p.nationality, p.birth_date, a.pos, a.team_id, a.league_id, a.season, a.apps, a.minutes, a.goals, a.assists, a.rating,
      a.value, a.total
    FROM page a JOIN public.pro_players p ON p.id = a.player_id
    ORDER BY a.value DESC NULLS LAST, a.minutes ASC, a.player_id
  $q$, val, p_stat)
  USING p_stat, p_league, p_season, p_position, p_nationality, p_min_age, p_max_age, p_min_minutes, p_per90, p_gender, p_abroad, least(p_limit, 200), p_offset, p_country, p_scope, p_level;
END $function$;

-- Percentiles per player, not per club row (a player with two clubs in a league was counted twice, and one with
-- 300 + 300 minutes was left out); misfiled provider rows and our own totals where the provider or ASA has the season
-- are left out, as in the leaders; players with appearances known only from events have no per-90s.
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
    SELECT a.* FROM agg a WHERE a.real_row OR NOT EXISTS (SELECT 1 FROM evp e WHERE e.player_id = a.player_id)
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

-- The stat audit (stat-audit job): one row per check per run, the agreement and the worst rows.
CREATE TABLE IF NOT EXISTS public.stat_audit_runs (
  id bigserial PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  area text NOT NULL,          -- college | pro | intl
  check_key text NOT NULL,     -- e.g. 'ncaa:Total Assists', 'mls:goals'
  label text NOT NULL,
  compared int NOT NULL,
  agree int NOT NULL,
  rate numeric NOT NULL,
  target numeric,
  worst jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS stat_audit_runs_key_idx ON public.stat_audit_runs (check_key, run_at DESC);
ALTER TABLE public.stat_audit_runs ENABLE ROW LEVEL SECURITY;

-- College Plaibook Elo, one row per program a day (the team page's trend).
CREATE TABLE IF NOT EXISTS public.college_elo_history (
  program_id uuid NOT NULL REFERENCES public.college_programs(id) ON DELETE CASCADE,
  day date NOT NULL,
  rating numeric NOT NULL,
  rank int,
  PRIMARY KEY (program_id, day)
);
ALTER TABLE public.college_elo_history ENABLE ROW LEVEL SECURITY;
