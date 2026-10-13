-- pro_leaders, faster (2026-10-13): the same answer as 164's, in about a tenth of the time. Leaders, Players, Americans
-- abroad and a country's page took 15-50 s; the default men's goals list read in 27 s.
--   * "Our match-line totals only while the league season has no provider or ASA totals" was a NOT EXISTS checked for
--     every season row (54k probes, ~15 s); it is now worked out once per league season (ls).
--   * The fixtures count that catches misfiled provider rows (152) only reads league seasons that have provider rows,
--     through the (league_id, season) index.
--   * Player names and photos are joined after the page is cut, not for all ~100k ranked rows.
-- Same signature, so CREATE OR REPLACE keeps the grants. Rollback: 164's pro_leaders body.

CREATE OR REPLACE FUNCTION public.pro_leaders(p_stat text DEFAULT 'goals'::text, p_league integer DEFAULT NULL::integer, p_season integer DEFAULT NULL::integer, p_position text DEFAULT NULL::text, p_nationality text DEFAULT NULL::text, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_min_minutes integer DEFAULT 0, p_per90 boolean DEFAULT false, p_gender text DEFAULT NULL::text, p_abroad text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_country text DEFAULT NULL::text, p_scope text DEFAULT NULL::text, p_level text DEFAULT NULL::text)
 RETURNS TABLE(player_id integer, name text, slug text, photo text, nationality text, birth_date date, pos text, team_id integer, league_id integer, season integer, apps integer, minutes integer, goals integer, assists integer, rating numeric, value numeric, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
AS $function$
DECLARE val text;
BEGIN
  IF p_stat NOT IN ('goals','assists','apps','minutes','shots','shots_on','key_passes','passes','tackles','interceptions',
    'duels_won','dribbles_won','saves','clean_sheets','yellow','red','rating','pen_scored','fouls_drawn','blocks','starts') THEN
    p_stat := 'goals';
  END IF;
  -- The player's value over his clubs: a sum, or the minutes-weighted rating.
  val := CASE WHEN p_stat = 'rating'
    THEN 'round((sum(s.rating * s.minutes) FILTER (WHERE s.rating IS NOT NULL) / nullif(sum(s.minutes) FILTER (WHERE s.rating IS NOT NULL), 0))::numeric, 2)'
    ELSE format('sum(s.%I)', p_stat) END;
  RETURN QUERY EXECUTE format($q$
    WITH ls AS MATERIALIZED (
      -- The competitions asked for, each in the season asked for (else its current one), and whether that season has
      -- provider or ASA totals (then our own match-line totals are left out).
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
      -- Each club's fixtures in the competitions above, to catch season rows the provider filed under the wrong one.
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
      SELECT a.*, round((CASE WHEN $9 AND %2$L NOT IN ('rating','minutes','apps','starts') THEN a.v * 90.0 / nullif(a.minutes, 0) ELSE a.v END)::numeric, 2) AS value,
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
