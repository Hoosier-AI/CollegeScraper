-- Plaibook Stats Pro: sources other than API-Football, mapped onto its ids and checked against it.
--   pro_source_seasons       per source, league and season: last sync, row counts, errors (drives the sync and progress)
--   pro_src_games / teams / players / venues / officials
--                            a source's own records, keyed by its own ids (American Soccer Analysis first)
--   pro_adv_player_seasons   advanced player season stats: xG, xA, shots, key passes, passing over expected,
--                            goals added by action, keepers' xG faced
--   pro_adv_team_seasons     the same for clubs, for and against
--   pro_adv_shots            every shot of a game: where, xG, outcome
--   pro_source_ids           a source's id -> the API-Football id (team, player, game), with how it was matched
--   pro_source_checks        each collected number API-Football also has, side by side: agree / differ / unmatched
--   pro_source_agreement()   the checks summed by source, league, season and kind
-- Re-runnable. Apply by hand like the others (see README.md).

BEGIN;

SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.pro_source_seasons (
  source text NOT NULL,
  league_id integer NOT NULL,
  season integer NOT NULL,
  synced_at timestamptz,
  shots_synced_at timestamptz,
  games integer NOT NULL DEFAULT 0,
  player_rows integer NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0,
  last_error text,
  PRIMARY KEY (source, league_id, season)
);

CREATE TABLE IF NOT EXISTS public.pro_src_games (
  source text NOT NULL,
  ext_id text NOT NULL,
  league_id integer NOT NULL,
  season integer NOT NULL,
  kickoff timestamptz NOT NULL,
  home_ext text NOT NULL,
  away_ext text NOT NULL,
  home_score smallint,
  away_score smallint,
  home_xg numeric(6,4),
  away_xg numeric(6,4),
  attendance integer,
  stadium_ext text,
  referee_ext text,
  home_manager_ext text,
  away_manager_ext text,
  matchday smallint,
  knockout boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'scheduled',
  shots_at timestamptz,                            -- the game's shots were read
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, ext_id)
);
CREATE INDEX IF NOT EXISTS pro_src_games_season_idx ON public.pro_src_games (source, league_id, season);

CREATE TABLE IF NOT EXISTS public.pro_src_teams (
  source text NOT NULL,
  ext_id text NOT NULL,
  league_id integer NOT NULL,
  name text NOT NULL,
  short_name text,
  abbr text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, ext_id)
);

CREATE TABLE IF NOT EXISTS public.pro_src_players (
  source text NOT NULL,
  ext_id text NOT NULL,
  name text NOT NULL,
  birth_date date,
  height_cm smallint,
  weight_kg smallint,
  nationality text,
  position text,
  seasons integer[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, ext_id)
);

CREATE TABLE IF NOT EXISTS public.pro_src_venues (
  source text NOT NULL,
  ext_id text NOT NULL,
  name text NOT NULL,
  capacity integer,
  year_built smallint,
  roof boolean,
  turf boolean,
  street text,
  city text,
  province text,
  country text,
  postal_code text,
  lat double precision,
  lng double precision,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, ext_id)
);

CREATE TABLE IF NOT EXISTS public.pro_src_officials (
  source text NOT NULL,
  role text NOT NULL CHECK (role IN ('manager','referee')),
  ext_id text NOT NULL,
  name text,
  birth_date date,
  nationality text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, role, ext_id)
);

CREATE TABLE IF NOT EXISTS public.pro_adv_player_seasons (
  source text NOT NULL,
  league_id integer NOT NULL,
  season integer NOT NULL,
  player_ext text NOT NULL,
  team_ext text NOT NULL,
  position text,
  minutes integer,
  shots integer, shots_on integer, goals integer, xg numeric(8,4), xplace numeric(8,4),
  key_passes integer, assists integer, xa numeric(8,4),
  passes integer, pass_pct numeric(6,4), xpass_pct numeric(6,4), passes_over_expected numeric(8,2),
  g_plus jsonb, g_plus_total numeric(8,4),
  gk_shots_faced integer, gk_goals_conceded integer, gk_saves integer, gk_xg_faced numeric(8,4), gk_goals_minus_xg numeric(8,4),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, league_id, season, player_ext, team_ext)
);
CREATE INDEX IF NOT EXISTS pro_adv_player_seasons_player_idx ON public.pro_adv_player_seasons (source, player_ext);

