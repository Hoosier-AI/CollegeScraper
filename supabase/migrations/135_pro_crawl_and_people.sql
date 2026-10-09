-- Plaibook Stats Pro v2: crawl every league, club and player, and the tables behind the richer pages.
--   pro_crawl_tasks         one row per unit of crawl work (kind + key), drained in priority order by pro-crawl
--   pro_countries           the provider's country list (country pages)
--   pro_league_teams        which clubs play in which league season (squad / transfer / coach tasks come from it)
--   pro_squads              each club's current squad
--   pro_transfers           transfers (names and crests inline: the clubs need not be in pro_teams)
--   pro_coaches / pro_coach_career
--   pro_trophies            players' and coaches' honours
--   pro_injuries            current injuries and suspensions, per league season
--   pro_player_season_stats gains the provider's season totals (source = 'provider'); our own totals from match lines
--                           stay as source = 'computed' and never overwrite a provider row
--   pro_players             gains current club, shirt number, recent minutes (search rank) and `indexable`
-- Re-runnable. Apply by hand like the others (see README.md).

BEGIN;

SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '10s';

-- ---------- the crawl queue ----------
CREATE TABLE IF NOT EXISTS public.pro_crawl_tasks (
  kind text NOT NULL,
  key text NOT NULL,
  priority integer NOT NULL DEFAULT 500,          -- lower first
  due_at timestamptz NOT NULL DEFAULT now(),       -- 'infinity' once a one-off task is done
  every_days numeric,                              -- refresh interval; null = once
  page integer NOT NULL DEFAULT 0,                 -- paged kinds: last page stored in the current pass
  pages integer,                                   -- paged kinds: total pages the provider last reported
  last_done_at timestamptz,
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0,                -- requests spent on this task, all time
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key)
);
CREATE INDEX IF NOT EXISTS pro_crawl_tasks_due_idx ON public.pro_crawl_tasks (priority, due_at);

-- ---------- reference ----------
CREATE TABLE IF NOT EXISTS public.pro_countries (
  name text PRIMARY KEY,
  code text,
  flag text,
  slug text GENERATED ALWAYS AS (public.college_slugify(name)) STORED
);
CREATE UNIQUE INDEX IF NOT EXISTS pro_countries_slug_key ON public.pro_countries(slug);

CREATE TABLE IF NOT EXISTS public.pro_league_teams (
  league_id integer NOT NULL,
  season integer NOT NULL,
  team_id integer NOT NULL,
  PRIMARY KEY (league_id, season, team_id)
);
CREATE INDEX IF NOT EXISTS pro_league_teams_team_idx ON public.pro_league_teams(team_id);

-- ---------- people ----------
CREATE TABLE IF NOT EXISTS public.pro_squads (
  team_id integer NOT NULL,
  player_id integer NOT NULL,
  number smallint,
  position text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, player_id)
);
CREATE INDEX IF NOT EXISTS pro_squads_player_idx ON public.pro_squads(player_id);
-- The squad pages join the player (the crawl creates the player row before the squad line).
DELETE FROM public.pro_squads s WHERE NOT EXISTS (SELECT 1 FROM public.pro_players p WHERE p.id = s.player_id);
DO $$ BEGIN
  ALTER TABLE public.pro_squads ADD CONSTRAINT pro_squads_player_fkey FOREIGN KEY (player_id) REFERENCES public.pro_players(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.pro_transfers (
  player_id integer NOT NULL,
  date date NOT NULL,
  from_team_id integer NOT NULL DEFAULT 0,
  to_team_id integer NOT NULL DEFAULT 0,
  type text,
  player_name text,
  from_name text, from_logo text,
  to_name text, to_logo text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, date, from_team_id, to_team_id)
);
CREATE INDEX IF NOT EXISTS pro_transfers_date_idx ON public.pro_transfers(date DESC);
CREATE INDEX IF NOT EXISTS pro_transfers_to_idx ON public.pro_transfers(to_team_id, date DESC);
CREATE INDEX IF NOT EXISTS pro_transfers_from_idx ON public.pro_transfers(from_team_id, date DESC);

