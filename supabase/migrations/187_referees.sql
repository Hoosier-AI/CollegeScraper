-- Referee stats (2026-10-15), pro and college, from data we already hold: no new source.
--   Pro: pro_fixtures.referee ("A. Taylor" or "Jan Benes, Czechia") on finished matches, the match's card, penalty and
--   VAR events (pro_fixture_events; shootout kicks left out) and fouls (pro_fixture_team_stats, both sides).
--   College: the official titled Referee in college_games.officials (Sidearm and Presto box scores), with cards,
--   fouls and penalty kicks from the box score's team stats (the game's source of truth first).
-- A pro referee is a name in one country: the country of the domestic league they work most (three or more matches
-- in a league's country make a separate identity, so two "J. Silva"s in Brazil and Portugal stay apart); matches in
-- international competitions go to the name's main country. Slugs: 'a-taylor-england', 'victor-borges'.
-- Both are materialized and refreshed by the daily pro-referees job (pro_refresh_referees, college_refresh_referees).
-- Rollback: DROP FUNCTION pro_referee_list, pro_referee_leagues, pro_referee, pro_match_referee, pro_refresh_referees, college_referee_list,
-- college_referee, college_game_referee, college_refresh_referees, referee_name, referee_slug; DROP MATERIALIZED VIEW
-- pro_referees, pro_referee_fixtures, college_referees, college_referee_games.

SET statement_timeout = 0;

-- A referee's name as written, tidied: spaces collapsed, a "Referee:" prefix dropped, ALL CAPS turned to Title Case;
-- null for placeholders (TBD, TBA, Unknown).
CREATE OR REPLACE FUNCTION public.referee_name(raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n IS NULL OR n !~ '[[:alpha:]]{2}' OR lower(n) IN ('tbd', 'tba', 'n/a', 'unknown', 'none', 'referee') THEN NULL
              WHEN n = upper(n) THEN initcap(n) ELSE n END
  FROM (SELECT nullif(btrim(regexp_replace(regexp_replace(coalesce(raw, ''), '\s+', ' ', 'g'), '^(referee|ref\.?)\s*:\s*', '', 'i')), '') AS n) x
$$;

CREATE OR REPLACE FUNCTION public.referee_slug(name text, country text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(trim(both '-' from regexp_replace(lower(public.unaccent(coalesce(name, '') || coalesce(' ' || country, ''))), '[^a-z0-9]+', '-', 'g')), '')
$$;

DROP MATERIALIZED VIEW IF EXISTS public.pro_referees;
DROP MATERIALIZED VIEW IF EXISTS public.pro_referee_fixtures;
CREATE MATERIALIZED VIEW public.pro_referee_fixtures AS
WITH base AS MATERIALIZED (
  SELECT f.id AS fixture_id, f.league_id, f.season, f.kickoff, f.home_team_id, f.away_team_id, f.home_goals, f.away_goals, l.gender,
         n.name, referee_slug(n.name, NULL) AS name_key,
         nullif(btrim(split_part(f.referee, ',', 2)), '') AS said_country,
         nullif(l.country, 'World') AS league_country
  FROM pro_fixtures f
  JOIN pro_leagues l ON l.id = f.league_id
  CROSS JOIN LATERAL (SELECT referee_name(split_part(f.referee, ',', 1)) AS name) n
  WHERE f.referee IS NOT NULL AND f.status = 'final' AND n.name IS NOT NULL
),
homes AS (SELECT name_key, league_country AS country, count(*) AS n FROM base WHERE league_country IS NOT NULL GROUP BY 1, 2),
top AS (SELECT DISTINCT ON (name_key) name_key, country FROM homes ORDER BY name_key, n DESC, country),
said AS (SELECT DISTINCT ON (name_key) name_key, said_country FROM base WHERE said_country IS NOT NULL GROUP BY 1, 2 ORDER BY name_key, count(*) DESC, said_country),
ident0 AS MATERIALIZED (
  SELECT b.fixture_id, b.name_key, coalesce(CASE WHEN h.n >= 3 THEN h.country END, t.country, s.said_country) AS country
  FROM base b
  LEFT JOIN homes h ON h.name_key = b.name_key AND h.country = b.league_country
  LEFT JOIN top t ON t.name_key = b.name_key
  LEFT JOIN said s ON s.name_key = b.name_key
),
-- The provider has written the same referee as "A. Taylor" in older seasons and "Anthony Taylor" in newer ones: an
-- initial-and-surname name joins the one full name in the same country it abbreviates (none or several: kept apart).
abbr AS (
  SELECT DISTINCT name_key, country, regexp_replace(name_key, '^([a-z])[a-z]+-', '\1-') AS short, name_key ~ '^[a-z]-' AS is_short FROM ident0
),
merge AS (
  SELECT s.name_key AS from_key, s.country, min(f.name_key) AS to_key
  FROM abbr s JOIN abbr f ON f.short = s.name_key AND f.country IS NOT DISTINCT FROM s.country AND NOT f.is_short
  WHERE s.is_short GROUP BY 1, 2 HAVING count(DISTINCT f.name_key) = 1
),
ident AS (
  SELECT i.fixture_id, i.country, coalesce(m.to_key, i.name_key) AS key
  FROM ident0 i LEFT JOIN merge m ON m.from_key = i.name_key AND m.country IS NOT DISTINCT FROM i.country
),
ev AS (
  SELECT e.fixture_id,
         count(*) FILTER (WHERE e.type = 'card' AND e.detail ILIKE 'yellow%') AS yellow,
         count(*) FILTER (WHERE e.type = 'card' AND (e.detail ILIKE 'red%' OR e.detail ILIKE 'second yellow%')) AS red,
         count(*) FILTER (WHERE e.type = 'goal' AND e.detail IN ('Penalty', 'Missed Penalty') AND coalesce(e.comments, '') !~* 'shootout') AS pens,
         count(*) FILTER (WHERE e.type = 'var') AS var
  FROM pro_fixture_events e
  WHERE e.type IN ('card', 'goal', 'var') AND e.fixture_id IN (SELECT fixture_id FROM base)
  GROUP BY 1
),
hasev AS (SELECT DISTINCT e.fixture_id FROM pro_fixture_events e WHERE e.fixture_id IN (SELECT fixture_id FROM base)),
ts AS (
  SELECT t.fixture_id, sum(t.fouls) AS fouls, count(t.fouls) AS sides
  FROM pro_fixture_team_stats t WHERE t.fixture_id IN (SELECT fixture_id FROM base) GROUP BY 1
)
SELECT b.fixture_id, b.league_id, b.season, b.kickoff, b.home_team_id, b.away_team_id, b.home_goals, b.away_goals, b.gender,
       b.name, b.name_key, i.country,
       i.key || coalesce('-' || referee_slug(i.country, NULL), '') AS slug,
       -- Cards, penalties and VAR only where the match has events at all (none means unknown, not zero).
       CASE WHEN x.fixture_id IS NOT NULL THEN coalesce(ev.yellow, 0)::int END AS yellow,
       CASE WHEN x.fixture_id IS NOT NULL THEN coalesce(ev.red, 0)::int END AS red,
       CASE WHEN x.fixture_id IS NOT NULL THEN coalesce(ev.pens, 0)::int END AS pens,
       CASE WHEN x.fixture_id IS NOT NULL THEN coalesce(ev.var, 0)::int END AS var,
       CASE WHEN ts.sides = 2 THEN ts.fouls::int END AS fouls
FROM base b
JOIN ident i USING (fixture_id)
LEFT JOIN hasev x USING (fixture_id)
LEFT JOIN ev USING (fixture_id)
LEFT JOIN ts USING (fixture_id);
CREATE UNIQUE INDEX pro_referee_fixtures_pk ON public.pro_referee_fixtures (fixture_id);
CREATE INDEX pro_referee_fixtures_slug_idx ON public.pro_referee_fixtures (slug, kickoff DESC);
CREATE INDEX pro_referee_fixtures_league_idx ON public.pro_referee_fixtures (league_id, season);

-- One row per referee with career totals (the every-season list reads these instead of summing every match).
-- The display name is the full one when the provider has written both forms.
CREATE MATERIALIZED VIEW public.pro_referees AS
SELECT slug, array_agg(DISTINCT name_key) AS name_keys,
       coalesce(mode() WITHIN GROUP (ORDER BY name) FILTER (WHERE name !~ '^\S\.\s'), mode() WITHIN GROUP (ORDER BY name)) AS name,
       min(country) AS country, mode() WITHIN GROUP (ORDER BY gender) AS gender, count(*)::int AS matches,
       min(kickoff) AS first_at, max(kickoff) AS last_at, mode() WITHIN GROUP (ORDER BY league_id) AS main_league,
       count(yellow) AS carded, coalesce(sum(yellow), 0) AS yellow, coalesce(sum(red), 0) AS red, coalesce(sum(pens), 0) AS pens,
       coalesce(sum(var), 0) AS var, count(fouls) AS fouled, coalesce(sum(fouls), 0) AS fouls,
       count(*) FILTER (WHERE home_goals > away_goals) AS home, count(*) FILTER (WHERE home_goals = away_goals) AS draws,
       count(*) FILTER (WHERE home_goals < away_goals) AS away, coalesce(sum(home_goals + away_goals), 0) AS goals
FROM public.pro_referee_fixtures GROUP BY slug;
CREATE UNIQUE INDEX pro_referees_pk ON public.pro_referees (slug);
CREATE INDEX pro_referees_keys_idx ON public.pro_referees USING gin (name_keys);
CREATE INDEX pro_referees_name_trgm ON public.pro_referees USING gin (name gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.pro_refresh_referees() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET statement_timeout TO '15min' AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY pro_referee_fixtures;
  REFRESH MATERIALIZED VIEW CONCURRENTLY pro_referees;
  ANALYZE pro_referee_fixtures;
  ANALYZE pro_referees;
  RETURN (SELECT count(*) FROM pro_referees);
END $$;

-- One row of referee numbers over a set of matches (shared by the list, the referee page and the match card).
-- Per-match numbers count only the matches that have them (cards need events, fouls need both sides' stats).
CREATE OR REPLACE FUNCTION public.referee_numbers(n numeric, carded numeric, yellow numeric, red numeric, pens numeric, var numeric, fouled numeric, fouls numeric, home numeric, draws numeric, away numeric, goals numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'matches', n,
    'yellow_pg', CASE WHEN carded > 0 THEN round(yellow::numeric / carded, 2) END,
    'red_pg', CASE WHEN carded > 0 THEN round(red::numeric / carded, 3) END,
    'cards_pg', CASE WHEN carded > 0 THEN round((yellow + red)::numeric / carded, 2) END,
    'pens_pg', CASE WHEN carded > 0 THEN round(pens::numeric / carded, 3) END,
    'var_pg', CASE WHEN carded > 0 THEN round(var::numeric / carded, 2) END,
    'fouls_pg', CASE WHEN fouled > 0 THEN round(fouls::numeric / fouled, 1) END,
    'home_pct', CASE WHEN n > 0 THEN round(home::numeric / n, 3) END,
    'draw_pct', CASE WHEN n > 0 THEN round(draws::numeric / n, 3) END,
    'away_pct', CASE WHEN n > 0 THEN round(away::numeric / n, 3) END,
    'goals_pg', CASE WHEN n > 0 THEN round(goals::numeric / n, 2) END,
    'with_events', carded, 'with_fouls', fouled)
$$;

-- Referees with at least p_min matches in the chosen set, sorted and paged: every competition or one, this season
-- (each competition's current one), one season or every season we hold. Also the average over the whole set.
CREATE OR REPLACE FUNCTION public.pro_referee_list(p_gender text DEFAULT NULL, p_league integer DEFAULT NULL, p_season integer DEFAULT NULL,
  p_current boolean DEFAULT true, p_q text DEFAULT NULL, p_min integer DEFAULT 5, p_sort text DEFAULT 'matches', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout TO '20s' AS $$
  WITH career AS (SELECT p_league IS NULL AND p_season IS NULL AND NOT coalesce(p_current, false) AS all_time),
  f AS MATERIALIZED (
    SELECT r.* FROM pro_referee_fixtures r JOIN pro_leagues l ON l.id = r.league_id
    WHERE NOT (SELECT all_time FROM career)
      AND (p_gender IS NULL OR r.gender = p_gender)
      AND (p_league IS NULL OR r.league_id = p_league)
      AND (p_season IS NULL OR r.season = p_season)
      AND (NOT coalesce(p_current, false) OR p_season IS NOT NULL OR r.season = l.current_season)
  ),
  agg AS (
    SELECT slug, count(*) AS n, count(yellow) AS carded, coalesce(sum(yellow), 0) AS yellow, coalesce(sum(red), 0) AS red, coalesce(sum(pens), 0) AS pens,
           coalesce(sum(var), 0) AS var, count(fouls) AS fouled, coalesce(sum(fouls), 0) AS fouls,
           count(*) FILTER (WHERE home_goals > away_goals) AS home, count(*) FILTER (WHERE home_goals = away_goals) AS draws,
           count(*) FILTER (WHERE home_goals < away_goals) AS away, coalesce(sum(home_goals + away_goals), 0) AS goals, max(kickoff) AS last_at,
           mode() WITHIN GROUP (ORDER BY league_id) AS main_league
    FROM f GROUP BY slug
    UNION ALL
    -- Every season, every competition: the totals already on pro_referees (gender by where they work most).
    SELECT slug, matches, carded, yellow, red, pens, var, fouled, fouls, home, draws, away, goals, last_at, main_league
    FROM pro_referees WHERE (SELECT all_time FROM career) AND (p_gender IS NULL OR gender = p_gender)
  ),
  rows AS (
    SELECT r.slug, r.name, r.country, a.last_at, a.main_league,
           referee_numbers(a.n, a.carded, a.yellow, a.red, a.pens, a.var, a.fouled, a.fouls, a.home, a.draws, a.away, a.goals) AS num
    FROM agg a JOIN pro_referees r USING (slug)
    WHERE a.n >= greatest(1, coalesce(p_min, 5)) AND (p_q IS NULL OR r.name ILIKE '%' || p_q || '%')
  ),
  total AS (SELECT sum(1) AS n, sum(n) AS m, sum(carded) AS carded, sum(yellow) AS yellow, sum(red) AS red, sum(pens) AS pens, sum(var) AS var,
                   sum(fouled) AS fouled, sum(fouls) AS fouls, sum(home) AS home, sum(draws) AS draws, sum(away) AS away, sum(goals) AS goals FROM agg)
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM rows),
    'average', (SELECT referee_numbers(m, carded, yellow, red, pens, var, fouled, fouls, home, draws, away, goals) FROM total),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'country', country, 'last_at', last_at, 'main_league', main_league) || num ORDER BY ord) FROM (
      SELECT *, row_number() OVER (ORDER BY
        CASE WHEN p_sort = 'name' THEN name END ASC,
        CASE WHEN p_sort IN ('matches', 'yellow_pg', 'red_pg', 'cards_pg', 'pens_pg', 'var_pg', 'fouls_pg', 'home_pct', 'goals_pg') THEN (num ->> p_sort)::numeric END DESC NULLS LAST,
        (num ->> 'matches')::int DESC, slug) AS ord
      FROM rows ORDER BY ord OFFSET greatest(0, p_offset) LIMIT least(greatest(1, p_limit), 200)) x), '[]'))
$$;

-- The competitions with referee data in their current season (ten matches or more), most important first: the
-- list page's filter.
CREATE OR REPLACE FUNCTION public.pro_referee_leagues(p_gender text DEFAULT NULL) RETURNS TABLE(league_id integer, matches bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout TO '10s' AS $$
  SELECT r.league_id, count(*) FROM pro_referee_fixtures r JOIN pro_leagues l ON l.id = r.league_id AND r.season = l.current_season
  WHERE p_gender IS NULL OR r.gender = p_gender
  GROUP BY r.league_id HAVING count(*) >= 10 ORDER BY min(l.priority), count(*) DESC
$$;

-- One referee's page: career numbers, each competition and season, the averages of those competition seasons (to
-- compare), the last 30 matches and the clubs they have refereed most (with each club's record).
CREATE OR REPLACE FUNCTION public.pro_referee(p_slug text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public SET statement_timeout TO '20s' AS $$
  WITH me AS (SELECT * FROM pro_referee_fixtures WHERE slug = p_slug),
  seasons AS (
    SELECT league_id, season, count(*) AS n, count(yellow) AS carded, coalesce(sum(yellow), 0) AS yellow, coalesce(sum(red), 0) AS red, coalesce(sum(pens), 0) AS pens,
           coalesce(sum(var), 0) AS var, count(fouls) AS fouled, coalesce(sum(fouls), 0) AS fouls,
           count(*) FILTER (WHERE home_goals > away_goals) AS home, count(*) FILTER (WHERE home_goals = away_goals) AS draws,
           count(*) FILTER (WHERE home_goals < away_goals) AS away, coalesce(sum(home_goals + away_goals), 0) AS goals, max(kickoff) AS last_at
    FROM me GROUP BY 1, 2
  ),
  avgs AS (
    SELECT a.league_id, a.season, count(*) AS n, count(a.yellow) AS carded, coalesce(sum(a.yellow), 0) AS yellow, coalesce(sum(a.red), 0) AS red, coalesce(sum(a.pens), 0) AS pens,
           coalesce(sum(a.var), 0) AS var, count(a.fouls) AS fouled, coalesce(sum(a.fouls), 0) AS fouls,
           count(*) FILTER (WHERE a.home_goals > a.away_goals) AS home, count(*) FILTER (WHERE a.home_goals = a.away_goals) AS draws,
           count(*) FILTER (WHERE a.home_goals < a.away_goals) AS away, coalesce(sum(a.home_goals + a.away_goals), 0) AS goals
    FROM pro_referee_fixtures a JOIN seasons s ON s.league_id = a.league_id AND s.season = a.season GROUP BY 1, 2
  ),
  -- The same competition seasons weighted by this referee's matches in each: what an average referee would show
  -- given the same mix of matches.
  peer AS (
    SELECT sum(s.n * a.yellow::numeric / nullif(a.carded, 0)) / nullif(sum(s.n) FILTER (WHERE a.carded > 0), 0) AS yellow_pg,
           sum(s.n * a.red::numeric / nullif(a.carded, 0)) / nullif(sum(s.n) FILTER (WHERE a.carded > 0), 0) AS red_pg,
           sum(s.n * (a.yellow + a.red)::numeric / nullif(a.carded, 0)) / nullif(sum(s.n) FILTER (WHERE a.carded > 0), 0) AS cards_pg,
           sum(s.n * a.pens::numeric / nullif(a.carded, 0)) / nullif(sum(s.n) FILTER (WHERE a.carded > 0), 0) AS pens_pg,
           sum(s.n * a.var::numeric / nullif(a.carded, 0)) / nullif(sum(s.n) FILTER (WHERE a.carded > 0), 0) AS var_pg,
           sum(s.n * a.fouls::numeric / nullif(a.fouled, 0)) / nullif(sum(s.n) FILTER (WHERE a.fouled > 0), 0) AS fouls_pg,
           sum(s.n * a.home::numeric / a.n) / sum(s.n) AS home_pct,
           sum(s.n * a.goals::numeric / a.n) / sum(s.n) AS goals_pg
    FROM seasons s JOIN avgs a USING (league_id, season)
  ),
  clubs AS (
    SELECT team_id, count(*) AS n, count(*) FILTER (WHERE gf > ga) AS w, count(*) FILTER (WHERE gf = ga) AS d, count(*) FILTER (WHERE gf < ga) AS l
    FROM (SELECT home_team_id AS team_id, home_goals AS gf, away_goals AS ga FROM me UNION ALL SELECT away_team_id, away_goals, home_goals FROM me) x
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM me) THEN NULL ELSE jsonb_build_object(
    'referee', (SELECT jsonb_build_object('slug', r.slug, 'name', r.name, 'country', r.country, 'gender', r.gender, 'first_at', r.first_at, 'last_at', r.last_at) FROM pro_referees r WHERE r.slug = p_slug),
    'career', (SELECT referee_numbers(sum(n), sum(carded), sum(yellow), sum(red), sum(pens), sum(var), sum(fouled), sum(fouls), sum(home), sum(draws), sum(away), sum(goals))::jsonb FROM seasons),
    'peer', (SELECT jsonb_build_object('yellow_pg', round(yellow_pg, 2), 'red_pg', round(red_pg, 3), 'cards_pg', round(cards_pg, 2), 'pens_pg', round(pens_pg, 3), 'var_pg', round(var_pg, 2),
                                       'fouls_pg', round(fouls_pg, 1), 'home_pct', round(home_pct, 3), 'goals_pg', round(goals_pg, 2)) FROM peer),
    'seasons', (SELECT jsonb_agg(jsonb_build_object('league_id', s.league_id, 'season', s.season, 'last_at', s.last_at)
                  || referee_numbers(s.n, s.carded, s.yellow, s.red, s.pens, s.var, s.fouled, s.fouls, s.home, s.draws, s.away, s.goals)
                  || jsonb_build_object('average', referee_numbers(a.n, a.carded, a.yellow, a.red, a.pens, a.var, a.fouled, a.fouls, a.home, a.draws, a.away, a.goals))
                  ORDER BY s.season DESC, s.n DESC) FROM seasons s JOIN avgs a USING (league_id, season)),
    'recent', (SELECT jsonb_agg(jsonb_build_object('fixture_id', fixture_id, 'kickoff', kickoff, 'league_id', league_id, 'season', season, 'home_team_id', home_team_id,
                  'away_team_id', away_team_id, 'home_goals', home_goals, 'away_goals', away_goals, 'yellow', yellow, 'red', red, 'pens', pens, 'fouls', fouls) ORDER BY kickoff DESC)
               FROM (SELECT * FROM me ORDER BY kickoff DESC LIMIT 30) x),
    'clubs', (SELECT jsonb_agg(jsonb_build_object('team_id', team_id, 'matches', n, 'w', w, 'd', d, 'l', l) ORDER BY n DESC, team_id) FROM clubs)
  ) END
$$;

-- The referee card on a match page (upcoming, live or finished): the referee's numbers this season in this
-- competition and over their career, with the competition's average this season.
CREATE OR REPLACE FUNCTION public.pro_match_referee(p_fixture bigint) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public SET statement_timeout TO '10s' AS $$
  WITH fx AS (
    SELECT f.id, f.league_id, f.season, referee_slug(referee_name(split_part(f.referee, ',', 1)), NULL) AS key, nullif(l.country, 'World') AS lc
    FROM pro_fixtures f JOIN pro_leagues l ON l.id = f.league_id WHERE f.id = p_fixture AND f.referee IS NOT NULL
  ),
  pick AS (
    SELECT r.slug, r.name, r.country, r.matches FROM pro_referees r JOIN fx ON r.name_keys @> ARRAY[fx.key]
    ORDER BY (r.country IS NOT DISTINCT FROM fx.lc) DESC, r.matches DESC LIMIT 1
  ),
  agg AS (
    SELECT g.k, count(*) AS n, count(yellow) AS carded, coalesce(sum(yellow), 0) AS yellow, coalesce(sum(red), 0) AS red, coalesce(sum(pens), 0) AS pens,
           coalesce(sum(var), 0) AS var, count(fouls) AS fouled, coalesce(sum(fouls), 0) AS fouls,
           count(*) FILTER (WHERE home_goals > away_goals) AS home, count(*) FILTER (WHERE home_goals = away_goals) AS draws,
           count(*) FILTER (WHERE home_goals < away_goals) AS away, coalesce(sum(home_goals + away_goals), 0) AS goals
    FROM pro_referee_fixtures r CROSS JOIN fx CROSS JOIN pick
    CROSS JOIN LATERAL (VALUES
      (CASE WHEN r.slug = pick.slug THEN 'career' END),
      (CASE WHEN r.slug = pick.slug AND r.league_id = fx.league_id AND r.season = fx.season THEN 'season' END),
      (CASE WHEN r.league_id = fx.league_id AND r.season = fx.season THEN 'average' END)) g(k)
    WHERE g.k IS NOT NULL AND (r.slug = pick.slug OR (r.league_id = fx.league_id AND r.season = fx.season))
    GROUP BY g.k
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pick) THEN NULL ELSE jsonb_build_object(
    'slug', (SELECT slug FROM pick), 'name', (SELECT name FROM pick), 'country', (SELECT country FROM pick),
    'career', (SELECT referee_numbers(n, carded, yellow, red, pens, var, fouled, fouls, home, draws, away, goals) FROM agg WHERE k = 'career'),
    'season', (SELECT referee_numbers(n, carded, yellow, red, pens, var, fouled, fouls, home, draws, away, goals) FROM agg WHERE k = 'season'),
    'average', (SELECT referee_numbers(n, carded, yellow, red, pens, var, fouled, fouls, home, draws, away, goals) FROM agg WHERE k = 'average')
  ) END
$$;

-- College -----------------------------------------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS public.college_referees;
DROP MATERIALIZED VIEW IF EXISTS public.college_referee_games;
CREATE MATERIALIZED VIEW public.college_referee_games AS
WITH base AS MATERIALIZED (
  SELECT g.id AS game_id, g.season, g.gender, g.division, g.game_date, g.home_program_id, g.away_program_id, g.home_score, g.away_score,
         coalesce(g.neutral_site, false) AS neutral, g.source_of_truth, referee_name(x.name) AS name
  FROM college_games g
  CROSS JOIN LATERAL (
    SELECT o ->> 'name' AS name FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.officials) = 'array' THEN g.officials ELSE '[]'::jsonb END) o
    WHERE (o ->> 'title') ~* '^\s*(head\s+)?referee\s*$' LIMIT 1) x
  WHERE g.status = 'final' AND g.officials IS NOT NULL AND g.home_score IS NOT NULL
),
st AS (
  SELECT DISTINCT ON (s.game_id, s.program_id) s.game_id, s.program_id, s.fouls, s.yellow_cards, s.red_cards, s.pk_attempts
  FROM college_game_team_stats s JOIN base b ON b.game_id = s.game_id
  ORDER BY s.game_id, s.program_id, (s.source = b.source_of_truth) DESC, (s.source = 'site') DESC
),
agg AS (
  SELECT game_id, count(*) FILTER (WHERE yellow_cards IS NOT NULL) AS y_n, sum(yellow_cards) AS yellow, sum(red_cards) AS red,
         count(*) FILTER (WHERE fouls IS NOT NULL) AS f_n, sum(fouls) AS fouls, count(*) FILTER (WHERE pk_attempts IS NOT NULL) AS p_n, sum(pk_attempts) AS pens
  FROM st GROUP BY 1
)
SELECT b.game_id, b.season, b.gender, b.division, b.game_date, b.home_program_id, b.away_program_id, b.home_score, b.away_score, b.neutral,
       b.name, referee_slug(b.name, NULL) AS slug,
       CASE WHEN a.y_n = 2 THEN a.yellow::int END AS yellow, CASE WHEN a.y_n = 2 THEN coalesce(a.red, 0)::int END AS red,
       CASE WHEN a.f_n = 2 THEN a.fouls::int END AS fouls, CASE WHEN a.p_n = 2 THEN a.pens::int END AS pens
FROM base b LEFT JOIN agg a USING (game_id)
WHERE b.name IS NOT NULL AND referee_slug(b.name, NULL) IS NOT NULL;
CREATE UNIQUE INDEX college_referee_games_pk ON public.college_referee_games (game_id);
CREATE INDEX college_referee_games_slug_idx ON public.college_referee_games (slug, game_date DESC);
CREATE INDEX college_referee_games_season_idx ON public.college_referee_games (season, gender, division);

CREATE MATERIALIZED VIEW public.college_referees AS
SELECT slug, mode() WITHIN GROUP (ORDER BY name) AS name, count(*)::int AS games, min(game_date) AS first_date, max(game_date) AS last_date,
       array_agg(DISTINCT division ORDER BY division) AS divisions, array_agg(DISTINCT gender ORDER BY gender) AS genders
FROM public.college_referee_games GROUP BY slug;
CREATE UNIQUE INDEX college_referees_pk ON public.college_referees (slug);
CREATE INDEX college_referees_name_trgm ON public.college_referees USING gin (name gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.college_refresh_referees() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET statement_timeout TO '10min' AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY college_referee_games;
  REFRESH MATERIALIZED VIEW CONCURRENTLY college_referees;
  ANALYZE college_referee_games;
  ANALYZE college_referees;
  RETURN (SELECT count(*) FROM college_referees);
END $$;

-- College per-game numbers: home win share leaves out neutral-site games.
CREATE OR REPLACE FUNCTION public.college_referee_numbers(n numeric, carded numeric, yellow numeric, red numeric, fouled numeric, fouls numeric, pked numeric, pens numeric, homed numeric, home numeric, draws numeric, goals numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'games', n,
    'yellow_pg', CASE WHEN carded > 0 THEN round(yellow::numeric / carded, 2) END,
    'red_pg', CASE WHEN carded > 0 THEN round(red::numeric / carded, 3) END,
    'cards_pg', CASE WHEN carded > 0 THEN round((yellow + red)::numeric / carded, 2) END,
    'fouls_pg', CASE WHEN fouled > 0 THEN round(fouls::numeric / fouled, 1) END,
    'pens_pg', CASE WHEN pked > 0 THEN round(pens::numeric / pked, 3) END,
    'home_pct', CASE WHEN homed > 0 THEN round(home::numeric / homed, 3) END,
    'draw_pct', CASE WHEN n > 0 THEN round(draws::numeric / n, 3) END,
    'goals_pg', CASE WHEN n > 0 THEN round(goals::numeric / n, 2) END,
    'with_cards', carded, 'with_fouls', fouled)
$$;

CREATE OR REPLACE FUNCTION public.college_referee_list(p_season integer DEFAULT NULL, p_gender text DEFAULT NULL, p_division text DEFAULT NULL, p_q text DEFAULT NULL,
  p_min integer DEFAULT 5, p_sort text DEFAULT 'games', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout TO '20s' AS $$
  WITH f AS MATERIALIZED (
    SELECT * FROM college_referee_games
    WHERE (p_season IS NULL OR season = p_season) AND (p_gender IS NULL OR gender = p_gender) AND (p_division IS NULL OR division = p_division)
  ),
  agg AS (
    SELECT slug, count(*) AS n, count(yellow) AS carded, coalesce(sum(yellow), 0) AS yellow, coalesce(sum(red), 0) AS red,
           count(fouls) AS fouled, coalesce(sum(fouls), 0) AS fouls, count(pens) AS pked, coalesce(sum(pens), 0) AS pens,
           count(*) FILTER (WHERE NOT neutral) AS homed, count(*) FILTER (WHERE NOT neutral AND home_score > away_score) AS home,
           count(*) FILTER (WHERE home_score = away_score) AS draws, coalesce(sum(home_score + away_score), 0) AS goals, max(game_date) AS last_date,
           mode() WITHIN GROUP (ORDER BY division) AS division
    FROM f GROUP BY slug
  ),
  rows AS (
    SELECT r.slug, r.name, a.last_date, a.division,
           college_referee_numbers(a.n, a.carded, a.yellow, a.red, a.fouled, a.fouls, a.pked, a.pens, a.homed, a.home, a.draws, a.goals) AS num
    FROM agg a JOIN college_referees r USING (slug)
    WHERE a.n >= greatest(1, coalesce(p_min, 5)) AND (p_q IS NULL OR r.name ILIKE '%' || p_q || '%')
  ),
  total AS (SELECT sum(n) AS n, sum(carded) AS carded, sum(yellow) AS yellow, sum(red) AS red, sum(fouled) AS fouled, sum(fouls) AS fouls, sum(pked) AS pked,
                   sum(pens) AS pens, sum(homed) AS homed, sum(home) AS home, sum(draws) AS draws, sum(goals) AS goals, count(*) AS refs FROM agg)
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM rows),
    'referees', (SELECT refs FROM total),
    'average', (SELECT college_referee_numbers(n, carded, yellow, red, fouled, fouls, pked, pens, homed, home, draws, goals) FROM total),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'last_date', last_date, 'division', division) || num ORDER BY ord) FROM (
      SELECT *, row_number() OVER (ORDER BY
        CASE WHEN p_sort = 'name' THEN name END ASC,
        CASE WHEN p_sort IN ('games', 'yellow_pg', 'red_pg', 'cards_pg', 'fouls_pg', 'pens_pg', 'home_pct', 'goals_pg') THEN (num ->> p_sort)::numeric END DESC NULLS LAST,
        (num ->> 'games')::int DESC, slug) AS ord
      FROM rows ORDER BY ord OFFSET greatest(0, p_offset) LIMIT least(greatest(1, p_limit), 200)) x), '[]'))
