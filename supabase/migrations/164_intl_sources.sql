-- International, sources first (2026-10-12): national-team history from open sources, keyed by nation rather than by
-- API-Football ids because it reaches back to 1872, long before the provider.
--   intl_nations      one row per nation (key = slug of martj42's name, "united-states"), its senior men's and women's
--                     sides in pro_teams, FIFA code, confederation, first match.
--   intl_src_matches  each source's results (martj42 'intl-results', Fjelstul 'worldcup-db', openfootball
--                     'openfootball-wc', 'wikipedia'), linked to the API-Football fixture when there is one.
--   intl_src_goals    scorers (minute, penalty, own goal, assist where the source has it).
--   intl_squads       tournament squads (Fjelstul: every World Cup squad, men's and women's).
--   intl_caps         caps and international goals per player and nation (Wikipedia careers, Wikidata, RSSSF).
--   intl_elo          Plaibook Elo after every match; intl_elo_current the latest rating and rank per nation.
--   intl_source_agreement()  each source's scores against API-Football's on the matches both have (the hub).
-- Reads go through the service role only. Rollback: drop the tables and the function.

BEGIN;

CREATE TABLE IF NOT EXISTS public.intl_nations (
  key text PRIMARY KEY,
  name text NOT NULL,
  fifa_code text,
  confederation text,
  team_m integer,                 -- pro_teams: the senior men's side
  team_w integer,                 -- pro_teams: the senior women's side
  first_match date,
  matches integer NOT NULL DEFAULT 0,
  -- False for sides outside FIFA (CONIFA, the Island Games): their results are kept, they are not ranked.
  fifa boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intl_nations_team_m_idx ON public.intl_nations(team_m) WHERE team_m IS NOT NULL;
CREATE INDEX IF NOT EXISTS intl_nations_team_w_idx ON public.intl_nations(team_w) WHERE team_w IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.intl_src_matches (
  source text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('m', 'w')),
  date date NOT NULL,
  home text NOT NULL,             -- intl_nations.key
  away text NOT NULL,
  level text NOT NULL DEFAULT 'senior' CHECK (level IN ('senior', 'youth')),
  home_name text,
  away_name text,
  home_score smallint,            -- after extra time; shoot-outs are not goals
  away_score smallint,
  pen_home smallint,
  pen_away smallint,
  aet boolean,
  shootout_winner text,
  tournament text NOT NULL,
  league_id integer,              -- pro_leagues, when the tournament is one we follow
  stage text,
  city text,
  country text,
  neutral boolean,
  ext_id text,
  pro_fixture_id bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, gender, date, home, away)
);
CREATE INDEX IF NOT EXISTS intl_src_matches_home_idx ON public.intl_src_matches(gender, home, date);
CREATE INDEX IF NOT EXISTS intl_src_matches_away_idx ON public.intl_src_matches(gender, away, date);
CREATE INDEX IF NOT EXISTS intl_src_matches_fixture_idx ON public.intl_src_matches(pro_fixture_id) WHERE pro_fixture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS intl_src_matches_league_idx ON public.intl_src_matches(league_id, date) WHERE league_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.intl_src_goals (
  source text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('m', 'w')),
  date date NOT NULL,
  home text NOT NULL,
  away text NOT NULL,
  seq smallint NOT NULL,
  team text NOT NULL,             -- the side the goal counts for
  scorer text NOT NULL,
  minute smallint,
  stoppage smallint,
  own_goal boolean NOT NULL DEFAULT false,
  penalty boolean NOT NULL DEFAULT false,
  assist text,
  ext_player text,
  pro_player_id integer,
  PRIMARY KEY (source, gender, date, home, away, seq)
);
CREATE INDEX IF NOT EXISTS intl_src_goals_team_idx ON public.intl_src_goals(gender, team, scorer);
CREATE INDEX IF NOT EXISTS intl_src_goals_player_idx ON public.intl_src_goals(pro_player_id) WHERE pro_player_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.intl_squads (
  source text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('m', 'w')),
  tournament text NOT NULL,       -- the source's id ("WC-2022")
  year integer NOT NULL,
  league_id integer,
  nation text NOT NULL,
  player_name text NOT NULL,
  ext_player text NOT NULL,
  shirt smallint,
  position text,
  birth_date date,
  wiki_title text,
  pro_player_id integer,
  PRIMARY KEY (source, tournament, nation, ext_player)
);
CREATE INDEX IF NOT EXISTS intl_squads_nation_idx ON public.intl_squads(gender, nation, year);
CREATE INDEX IF NOT EXISTS intl_squads_player_idx ON public.intl_squads(pro_player_id) WHERE pro_player_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.intl_caps (
  source text NOT NULL,           -- 'wikipedia' (career infobox), 'wikidata', 'rsssf'
  person text NOT NULL,           -- the source's id for the player (Wikidata item, or a name key)
  nation text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('m', 'w')),
  player_name text NOT NULL,
  caps integer,
  goals integer,
  first_year integer,
  last_year integer,
  pro_player_id integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, person, nation)
);
CREATE INDEX IF NOT EXISTS intl_caps_nation_idx ON public.intl_caps(gender, nation, caps DESC);
CREATE INDEX IF NOT EXISTS intl_caps_player_idx ON public.intl_caps(pro_player_id) WHERE pro_player_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.intl_elo (
  gender text NOT NULL CHECK (gender IN ('m', 'w')),
  nation text NOT NULL,
  date date NOT NULL,
  opponent text NOT NULL,
  rating real NOT NULL,
  delta real NOT NULL,
  tournament text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gender, nation, date, opponent)
);
CREATE TABLE IF NOT EXISTS public.intl_elo_current (
  gender text NOT NULL CHECK (gender IN ('m', 'w')),
  nation text NOT NULL,
  rating real NOT NULL,
  rank integer,                   -- among sides that played in the last four years (FIFA members only)
  matches integer NOT NULL,
  last_match date,
  change_1y real,
  best real,
  best_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gender, nation)
);
CREATE INDEX IF NOT EXISTS intl_elo_current_rank_idx ON public.intl_elo_current(gender, rank) WHERE rank IS NOT NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['intl_nations', 'intl_src_matches', 'intl_src_goals', 'intl_squads', 'intl_caps', 'intl_elo', 'intl_elo_current'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- Each source's scores against API-Football's, on the matches linked to a fixture (intl-match). A fixture's sides
-- are turned into nations through intl_nations, so a match listed the other way round still compares.
CREATE OR REPLACE FUNCTION public.intl_source_agreement()
 RETURNS TABLE(source text, compared integer, agree integer)
 LANGUAGE sql STABLE SET search_path TO 'public' SET statement_timeout TO '30s'
AS $function$
  SELECT m.source, count(*)::int,
    count(*) FILTER (WHERE (nh.key = m.home AND f.home_goals = m.home_score AND f.away_goals = m.away_score)
                        OR (nh.key = m.away AND f.home_goals = m.away_score AND f.away_goals = m.home_score))::int
  FROM public.intl_src_matches m
  JOIN public.pro_fixtures f ON f.id = m.pro_fixture_id AND f.status = 'final'
  LEFT JOIN public.intl_nations nh ON nh.team_m = f.home_team_id OR nh.team_w = f.home_team_id
  WHERE m.home_score IS NOT NULL
  GROUP BY m.source
$function$;
REVOKE ALL ON FUNCTION public.intl_source_agreement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intl_source_agreement() TO service_role;

-- intl-match's links, set in one statement per batch (an upsert would need every column of the row).
-- p_rows: [{source, gender, date, home, away, fixture}]
CREATE OR REPLACE FUNCTION public.intl_set_fixture_links(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  UPDATE public.intl_src_matches m SET pro_fixture_id = r.fixture
    FROM jsonb_to_recordset(p_rows) AS r(source text, gender text, date date, home text, away text, fixture bigint)
   WHERE m.source = r.source AND m.gender = r.gender AND m.date = r.date AND m.home = r.home AND m.away = r.away
     AND m.pro_fixture_id IS DISTINCT FROM r.fixture;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
-- p_rows: [{source, tournament, nation, ext_player, player}]
CREATE OR REPLACE FUNCTION public.intl_set_squad_players(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  UPDATE public.intl_squads s SET pro_player_id = r.player
    FROM jsonb_to_recordset(p_rows) AS r(source text, tournament text, nation text, ext_player text, player integer)
   WHERE s.source = r.source AND s.tournament = r.tournament AND s.nation = r.nation AND s.ext_player = r.ext_player
     AND s.pro_player_id IS DISTINCT FROM r.player;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.intl_set_fixture_links(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.intl_set_squad_players(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intl_set_fixture_links(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.intl_set_squad_players(jsonb) TO service_role;

COMMIT;
