-- International (2026-10-12, Evan: "a new international tab ... so pro doesnt get confusing"): national-team football
-- gets its own section of the site, Pro is club football only.
--   pro_leagues.scope         'club' (Pro) or 'intl' (International). Set by the catalog from leagueScope() in
--                             src/sources/apiFootball/leagues.ts; backfilled here from the same list.
--   pro_leagues.level         'senior' or 'youth' (the International section's switch).
--   pro_leagues.confederation FIFA / UEFA / CONMEBOL / CONCACAF / CAF / AFC / OFC / Other, international ones only.
--   pro_teams.intl            a national team: a side flagged national by the provider or seen in an international
--                             competition, that never plays club football. The provider's flag is wrong both ways
--                             (missing on half the Pacific sides, set on Konyaspor and Arsenal of Guadeloupe).
--                             pro_refresh_intl_teams() keeps it, daily in the intl-refresh job.
--   pro_leaders(p_scope, p_level), pro_search(p_scope): the same reads for either section. NULL = both (the old
--                             behaviour, so code from before this migration keeps working until the deploy).
--   pro_intl_audit()          competitions whose sides disagree with their scope, for the hub.
-- Additive: nothing the crawl or the live jobs read changes. Rollback: 159's pro_leaders / pro_search definitions;
-- DROP the columns and functions.

BEGIN;

ALTER TABLE public.pro_leagues ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'club';
ALTER TABLE public.pro_leagues ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'senior';
ALTER TABLE public.pro_leagues ADD COLUMN IF NOT EXISTS confederation text;
DO $$ BEGIN
  ALTER TABLE public.pro_leagues ADD CONSTRAINT pro_leagues_scope_check CHECK (scope IN ('club', 'intl'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.pro_leagues ADD CONSTRAINT pro_leagues_level_check CHECK (level IN ('senior', 'youth'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS pro_leagues_scope_idx ON public.pro_leagues(scope, priority) WHERE enabled;

-- The international competitions the provider lists today (generated from leagueScope/leagueLevel/leagueConfederation).
UPDATE public.pro_leagues l SET scope = 'intl', level = v.level, confederation = v.conf
  FROM (VALUES
  (1, 'senior', 'FIFA'), (4, 'senior', 'UEFA'), (5, 'senior', 'UEFA'), (6, 'senior', 'CAF'), (7, 'senior', 'AFC'), (8, 'senior', 'FIFA'),
  (9, 'senior', 'CONMEBOL'), (10, 'senior', 'FIFA'), (19, 'senior', 'CAF'), (21, 'senior', 'FIFA'), (22, 'senior', 'CONCACAF'), (23, 'senior', 'AFC'),
  (24, 'senior', 'AFC'), (25, 'senior', 'AFC'), (28, 'senior', 'AFC'), (29, 'senior', 'CAF'), (30, 'senior', 'AFC'), (31, 'senior', 'CONCACAF'),
  (32, 'senior', 'UEFA'), (33, 'senior', 'OFC'), (34, 'senior', 'CONMEBOL'), (35, 'senior', 'AFC'), (36, 'senior', 'CAF'), (37, 'senior', 'FIFA'),
  (38, 'youth', 'UEFA'), (480, 'senior', 'FIFA'), (490, 'youth', 'FIFA'), (493, 'youth', 'UEFA'), (524, 'senior', 'FIFA'), (532, 'youth', 'AFC'),
  (535, 'senior', 'CAF'), (536, 'senior', 'CONCACAF'), (537, 'youth', 'CONCACAF'), (538, 'youth', 'CAF'), (587, 'youth', 'FIFA'), (666, 'senior', 'FIFA'),
  (743, 'senior', 'UEFA'), (770, 'senior', 'OFC'), (771, 'youth', 'CAF'), (773, 'youth', 'CONMEBOL'), (803, 'senior', 'AFC'), (804, 'senior', 'CONCACAF'),
  (805, 'senior', 'CONCACAF'), (806, 'senior', 'OFC'), (807, 'senior', 'AFC'), (808, 'senior', 'CONCACAF'), (849, 'senior', 'UEFA'), (850, 'youth', 'UEFA'),
  (858, 'senior', 'CONCACAF'), (859, 'senior', 'CAF'), (860, 'senior', 'Other'), (880, 'senior', 'UEFA'), (881, 'youth', 'CONCACAF'), (882, 'youth', 'AFC'),
  (886, 'youth', 'UEFA'), (890, 'youth', 'Other'), (893, 'youth', 'UEFA'), (894, 'senior', 'AFC'), (897, 'senior', 'AFC'), (902, 'senior', 'Other'),
  (904, 'senior', 'CONCACAF'), (908, 'youth', 'AFC'), (911, 'senior', 'AFC'), (912, 'youth', 'CONCACAF'), (913, 'senior', 'FIFA'), (914, 'youth', 'Other'),
  (916, 'senior', 'AFC'), (918, 'youth', 'UEFA'), (919, 'senior', 'Other'), (920, 'youth', 'FIFA'), (921, 'youth', 'UEFA'), (922, 'senior', 'CAF'),
  (926, 'senior', 'CONMEBOL'), (927, 'senior', 'CONCACAF'), (928, 'youth', 'AFC'), (934, 'youth', 'Other'), (941, 'senior', 'Other'), (950, 'youth', 'FIFA'),
  (951, 'youth', 'CONMEBOL'), (952, 'youth', 'AFC'), (953, 'youth', 'CAF'), (960, 'senior', 'UEFA'), (963, 'youth', 'CONCACAF'), (965, 'youth', 'AFC'),
  (970, 'youth', 'CONMEBOL'), (973, 'youth', 'CAF'), (1001, 'youth', 'CONCACAF'), (1008, 'senior', 'AFC'), (1012, 'youth', 'AFC'), (1015, 'youth', 'CAF'),
  (1016, 'senior', 'CONCACAF'), (1038, 'senior', 'AFC'), (1040, 'senior', 'UEFA'), (1045, 'senior', 'CONCACAF'), (1046, 'senior', 'CONCACAF'), (1047, 'youth', 'CAF'),
  (1057, 'senior', 'CONCACAF'), (1060, 'youth', 'CONMEBOL'), (1066, 'youth', 'CONCACAF'), (1070, 'youth', 'AFC'), (1072, 'senior', 'CAF'), (1077, 'youth', 'AFC'),
  (1081, 'youth', 'CONMEBOL'), (1083, 'senior', 'UEFA'), (1085, 'youth', 'CONMEBOL'), (1101, 'youth', 'AFC'), (1102, 'youth', 'UEFA'), (1105, 'senior', 'FIFA'),
  (1122, 'youth', 'OFC'), (1153, 'youth', 'AFC'), (1159, 'youth', 'CAF'), (1161, 'youth', 'AFC'), (1163, 'senior', 'CAF'), (1169, 'senior', 'AFC'),
  (1188, 'senior', 'AFC'), (1189, 'senior', 'AFC'), (1206, 'senior', 'CONMEBOL'), (1207, 'senior', 'CONCACAF'), (1208, 'youth', 'AFC'), (1222, 'senior', 'FIFA'),
  (1237, 'senior', 'CONCACAF'), (1245, 'senior', 'AFC'), (1247, 'senior', 'AFC')
  ) AS v(id, level, conf)
 WHERE l.id = v.id AND (l.scope, l.level, l.confederation) IS DISTINCT FROM ('intl', v.level, v.conf);
UPDATE public.pro_leagues SET level = 'youth' WHERE scope = 'club' AND kind = 'youth' AND level <> 'youth';
-- National teams' friendlies are crawled (the catalog keeps them on from now: parse.ts).
UPDATE public.pro_leagues SET enabled = true WHERE scope = 'intl' AND kind = 'friendly' AND NOT enabled AND NOT enabled_locked AND current_season IS NOT NULL;

ALTER TABLE public.pro_teams ADD COLUMN IF NOT EXISTS intl boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS pro_teams_intl_idx ON public.pro_teams(display_name) WHERE intl;

CREATE OR REPLACE FUNCTION public.pro_refresh_intl_teams() RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public' SET statement_timeout TO '300s' AS $$
DECLARE n integer;
BEGIN
  WITH il AS (SELECT id FROM public.pro_leagues WHERE scope = 'intl'),
  -- Every side flagged national or seen in an international competition (its season's members, or a match).
  seen AS (
    SELECT team_id FROM public.pro_league_teams WHERE league_id IN (SELECT id FROM il)
    UNION SELECT home_team_id FROM public.pro_fixtures WHERE league_id IN (SELECT id FROM il)
    UNION SELECT away_team_id FROM public.pro_fixtures WHERE league_id IN (SELECT id FROM il)
    UNION SELECT id FROM public.pro_teams WHERE national
  ),
  -- ... that has never played club football.
  nat AS (
    SELECT s.team_id AS id FROM seen s
     WHERE NOT EXISTS (SELECT 1 FROM public.pro_league_teams lt JOIN public.pro_leagues l ON l.id = lt.league_id AND l.scope = 'club' WHERE lt.team_id = s.team_id)
       AND NOT EXISTS (SELECT 1 FROM public.pro_fixtures f JOIN public.pro_leagues l ON l.id = f.league_id AND l.scope = 'club' WHERE f.home_team_id = s.team_id)
       AND NOT EXISTS (SELECT 1 FROM public.pro_fixtures f JOIN public.pro_leagues l ON l.id = f.league_id AND l.scope = 'club' WHERE f.away_team_id = s.team_id)
  )
  UPDATE public.pro_teams t SET intl = (t.id IN (SELECT id FROM nat))
   WHERE t.intl IS DISTINCT FROM (t.id IN (SELECT id FROM nat));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pro_refresh_intl_teams() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_refresh_intl_teams() TO service_role;

-- Competitions whose sides disagree with their scope: an international one whose sides are mostly not national teams
-- (often only the provider's missing flag: the hub shows the share), or a world club competition mostly of national
-- teams (a competition the list should add).
CREATE OR REPLACE FUNCTION public.pro_intl_audit()
 RETURNS TABLE(league_id integer, name text, scope text, enabled boolean, teams integer, national_teams integer, share numeric)
 LANGUAGE sql STABLE SET search_path TO 'public' SET statement_timeout TO '30s'
AS $function$
  SELECT l.id, l.name, l.scope, l.enabled, count(DISTINCT lt.team_id)::int, count(DISTINCT lt.team_id) FILTER (WHERE t.national)::int,
    round(count(DISTINCT lt.team_id) FILTER (WHERE t.national)::numeric / nullif(count(DISTINCT lt.team_id), 0), 2)
  FROM public.pro_leagues l
  JOIN public.pro_league_teams lt ON lt.league_id = l.id
  JOIN public.pro_teams t ON t.id = lt.team_id
  WHERE l.country = 'World' OR l.scope = 'intl'
  GROUP BY l.id, l.name, l.scope, l.enabled
  HAVING (l.scope = 'intl' AND count(DISTINCT lt.team_id) FILTER (WHERE t.national)::numeric / nullif(count(DISTINCT lt.team_id), 0) < 0.5)
      OR (l.scope = 'club' AND count(DISTINCT lt.team_id) FILTER (WHERE t.national)::numeric / nullif(count(DISTINCT lt.team_id), 0) >= 0.5)
  ORDER BY l.scope, l.id
$function$;
REVOKE ALL ON FUNCTION public.pro_intl_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_intl_audit() TO service_role;

-- pro_leaders gains p_scope and p_level (159's body otherwise unchanged). A new argument list is a new function, so
-- the old one goes first; both inside this transaction, so no read sees neither.
DROP FUNCTION IF EXISTS public.pro_leaders(text, integer, integer, text, text, integer, integer, integer, boolean, text, text, integer, integer, text);
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
        AND ($15 IS NULL OR l.scope = $15)
        AND ($16 IS NULL OR l.level = $16)
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
  USING p_stat, p_league, p_season, p_position, p_nationality, p_min_age, p_max_age, p_min_minutes, p_per90, p_gender, p_abroad, least(p_limit, 200), p_offset, p_country, p_scope, p_level;
END $function$;
REVOKE ALL ON FUNCTION public.pro_leaders(text, integer, integer, text, text, integer, integer, integer, boolean, text, text, integer, integer, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_leaders(text, integer, integer, text, text, integer, integer, integer, boolean, text, text, integer, integer, text, text, text) TO service_role;

-- pro_search gains p_scope: Pro finds club competitions and clubs, International finds national-team competitions
-- and national teams; players are found in both (a player has a club career and an international one).
DROP FUNCTION IF EXISTS public.pro_search(text, integer);
CREATE OR REPLACE FUNCTION public.pro_search(p_q text, p_limit integer DEFAULT 8, p_scope text DEFAULT NULL)
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
     FROM public.pro_leagues l, q WHERE l.enabled AND (p_scope IS NULL OR l.scope = p_scope) AND (public.pro_fold(l.name) % q.t OR public.pro_fold(l.name) LIKE '%' || q.t || '%')
     ORDER BY public.pro_fold(l.name) = q.t DESC, public.pro_us_league(l.id, l.country) DESC, l.priority, similarity(public.pro_fold(l.name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'team', t.id::bigint, t.display_name, t.slug, t.country, t.logo, similarity(public.pro_fold(t.display_name), q.t)
     FROM public.pro_teams t, q WHERE (p_scope IS NULL OR t.intl = (p_scope = 'intl'))
       AND (public.pro_fold(t.display_name) % q.t OR public.pro_fold(t.display_name) LIKE q.t || '%' OR public.pro_fold(t.display_name) LIKE '% ' || q.t || '%')
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
REVOKE ALL ON FUNCTION public.pro_search(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_search(text, integer, text) TO service_role;

COMMIT;

-- Outside the transaction (it reads the big fixtures table once; about a minute): mark today's national teams.
SELECT public.pro_refresh_intl_teams();
