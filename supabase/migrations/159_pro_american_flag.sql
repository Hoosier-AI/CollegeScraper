-- Who counts as American, one rule everywhere (2026-10-12, Evan: "missing players in the Americans abroad").
-- The nationality field alone missed dual nationals the provider files under another country (Patrick Agyemang:
-- Ghana) and anyone it never gave a nationality. pro_players.american = nationality USA, or the player has played
-- for or been listed by a US national team at any level (USA, United States U23/U20/U17, men's and women's): with
-- another nationality, two US national-team matches or a US squad listing (one mis-filed lineup is not enough).
-- Refreshed by pro_refresh_americans() (the daily pro-rank job). Used by pro_leaders (nationality USA: the USA
-- country page, the player directory filter, the Americans-abroad leaders), the Americans-abroad lines and upcoming
-- matches, and search's US preference. Rollback: 158/156/155 definitions; ALTER TABLE ... DROP COLUMN american.

ALTER TABLE public.pro_players ADD COLUMN IF NOT EXISTS american boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.pro_refresh_americans() RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public' SET statement_timeout TO '300s' AS $$
DECLARE n integer;
BEGIN
  WITH nt AS (
    SELECT id FROM public.pro_teams
     WHERE national AND country = 'USA' AND (display_name = 'USA' OR display_name ILIKE 'United States%')
  ), caps AS (
    SELECT player_id, count(DISTINCT fixture_id) AS matches FROM public.pro_fixture_players
     WHERE team_id IN (SELECT id FROM nt) AND player_id IS NOT NULL GROUP BY player_id
  ), listed AS (SELECT DISTINCT player_id FROM public.pro_squads WHERE team_id IN (SELECT id FROM nt)),
  -- One lineup filed under the wrong side (Mexico's eleven under USA in a 2024 Mexico v USA) must not make a player
  -- American: another nationality needs two US national-team matches or a US squad listing.
  us AS (
    SELECT id FROM public.pro_players WHERE nationality = 'USA'
    UNION SELECT player_id FROM listed
    UNION SELECT player_id FROM caps WHERE matches >= 2
    UNION SELECT c.player_id FROM caps c JOIN public.pro_players p ON p.id = c.player_id WHERE p.nationality IS NULL
  )
  UPDATE public.pro_players p SET american = (p.id IN (SELECT id FROM us))
   WHERE p.american IS DISTINCT FROM (p.id IN (SELECT id FROM us));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pro_refresh_americans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_refresh_americans() TO service_role;

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
        AND ($5 IS NULL OR p.nationality = $5 OR ($5 = 'USA' AND p.american))
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

CREATE OR REPLACE FUNCTION public.pro_search(p_q text, p_limit integer DEFAULT 8)
 RETURNS TABLE(kind text, id bigint, name text, slug text, sub text, logo text, score real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH q AS (SELECT public.pro_fold(trim(p_q)) AS t),
  us_teams AS (
    SELECT DISTINCT lt.team_id FROM public.pro_league_teams lt JOIN public.pro_leagues l ON l.id = lt.league_id AND lt.season = l.current_season
     WHERE l.enabled AND public.pro_us_league(l.id, l.country)
  )
  (SELECT 'league', l.id::bigint, l.name, l.slug, l.country, l.logo, similarity(public.pro_fold(l.name), q.t)
     FROM public.pro_leagues l, q WHERE l.enabled AND (public.pro_fold(l.name) % q.t OR public.pro_fold(l.name) LIKE '%' || q.t || '%')
     ORDER BY public.pro_fold(l.name) = q.t DESC, public.pro_us_league(l.id, l.country) DESC, l.priority, similarity(public.pro_fold(l.name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'team', t.id::bigint, t.display_name, t.slug, t.country, t.logo, similarity(public.pro_fold(t.display_name), q.t)
     FROM public.pro_teams t, q WHERE public.pro_fold(t.display_name) % q.t OR public.pro_fold(t.display_name) LIKE q.t || '%' OR public.pro_fold(t.display_name) LIKE '% ' || q.t || '%'
     ORDER BY public.pro_fold(t.display_name) = q.t DESC, public.pro_fold(t.display_name) LIKE '%' || q.t || '%' DESC, EXISTS (SELECT 1 FROM us_teams u WHERE u.team_id = t.id) DESC,
       EXISTS (SELECT 1 FROM public.pro_league_teams lt WHERE lt.team_id = t.id) DESC,
       similarity(public.pro_fold(t.display_name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'player', p.id::bigint, p.display_name, p.slug, p.nationality, p.photo, similarity(public.pro_fold(p.display_name), q.t)
     FROM public.pro_players p, q WHERE NOT p.noindex AND (public.pro_fold(p.display_name) % q.t OR public.pro_fold(p.display_name) LIKE q.t || '%')
     ORDER BY public.pro_fold(p.display_name) = q.t DESC, public.pro_fold(p.display_name) LIKE '%' || q.t || '%' DESC, (p.minutes_recent > 0) DESC,
       (p.american OR EXISTS (SELECT 1 FROM us_teams u WHERE u.team_id = p.current_team_id)) DESC,
       similarity(public.pro_fold(p.display_name), q.t) DESC, p.minutes_recent DESC LIMIT p_limit)
$function$;

CREATE OR REPLACE FUNCTION public.pro_americans_abroad(p_days integer DEFAULT 7, p_limit integer DEFAULT 400)
 RETURNS TABLE(fixture_id bigint, player_id integer, team_id integer, league_id integer, gender text, minutes integer, goals integer, assists integer, rating numeric, starter boolean)
 LANGUAGE sql STABLE SET search_path TO 'public' SET statement_timeout TO '90s'
AS $function$
  -- From the week's finals to their American players (every one, not only those already marked active: a first
  -- match abroad counts the day it is played).
  SELECT fp.fixture_id, fp.player_id, fp.team_id, l.id, l.gender, fp.minutes::int, coalesce(fp.goals, 0)::int, coalesce(fp.assists, 0)::int, fp.rating, fp.starter
  FROM public.pro_fixtures f
  JOIN public.pro_leagues l ON l.id = f.league_id AND NOT public.pro_us_league(l.id, l.country)
  JOIN public.pro_fixture_players fp ON fp.fixture_id = f.id
  JOIN public.pro_players p ON p.id = fp.player_id AND p.american
  JOIN public.pro_teams t ON t.id = fp.team_id AND NOT t.national
  WHERE f.status = 'final' AND f.kickoff >= now() - make_interval(days => p_days) AND coalesce(fp.minutes, 0) > 0
  ORDER BY coalesce(fp.goals, 0) + coalesce(fp.assists, 0) DESC, l.priority, fp.minutes DESC, fp.rating DESC NULLS LAST
  LIMIT p_limit
$function$;

CREATE OR REPLACE FUNCTION public.pro_americans_upcoming(p_days integer DEFAULT 7)
 RETURNS TABLE(fixture_id bigint, team_id integer, gender text, player_ids integer[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH am AS (
    SELECT q.team_id, array_agg(p.id ORDER BY p.minutes_recent DESC) ids
    FROM public.pro_squads q JOIN public.pro_players p ON p.id = q.player_id AND p.american
    GROUP BY q.team_id
  )
  SELECT f.id, side.team_id, l.gender, am.ids
  FROM public.pro_fixtures f
  JOIN public.pro_leagues l ON l.id = f.league_id AND l.enabled AND NOT public.pro_us_league(l.id, l.country)
  CROSS JOIN LATERAL (VALUES (f.home_team_id), (f.away_team_id)) side(team_id)
  JOIN am ON am.team_id = side.team_id
  JOIN public.pro_teams t ON t.id = side.team_id AND NOT t.national
  WHERE f.status = 'scheduled' AND f.kickoff BETWEEN now() AND now() + make_interval(days => p_days)
$function$;

-- Run outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS pro_players_american_idx ON public.pro_players (minutes_recent DESC) WHERE american;