$$;

CREATE OR REPLACE FUNCTION public.college_referee(p_slug text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public SET statement_timeout TO '20s' AS $$
  WITH me AS (SELECT * FROM college_referee_games WHERE slug = p_slug),
  seasons AS (
    SELECT season, gender, division, count(*) AS n, count(yellow) AS carded, coalesce(sum(yellow), 0) AS yellow, coalesce(sum(red), 0) AS red,
           count(fouls) AS fouled, coalesce(sum(fouls), 0) AS fouls, count(pens) AS pked, coalesce(sum(pens), 0) AS pens,
           count(*) FILTER (WHERE NOT neutral) AS homed, count(*) FILTER (WHERE NOT neutral AND home_score > away_score) AS home,
           count(*) FILTER (WHERE home_score = away_score) AS draws, coalesce(sum(home_score + away_score), 0) AS goals
    FROM me GROUP BY 1, 2, 3
  ),
  avgs AS (
    SELECT a.season, a.gender, a.division, count(*) AS n, count(a.yellow) AS carded, coalesce(sum(a.yellow), 0) AS yellow, coalesce(sum(a.red), 0) AS red,
           count(a.fouls) AS fouled, coalesce(sum(a.fouls), 0) AS fouls, count(a.pens) AS pked, coalesce(sum(a.pens), 0) AS pens,
           count(*) FILTER (WHERE NOT a.neutral) AS homed, count(*) FILTER (WHERE NOT a.neutral AND a.home_score > a.away_score) AS home,
           count(*) FILTER (WHERE a.home_score = a.away_score) AS draws, coalesce(sum(a.home_score + a.away_score), 0) AS goals
    FROM college_referee_games a JOIN seasons s USING (season, gender, division) GROUP BY 1, 2, 3
  ),
  peer AS (
    SELECT sum(s.n * (a.yellow + a.red)::numeric / nullif(a.carded, 0)) / nullif(sum(s.n) FILTER (WHERE a.carded > 0), 0) AS cards_pg,
           sum(s.n * a.yellow::numeric / nullif(a.carded, 0)) / nullif(sum(s.n) FILTER (WHERE a.carded > 0), 0) AS yellow_pg,
           sum(s.n * a.red::numeric / nullif(a.carded, 0)) / nullif(sum(s.n) FILTER (WHERE a.carded > 0), 0) AS red_pg,
           sum(s.n * a.fouls::numeric / nullif(a.fouled, 0)) / nullif(sum(s.n) FILTER (WHERE a.fouled > 0), 0) AS fouls_pg,
           sum(s.n * a.pens::numeric / nullif(a.pked, 0)) / nullif(sum(s.n) FILTER (WHERE a.pked > 0), 0) AS pens_pg,
           sum(s.n * a.home::numeric / nullif(a.homed, 0)) / nullif(sum(s.n) FILTER (WHERE a.homed > 0), 0) AS home_pct,
           sum(s.n * a.goals::numeric / a.n) / sum(s.n) AS goals_pg
    FROM seasons s JOIN avgs a USING (season, gender, division)
  ),
  teams AS (
    SELECT program_id, count(*) AS n, count(*) FILTER (WHERE gf > ga) AS w, count(*) FILTER (WHERE gf = ga) AS d, count(*) FILTER (WHERE gf < ga) AS l
    FROM (SELECT home_program_id AS program_id, home_score AS gf, away_score AS ga FROM me UNION ALL SELECT away_program_id, away_score, home_score FROM me) x
    WHERE program_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM me) THEN NULL ELSE jsonb_build_object(
    'referee', (SELECT jsonb_build_object('slug', r.slug, 'name', r.name, 'divisions', r.divisions, 'genders', r.genders, 'first_date', r.first_date, 'last_date', r.last_date) FROM college_referees r WHERE r.slug = p_slug),
    'career', (SELECT college_referee_numbers(sum(n), sum(carded), sum(yellow), sum(red), sum(fouled), sum(fouls), sum(pked), sum(pens), sum(homed), sum(home), sum(draws), sum(goals)) FROM seasons),
    'peer', (SELECT jsonb_build_object('cards_pg', round(cards_pg, 2), 'yellow_pg', round(yellow_pg, 2), 'red_pg', round(red_pg, 3), 'fouls_pg', round(fouls_pg, 1),
                                       'pens_pg', round(pens_pg, 3), 'home_pct', round(home_pct, 3), 'goals_pg', round(goals_pg, 2)) FROM peer),
    'seasons', (SELECT jsonb_agg(jsonb_build_object('season', s.season, 'gender', s.gender, 'division', s.division)
                  || college_referee_numbers(s.n, s.carded, s.yellow, s.red, s.fouled, s.fouls, s.pked, s.pens, s.homed, s.home, s.draws, s.goals)
                  || jsonb_build_object('average', college_referee_numbers(a.n, a.carded, a.yellow, a.red, a.fouled, a.fouls, a.pked, a.pens, a.homed, a.home, a.draws, a.goals))
                  ORDER BY s.season DESC, s.n DESC) FROM seasons s JOIN avgs a USING (season, gender, division)),
    'recent', (SELECT jsonb_agg(jsonb_build_object('game_id', game_id, 'game_date', game_date, 'gender', gender, 'division', division, 'yellow', yellow, 'red', red, 'fouls', fouls, 'pens', pens) ORDER BY game_date DESC)
               FROM (SELECT * FROM me ORDER BY game_date DESC LIMIT 30) x),
    'teams', (SELECT jsonb_agg(jsonb_build_object('program_id', program_id, 'games', n, 'w', w, 'd', d, 'l', l) ORDER BY n DESC, program_id) FROM teams)
  ) END
$$;

-- The referee card on a college match page: the box score's referee, their numbers this season (same gender and
-- division) and in every game we hold, against the division's average this season. Null when the box score names
-- no referee we have numbers for.
CREATE OR REPLACE FUNCTION public.college_game_referee(p_game uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public SET statement_timeout TO '10s' AS $$
  WITH g AS (
    SELECT g.id, g.season, g.gender, g.division, referee_slug(referee_name(x.name), NULL) AS slug
    FROM college_games g
    CROSS JOIN LATERAL (
      SELECT o ->> 'name' AS name FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.officials) = 'array' THEN g.officials ELSE '[]'::jsonb END) o
      WHERE (o ->> 'title') ~* '^\s*(head\s+)?referee\s*$' LIMIT 1) x
    WHERE g.id = p_game
  ),
  agg AS (
    SELECT k.k, count(*) AS n, count(r.yellow) AS carded, coalesce(sum(r.yellow), 0) AS yellow, coalesce(sum(r.red), 0) AS red,
           count(r.fouls) AS fouled, coalesce(sum(r.fouls), 0) AS fouls, count(r.pens) AS pked, coalesce(sum(r.pens), 0) AS pens,
           count(*) FILTER (WHERE NOT r.neutral) AS homed, count(*) FILTER (WHERE NOT r.neutral AND r.home_score > r.away_score) AS home,
           count(*) FILTER (WHERE r.home_score = r.away_score) AS draws, coalesce(sum(r.home_score + r.away_score), 0) AS goals
    FROM college_referee_games r CROSS JOIN g
    CROSS JOIN LATERAL (VALUES
      (CASE WHEN r.slug = g.slug THEN 'career' END),
      (CASE WHEN r.slug = g.slug AND r.season = g.season AND r.gender = g.gender AND r.division = g.division THEN 'season' END),
      (CASE WHEN r.season = g.season AND r.gender = g.gender AND r.division = g.division THEN 'average' END)) k(k)
    WHERE k.k IS NOT NULL AND (r.slug = g.slug OR (r.season = g.season AND r.gender = g.gender AND r.division = g.division))
    GROUP BY k.k
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM agg WHERE k = 'career') THEN NULL ELSE jsonb_build_object(
    'slug', (SELECT slug FROM g), 'name', (SELECT name FROM college_referees WHERE slug = (SELECT slug FROM g)),
    'career', (SELECT college_referee_numbers(n, carded, yellow, red, fouled, fouls, pked, pens, homed, home, draws, goals) FROM agg WHERE k = 'career'),
    'season', (SELECT college_referee_numbers(n, carded, yellow, red, fouled, fouls, pked, pens, homed, home, draws, goals) FROM agg WHERE k = 'season'),
    'average', (SELECT college_referee_numbers(n, carded, yellow, red, fouled, fouls, pked, pens, homed, home, draws, goals) FROM agg WHERE k = 'average')
  ) END
$$;

REVOKE ALL ON public.pro_referee_fixtures, public.pro_referees, public.college_referee_games, public.college_referees FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pro_referee_fixtures, public.pro_referees, public.college_referee_games, public.college_referees TO service_role;
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['pro_refresh_referees()', 'pro_referee_leagues(text)', 'pro_referee_list(text, integer, integer, boolean, text, integer, text, integer, integer)', 'pro_referee(text)',
    'pro_match_referee(bigint)', 'college_refresh_referees()', 'college_referee_list(integer, text, text, text, integer, text, integer, integer)',
    'college_referee(text)', 'college_game_referee(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
