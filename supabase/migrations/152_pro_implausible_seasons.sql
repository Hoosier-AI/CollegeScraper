-- Impossible season rows out (2026-10-11): API-Football files some league seasons under a short competition (Aleksandar
-- Mitrovic's 28 Saudi league games and 28 goals as "FIFA Club World Cup 2025", where Al-Hilal played 5; about 200 rows
-- in the US Open Cup, Gold Cup, Leagues Cup, World Cup, NWSL x Liga MX Femenil Summer Cup). A provider row whose
-- appearances pass the club's fixtures in that competition and season by more than 2 is left out: of the leaders here,
-- and of player pages through pro_implausible_seasons(). Clubs with no fixtures stored there are trusted.
-- Rollback: migration 150's pro_leaders; DROP FUNCTION public.pro_implausible_seasons(integer).

CREATE OR REPLACE FUNCTION public.pro_leaders(p_stat text DEFAULT 'goals'::text, p_league integer DEFAULT NULL::integer, p_season integer DEFAULT NULL::integer, p_position text DEFAULT NULL::text, p_nationality text DEFAULT NULL::text, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_min_minutes integer DEFAULT 0, p_per90 boolean DEFAULT false, p_gender text DEFAULT NULL::text, p_abroad text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
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
    WITH base0 AS (
      SELECT s.*, coalesce(s.position, p.position) AS pos0
      FROM public.pro_player_season_stats s
      JOIN public.pro_players p ON p.id = s.player_id
      JOIN public.pro_leagues l ON l.id = s.league_id
      WHERE l.enabled AND NOT p.noindex
        AND (s.season = coalesce($3, CASE WHEN $2 IS NULL THEN l.current_season ELSE (SELECT current_season FROM public.pro_leagues WHERE id = $2) END))
        AND ($2 IS NULL OR s.league_id = $2)
        AND ($5 IS NULL OR p.nationality = $5)
        AND ($6 IS NULL OR p.birth_date <= (current_date - make_interval(years => $6)))
        AND ($7 IS NULL OR p.birth_date > (current_date - make_interval(years => $7 + 1)))
        AND ($10 IS NULL OR l.gender = $10)
        AND ($11 IS NULL OR coalesce(l.country, '') <> $11)
        AND (s.source <> 'computed' OR NOT EXISTS (SELECT 1 FROM public.pro_player_season_stats c
               WHERE c.league_id = s.league_id AND c.season = s.season AND c.source IN ('provider', 'asa')))
    ), fx AS (
      -- Each club's fixtures in the competitions above, to catch season rows the provider filed under the wrong one.
      SELECT f.league_id, f.season, x.team_id, count(*)::int AS n
      FROM public.pro_fixtures f
      JOIN (SELECT DISTINCT league_id, season FROM base0) ls ON ls.league_id = f.league_id AND ls.season = f.season
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
    )
    SELECT a.player_id, p.display_name, p.slug, p.photo, p.nationality, p.birth_date, a.pos, a.team_id, a.league_id, a.season, a.apps, a.minutes, a.goals, a.assists, a.rating,
      round((CASE WHEN $9 AND %2$L NOT IN ('rating','minutes','apps','starts') THEN a.v * 90.0 / nullif(a.minutes, 0) ELSE a.v END)::numeric, 2) AS value,
      count(*) OVER () AS total
    FROM agg a JOIN public.pro_players p ON p.id = a.player_id
    WHERE a.v IS NOT NULL AND coalesce(a.minutes, 0) >= coalesce($8, 0) AND ($4 IS NULL OR a.pos = $4)
    ORDER BY value DESC NULLS LAST, a.minutes ASC, a.player_id
    LIMIT $12 OFFSET $13
  $q$, val, p_stat)
  USING p_stat, p_league, p_season, p_position, p_nationality, p_min_age, p_max_age, p_min_minutes, p_per90, p_gender, p_abroad, least(p_limit, 200), p_offset;
END $function$;


-- The (competition, season, club) rows of one player that cannot be right (same rule as above).
CREATE OR REPLACE FUNCTION public.pro_implausible_seasons(p_player integer)
 RETURNS TABLE(league_id integer, season integer, team_id integer)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT s.league_id, s.season, s.team_id
  FROM public.pro_player_season_stats s
  CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM public.pro_fixtures f
    WHERE f.league_id = s.league_id AND f.season = s.season AND s.team_id IN (f.home_team_id, f.away_team_id)) fx
  WHERE s.player_id = p_player AND s.source = 'provider' AND s.apps > 2 AND fx.n > 0 AND s.apps > fx.n + 2
$$;
GRANT EXECUTE ON FUNCTION public.pro_implausible_seasons(integer) TO service_role;