CREATE TABLE IF NOT EXISTS public.pro_coaches (
  id integer PRIMARY KEY,
  name text NOT NULL,
  display_name text NOT NULL,
  first_name text, last_name text,
  birth_date date, birth_country text, nationality text,
  photo text,
  team_id integer,                                 -- the club the provider lists them under now
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pro_coaches_team_idx ON public.pro_coaches(team_id);

CREATE TABLE IF NOT EXISTS public.pro_coach_career (
  coach_id integer NOT NULL REFERENCES public.pro_coaches(id) ON DELETE CASCADE,
  team_id integer NOT NULL,
  start date NOT NULL DEFAULT '1900-01-01',
  "end" date,
  team_name text, team_logo text,
  PRIMARY KEY (coach_id, team_id, start)
);
CREATE INDEX IF NOT EXISTS pro_coach_career_team_idx ON public.pro_coach_career(team_id, start DESC);

CREATE TABLE IF NOT EXISTS public.pro_trophies (
  subject text NOT NULL CHECK (subject IN ('player','coach')),
  subject_id integer NOT NULL,
  league text NOT NULL,
  country text NOT NULL DEFAULT '',
  season text NOT NULL DEFAULT '',
  place text NOT NULL DEFAULT '',
  PRIMARY KEY (subject, subject_id, league, country, season, place)
);

CREATE TABLE IF NOT EXISTS public.pro_injuries (
  league_id integer NOT NULL,
  season integer NOT NULL,
  player_id integer NOT NULL,
  fixture_id bigint NOT NULL DEFAULT 0,
  team_id integer,
  type text,                                       -- Missing Fixture / Questionable
  reason text,
  date date,
  PRIMARY KEY (league_id, season, player_id, fixture_id)
);
CREATE INDEX IF NOT EXISTS pro_injuries_team_idx ON public.pro_injuries(team_id, date DESC);
CREATE INDEX IF NOT EXISTS pro_injuries_player_idx ON public.pro_injuries(player_id, date DESC);

ALTER TABLE public.pro_players ADD COLUMN IF NOT EXISTS current_team_id integer;
ALTER TABLE public.pro_players ADD COLUMN IF NOT EXISTS number smallint;
ALTER TABLE public.pro_players ADD COLUMN IF NOT EXISTS minutes_recent integer NOT NULL DEFAULT 0;
-- Has played in the last seasons or is in a squad: listed in sitemaps and indexable; the rest of the ~690k
-- profiles stay reachable but noindex.
ALTER TABLE public.pro_players ADD COLUMN IF NOT EXISTS indexable boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS pro_players_nationality_idx ON public.pro_players(nationality, minutes_recent DESC);
CREATE INDEX IF NOT EXISTS pro_players_birth_idx ON public.pro_players(birth_date);
CREATE INDEX IF NOT EXISTS pro_players_team_idx ON public.pro_players(current_team_id);
CREATE INDEX IF NOT EXISTS pro_players_indexable_idx ON public.pro_players(minutes_recent DESC) WHERE indexable AND NOT noindex;

-- ---------- provider season totals ----------
ALTER TABLE public.pro_player_season_stats ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'computed';
DO $$ BEGIN
  ALTER TABLE public.pro_player_season_stats ADD CONSTRAINT pro_player_season_stats_source_check CHECK (source IN ('computed','provider'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.pro_player_season_stats
  ADD COLUMN IF NOT EXISTS lineups integer,
  ADD COLUMN IF NOT EXISTS sub_in integer,
  ADD COLUMN IF NOT EXISTS sub_out integer,
  ADD COLUMN IF NOT EXISTS bench integer,
  ADD COLUMN IF NOT EXISTS captain boolean,
  ADD COLUMN IF NOT EXISTS number smallint,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS pass_accuracy integer,
  ADD COLUMN IF NOT EXISTS blocks integer,
  ADD COLUMN IF NOT EXISTS duels integer,
  ADD COLUMN IF NOT EXISTS dribbles integer,
  ADD COLUMN IF NOT EXISTS dribbled_past integer,
  ADD COLUMN IF NOT EXISTS fouls_drawn integer,
  ADD COLUMN IF NOT EXISTS fouls_committed integer,
  ADD COLUMN IF NOT EXISTS yellowred integer,
  ADD COLUMN IF NOT EXISTS pen_won integer,
  ADD COLUMN IF NOT EXISTS pen_committed integer,
  ADD COLUMN IF NOT EXISTS pen_missed integer,
  ADD COLUMN IF NOT EXISTS pen_saved integer;
CREATE INDEX IF NOT EXISTS pro_player_season_stats_player_idx ON public.pro_player_season_stats(player_id, season DESC);
CREATE INDEX IF NOT EXISTS pro_player_season_stats_season_idx ON public.pro_player_season_stats(season, minutes DESC);

-- Our own totals from stored match lines no longer replace the provider's: only 'computed' rows are rebuilt, and a
-- provider row for the same player, league, season and club wins.
CREATE OR REPLACE FUNCTION public.pro_refresh_season_aggregates(p_league integer, p_season integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(p_league, p_season);

  DELETE FROM public.pro_player_season_stats WHERE league_id = p_league AND season = p_season AND source = 'computed';
  INSERT INTO public.pro_player_season_stats (player_id, league_id, season, team_id, apps, starts, minutes, goals, assists,
    shots, shots_on, key_passes, passes, tackles, interceptions, duels_won, dribbles_won, yellow, red, saves, conceded,
    clean_sheets, pen_scored, rating, computed_at, source)
  SELECT fp.player_id, p_league, p_season, fp.team_id,
    count(*) FILTER (WHERE coalesce(fp.minutes, 0) > 0),
    count(*) FILTER (WHERE fp.starter),
    coalesce(sum(fp.minutes), 0),
    coalesce(sum(fp.goals), 0),
    coalesce(sum(fp.assists), 0),
    sum(fp.shots), sum(fp.shots_on), sum(fp.key_passes), sum(fp.passes),
    sum(fp.tackles), sum(fp.interceptions), sum(fp.duels_won), sum(fp.dribbles_won),
    coalesce(sum(fp.yellow), 0), coalesce(sum(fp.red), 0),
    sum(fp.saves) FILTER (WHERE fp.pos = 'G'),
    sum(fp.conceded) FILTER (WHERE fp.pos = 'G'),
    count(*) FILTER (WHERE fp.pos = 'G' AND coalesce(fp.minutes, 0) >= 60
      AND (CASE WHEN fp.team_id = f.home_team_id THEN f.away_goals ELSE f.home_goals END) = 0),
    sum(fp.pen_scored),
    round(avg(fp.rating) FILTER (WHERE fp.rating IS NOT NULL), 2),
    now(), 'computed'
  FROM public.pro_fixture_players fp
  JOIN public.pro_fixtures f ON f.id = fp.fixture_id
  WHERE f.league_id = p_league AND f.season = p_season AND f.status = 'final' AND fp.player_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.pro_players p WHERE p.id = fp.player_id)
  GROUP BY fp.player_id, fp.team_id
  HAVING count(*) FILTER (WHERE coalesce(fp.minutes, 0) > 0) > 0
  ON CONFLICT (player_id, league_id, season, team_id) DO NOTHING;

  UPDATE public.pro_players p SET appeared = true
  WHERE NOT p.appeared AND p.id IN (SELECT player_id FROM public.pro_player_season_stats WHERE league_id = p_league AND season = p_season);

  DELETE FROM public.pro_team_season_stats WHERE league_id = p_league AND season = p_season;
  INSERT INTO public.pro_team_season_stats (team_id, league_id, season, played, w, d, l, gf, ga, clean_sheets,
    shots, shots_on, corners, fouls, yellow, red, possession, computed_at)
  SELECT s.team_id, p_league, p_season, count(*),
    count(*) FILTER (WHERE s.gf > s.ga), count(*) FILTER (WHERE s.gf = s.ga), count(*) FILTER (WHERE s.gf < s.ga),
    sum(s.gf), sum(s.ga), count(*) FILTER (WHERE s.ga = 0),
    sum(ts.shots), sum(ts.shots_on), sum(ts.corners), sum(ts.fouls), sum(ts.yellow), sum(ts.red),
    round(avg(ts.possession), 2), now()
  FROM (
    SELECT id AS fixture_id, home_team_id AS team_id, home_goals AS gf, away_goals AS ga FROM public.pro_fixtures
      WHERE league_id = p_league AND season = p_season AND status = 'final' AND home_goals IS NOT NULL
    UNION ALL
    SELECT id, away_team_id, away_goals, home_goals FROM public.pro_fixtures
      WHERE league_id = p_league AND season = p_season AND status = 'final' AND away_goals IS NOT NULL
  ) s
  LEFT JOIN public.pro_fixture_team_stats ts ON ts.fixture_id = s.fixture_id AND ts.team_id = s.team_id
  WHERE EXISTS (SELECT 1 FROM public.pro_teams t WHERE t.id = s.team_id)
  GROUP BY s.team_id;
END $$;

-- Nightly: recent minutes (search rank), indexable, current club and shirt number from the squads.
CREATE OR REPLACE FUNCTION public.pro_refresh_player_rank() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '600s' AS $$
DECLARE n integer := 0; k integer;
BEGIN
  WITH m AS (
    SELECT player_id, sum(minutes)::int AS mins FROM public.pro_player_season_stats
    WHERE season >= date_part('year', now())::int - 2 GROUP BY player_id
  ), sq AS (SELECT DISTINCT player_id FROM public.pro_squads),
  v AS (
    SELECT p.id, coalesce(m.mins, 0) AS mins, (coalesce(m.mins, 0) > 0 OR sq.player_id IS NOT NULL OR p.appeared) AS idx
    FROM public.pro_players p LEFT JOIN m ON m.player_id = p.id LEFT JOIN sq ON sq.player_id = p.id
  )
  UPDATE public.pro_players p SET minutes_recent = v.mins, indexable = v.idx
  FROM v WHERE v.id = p.id AND (p.minutes_recent <> v.mins OR p.indexable <> v.idx);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  -- A club squad wins over a national-team squad; the most recently read squad wins between clubs.
  WITH s AS (
    SELECT DISTINCT ON (sq.player_id) sq.player_id, sq.team_id, sq.number
    FROM public.pro_squads sq LEFT JOIN public.pro_teams t ON t.id = sq.team_id
    ORDER BY sq.player_id, coalesce(t.national, false), sq.updated_at DESC
  )
  UPDATE public.pro_players p SET current_team_id = s.team_id, number = s.number
  FROM s WHERE s.player_id = p.id AND (p.current_team_id IS DISTINCT FROM s.team_id OR p.number IS DISTINCT FROM s.number);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $$;

-- Per-90 percentiles of one player's season against the same position in the same league season (450+ minutes).
CREATE OR REPLACE FUNCTION public.pro_player_percentiles(p_player integer, p_league integer, p_season integer)
RETURNS TABLE (stat text, value numeric, pct numeric, peers integer)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH rows AS (
    SELECT s.*, coalesce(s.position, p.position) AS pos
    FROM public.pro_player_season_stats s JOIN public.pro_players p ON p.id = s.player_id
    WHERE s.league_id = p_league AND s.season = p_season AND s.minutes >= 450
  ), me AS (SELECT pos FROM rows WHERE player_id = p_player ORDER BY minutes DESC LIMIT 1),
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
$$;

-- Leaders and the player directory: one row per player, competition season and club (a mid-season move gives two),
-- the league's current season unless one is named, filtered by player traits; sorted by a whitelisted stat, optionally
-- per 90.
CREATE OR REPLACE FUNCTION public.pro_leaders(
  p_stat text DEFAULT 'goals', p_league integer DEFAULT NULL, p_season integer DEFAULT NULL, p_position text DEFAULT NULL,
  p_nationality text DEFAULT NULL, p_min_age integer DEFAULT NULL, p_max_age integer DEFAULT NULL, p_min_minutes integer DEFAULT 0,
  p_per90 boolean DEFAULT false, p_gender text DEFAULT NULL, p_abroad text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE (player_id integer, name text, slug text, photo text, nationality text, birth_date date, pos text,
  team_id integer, league_id integer, season integer, apps integer, minutes integer, goals integer, assists integer,
  rating numeric, value numeric, total bigint)
LANGUAGE plpgsql STABLE SET search_path = public SET statement_timeout = '20s' AS $$
DECLARE col text;
BEGIN
  IF p_stat NOT IN ('goals','assists','apps','minutes','shots','shots_on','key_passes','passes','tackles','interceptions',
    'duels_won','dribbles_won','saves','clean_sheets','yellow','red','rating','pen_scored','fouls_drawn','blocks','starts') THEN
    p_stat := 'goals';
  END IF;
  col := format('s.%I', p_stat);
  RETURN QUERY EXECUTE format($q$
    SELECT s.player_id, p.display_name, p.slug, p.photo, p.nationality, p.birth_date, coalesce(s.position, p.position),
      s.team_id, s.league_id, s.season, s.apps, s.minutes, s.goals, s.assists, s.rating,
      round((CASE WHEN $9 AND %2$L NOT IN ('rating','minutes','apps','starts') THEN %1$s * 90.0 / nullif(s.minutes, 0) ELSE %1$s END)::numeric, 2) AS value,
      count(*) OVER () AS total
    FROM public.pro_player_season_stats s
    JOIN public.pro_players p ON p.id = s.player_id
    JOIN public.pro_leagues l ON l.id = s.league_id
    WHERE l.enabled AND NOT p.noindex
      AND (s.season = coalesce($3, CASE WHEN $2 IS NULL THEN l.current_season ELSE (SELECT current_season FROM public.pro_leagues WHERE id = $2) END))
      AND ($2 IS NULL OR s.league_id = $2)
      AND ($4 IS NULL OR coalesce(s.position, p.position) = $4)
      AND ($5 IS NULL OR p.nationality = $5)
      AND ($6 IS NULL OR p.birth_date <= (current_date - make_interval(years => $6)))
      AND ($7 IS NULL OR p.birth_date > (current_date - make_interval(years => $7 + 1)))
      AND s.minutes >= coalesce($8, 0)
      AND ($10 IS NULL OR l.gender = $10)
      AND ($11 IS NULL OR coalesce(l.country, '') <> $11)
      AND %1$s IS NOT NULL
    ORDER BY value DESC NULLS LAST, s.minutes ASC, s.player_id
    LIMIT $12 OFFSET $13
  $q$, col, p_stat)
  USING p_stat, p_league, p_season, p_position, p_nationality, p_min_age, p_max_age, p_min_minutes, p_per90, p_gender, p_abroad, least(p_limit, 200), p_offset;
END $$;

-- Search: players ranked by recent minutes so the 690k profiles stay useful.
CREATE OR REPLACE FUNCTION public.pro_search(p_q text, p_limit integer DEFAULT 8)
RETURNS TABLE (kind text, id bigint, name text, slug text, sub text, logo text, score real)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH q AS (SELECT lower(trim(p_q)) AS t)
  (SELECT 'league', l.id::bigint, l.name, l.slug, l.country, l.logo, similarity(lower(l.name), q.t)
     FROM public.pro_leagues l, q WHERE l.enabled AND (lower(l.name) % q.t OR lower(l.name) LIKE '%' || q.t || '%')
     ORDER BY lower(l.name) = q.t DESC, l.priority, similarity(lower(l.name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'team', t.id::bigint, t.display_name, t.slug, t.country, t.logo, similarity(lower(t.display_name), q.t)
     FROM public.pro_teams t, q WHERE lower(t.display_name) % q.t OR lower(t.display_name) LIKE q.t || '%'
     ORDER BY lower(t.display_name) = q.t DESC, EXISTS (SELECT 1 FROM public.pro_league_teams lt WHERE lt.team_id = t.id) DESC,
       similarity(lower(t.display_name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'player', p.id::bigint, p.display_name, p.slug, p.nationality, p.photo, similarity(lower(p.display_name), q.t)
     FROM public.pro_players p, q WHERE NOT p.noindex AND (lower(p.display_name) % q.t OR lower(p.display_name) LIKE q.t || '%')
     ORDER BY lower(p.display_name) = q.t DESC, (p.minutes_recent > 0) DESC, similarity(lower(p.display_name), q.t) DESC, p.minutes_recent DESC LIMIT p_limit)
$$;

-- ---------- clean-up: the provider's id 0 means "no id" ----------
-- Match detail stored before 135 kept it as a player: lines and events lose the id, the fake player row goes.
UPDATE public.pro_fixture_players SET player_id = NULL WHERE player_id = 0;
UPDATE public.pro_fixture_events SET player_id = NULL WHERE player_id = 0;
UPDATE public.pro_fixture_events SET assist_id = NULL WHERE assist_id = 0;
DELETE FROM public.pro_player_season_stats WHERE player_id = 0;
DELETE FROM public.pro_college_links WHERE pro_player_id = 0;
DELETE FROM public.pro_players WHERE id = 0;
DELETE FROM public.pro_crawl_tasks WHERE kind IN ('trophies','profile') AND key = '0';

-- ---------- access ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pro_crawl_tasks','pro_countries','pro_league_teams','pro_squads','pro_transfers','pro_coaches',
    'pro_coach_career','pro_trophies','pro_injuries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.pro_refresh_player_rank() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_refresh_player_rank() TO service_role;
REVOKE ALL ON FUNCTION public.pro_player_percentiles(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_player_percentiles(integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.pro_leaders(text, integer, integer, text, text, integer, integer, integer, boolean, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_leaders(text, integer, integer, text, text, integer, integer, integer, boolean, text, text, integer, integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
