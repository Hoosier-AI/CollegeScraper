-- The Pro side US-first (Evan, 2026-10-12: "most of our users will be from the US").
--   * pro_leaders gains p_country: only competitions in that country (Leaders and Players open on the US: MLS, NWSL,
--     USL and the leagues below). p_abroad keeps its meaning (outside that country: Americans abroad).
--   * pro_search puts the US first after an exact name: competitions in the USA or the ones US clubs play in, clubs in
--     a current US competition, players who are American or play for such a club ("Dallas": FC Dallas, Dallas Trinity).
-- Rollback: migration 152's pro_leaders (13 arguments) and 135's pro_search.

DROP FUNCTION IF EXISTS public.pro_leaders(text, integer, integer, text, text, integer, integer, integer, boolean, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.pro_leaders(p_stat text DEFAULT 'goals'::text, p_league integer DEFAULT NULL::integer, p_season integer DEFAULT NULL::integer, p_position text DEFAULT NULL::text, p_nationality text DEFAULT NULL::text, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_min_minutes integer DEFAULT 0, p_per90 boolean DEFAULT false, p_gender text DEFAULT NULL::text, p_abroad text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_country text DEFAULT NULL::text)
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
        AND ($14 IS NULL OR l.country = $14)
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
  USING p_stat, p_league, p_season, p_position, p_nationality, p_min_age, p_max_age, p_min_minutes, p_per90, p_gender, p_abroad, least(p_limit, 200), p_offset, p_country;
END $function$;
REVOKE ALL ON FUNCTION public.pro_leaders(text, integer, integer, text, text, integer, integer, integer, boolean, text, text, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_leaders(text, integer, integer, text, text, integer, integer, integer, boolean, text, text, integer, integer, text) TO service_role;

-- The US scene: competitions in the USA and the international ones US clubs play in (US_SCENE in
-- src/sources/apiFootball/leagues.ts: Leagues Cup, CONCACAF Champions Cup, CONCACAF W Champions Cup, Campeones Cup...).
CREATE OR REPLACE FUNCTION public.pro_us_league(p_id integer, p_country text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT p_country = 'USA' OR p_id = ANY (ARRAY[772, 16, 885, 1136, 15, 1186]) $$;

CREATE OR REPLACE FUNCTION public.pro_search(p_q text, p_limit integer DEFAULT 8)
 RETURNS TABLE(kind text, id bigint, name text, slug text, sub text, logo text, score real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH q AS (SELECT lower(trim(p_q)) AS t),
  us_teams AS (
    SELECT DISTINCT lt.team_id FROM public.pro_league_teams lt JOIN public.pro_leagues l ON l.id = lt.league_id AND lt.season = l.current_season
     WHERE l.enabled AND public.pro_us_league(l.id, l.country)
  )
  (SELECT 'league', l.id::bigint, l.name, l.slug, l.country, l.logo, similarity(lower(l.name), q.t)
     FROM public.pro_leagues l, q WHERE l.enabled AND (lower(l.name) % q.t OR lower(l.name) LIKE '%' || q.t || '%')
     ORDER BY lower(l.name) = q.t DESC, public.pro_us_league(l.id, l.country) DESC, l.priority, similarity(lower(l.name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'team', t.id::bigint, t.display_name, t.slug, t.country, t.logo, similarity(lower(t.display_name), q.t)
     FROM public.pro_teams t, q WHERE lower(t.display_name) % q.t OR lower(t.display_name) LIKE q.t || '%' OR lower(t.display_name) LIKE '% ' || q.t || '%'
     ORDER BY lower(t.display_name) = q.t DESC, EXISTS (SELECT 1 FROM us_teams u WHERE u.team_id = t.id) DESC,
       EXISTS (SELECT 1 FROM public.pro_league_teams lt WHERE lt.team_id = t.id) DESC,
       similarity(lower(t.display_name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'player', p.id::bigint, p.display_name, p.slug, p.nationality, p.photo, similarity(lower(p.display_name), q.t)
     FROM public.pro_players p, q WHERE NOT p.noindex AND (lower(p.display_name) % q.t OR lower(p.display_name) LIKE q.t || '%')
     ORDER BY lower(p.display_name) = q.t DESC, (p.minutes_recent > 0) DESC,
       (p.nationality = 'USA' OR EXISTS (SELECT 1 FROM us_teams u WHERE u.team_id = p.current_team_id)) DESC,
       similarity(lower(p.display_name), q.t) DESC, p.minutes_recent DESC LIMIT p_limit)
$function$;
REVOKE ALL ON FUNCTION public.pro_search(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_search(text, integer) TO service_role;

-- Search speed: pro_search compares lower(name), but the trigram indexes (134) are on the bare name, so every search
-- scanned all 664k players (2.6 s for "dallas"). Indexes on the lowered names; built CONCURRENTLY, so run these three
-- statements outside a transaction, one at a time.
CREATE INDEX CONCURRENTLY IF NOT EXISTS pro_players_lname_trgm ON public.pro_players USING gin (lower(display_name) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS pro_teams_lname_trgm ON public.pro_teams USING gin (lower(display_name) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS pro_leagues_lname_trgm ON public.pro_leagues USING gin (lower(name) gin_trgm_ops);