CREATE TABLE IF NOT EXISTS public.pro_adv_team_seasons (
  source text NOT NULL,
  league_id integer NOT NULL,
  season integer NOT NULL,
  team_ext text NOT NULL,
  games integer, shots_for integer, shots_against integer, goals_for integer, goals_against integer,
  xg_for numeric(8,4), xg_against numeric(8,4), points integer, xpoints numeric(8,2),
  passes_for integer, pass_pct_for numeric(6,4), xpass_pct_for numeric(6,4), passes_over_expected_for numeric(8,2),
  passes_against integer, pass_pct_against numeric(6,4), xpass_pct_against numeric(6,4), passes_over_expected_against numeric(8,2),
  g_plus jsonb, g_plus_for numeric(8,4), g_plus_against numeric(8,4),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, league_id, season, team_ext)
);

CREATE TABLE IF NOT EXISTS public.pro_adv_shots (
  source text NOT NULL,
  game_ext text NOT NULL,
  seq integer NOT NULL,
  period smallint,
  minute smallint,
  team_ext text,
  shooter_ext text,
  shooter_name text,
  assist_ext text,
  x real, y real, end_x real, end_y real,
  distance_yds real,
  xg numeric(6,4),
  psxg numeric(6,4),
  goal boolean NOT NULL DEFAULT false,
  own_goal boolean NOT NULL DEFAULT false,
  blocked boolean NOT NULL DEFAULT false,
  head boolean NOT NULL DEFAULT false,
  pattern text,
  PRIMARY KEY (source, game_ext, seq)
);

CREATE TABLE IF NOT EXISTS public.pro_source_ids (
  source text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('team','player','game')),
  ext_id text NOT NULL,
  pro_id bigint,                                   -- null: looked for, not found
  method text,                                     -- games / name+birth / name+club / alias / none
  confidence numeric(3,2),
  verified boolean NOT NULL DEFAULT false,         -- set by hand: the job never changes a verified or rejected row
  rejected boolean NOT NULL DEFAULT false,
  evidence jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, kind, ext_id)
);
CREATE INDEX IF NOT EXISTS pro_source_ids_pro_idx ON public.pro_source_ids (kind, pro_id);

CREATE TABLE IF NOT EXISTS public.pro_source_checks (
  source text NOT NULL,
  kind text NOT NULL,                              -- game / player_season / team_season
  key text NOT NULL,                               -- the source's ids, e.g. game id or player|team
  field text NOT NULL,                             -- score / minutes / goals / assists / goals_for / goals_against
  league_id integer NOT NULL,
  season integer NOT NULL,
  pro_key text,                                    -- the API-Football ids compared against
  ours numeric,
  api numeric,
  status text NOT NULL CHECK (status IN ('agree','differ','unmatched')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, league_id, season, kind, key, field)
);
CREATE INDEX IF NOT EXISTS pro_source_checks_season_idx ON public.pro_source_checks (source, league_id, season, status);

-- source-map looks players up by birth date.
CREATE INDEX IF NOT EXISTS pro_players_birth_date_idx ON public.pro_players (birth_date);

CREATE OR REPLACE FUNCTION public.pro_source_agreement()
RETURNS TABLE (source text, league_id integer, season integer, kind text, checks integer, agree integer, differ integer, unmatched integer, checked_at timestamptz)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT c.source, c.league_id, c.season, c.kind, count(*)::int,
    count(*) FILTER (WHERE c.status = 'agree')::int,
    count(*) FILTER (WHERE c.status = 'differ')::int,
    count(*) FILTER (WHERE c.status = 'unmatched')::int,
    max(c.checked_at)
  FROM public.pro_source_checks c
  GROUP BY 1, 2, 3, 4
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pro_source_seasons','pro_src_games','pro_src_teams','pro_src_players','pro_src_venues','pro_src_officials',
    'pro_adv_player_seasons','pro_adv_team_seasons','pro_adv_shots','pro_source_ids','pro_source_checks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.pro_source_agreement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_source_agreement() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
