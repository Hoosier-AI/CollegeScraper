-- ============================================================
-- PLAIBOOK: NCAA college soccer data layer (teams, players, games, stats).
--
-- Global, system-owned catalog written only by the CollegeScraper service
-- (service_role). Signed-in users may read the public data tables; the
-- crawl/ops tables are service_role only. No org tenancy: nothing here is
-- per-club, so pin_tenancy / enforce_player_org do not apply.
--
-- Sources: each program's own athletics site (Sidearm / PrestoSports) and
-- NCAA.com. Both box-score sources are stored per game; `source_of_truth`
-- picks the one aggregates read from. Forward-only, safe to re-run.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- reference ----------
CREATE TABLE IF NOT EXISTS public.college_seasons (
  season integer PRIMARY KEY,                     -- fall calendar year (2025 = Aug-Dec 2025)
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  is_current boolean NOT NULL DEFAULT false
);
INSERT INTO public.college_seasons (season, starts_on, ends_on, is_current) VALUES
  (2024, '2024-08-10', '2024-12-20', false),
  (2025, '2025-08-10', '2025-12-20', false),
  (2026, '2026-08-10', '2026-12-20', true)
ON CONFLICT (season) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.college_conferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ncaa_seo text NOT NULL UNIQUE,
  name text NOT NULL,
  division text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.college_schools (
  seo text PRIMARY KEY,                            -- NCAA.com slug, e.g. 'duke'
  ncaa_tid integer,
  name text NOT NULL,
  long_name text,
  athletics_url text,
  athletics_host text,
  site_platform text NOT NULL DEFAULT 'unknown' CHECK (site_platform IN ('sidearm','presto','other','unknown')),
  site_detected_at timestamptz,
  logo_svg_url text,
  logo_dark_url text,
  primary_color text,
  secondary_color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_college_schools_host ON public.college_schools(athletics_host);

CREATE TABLE IF NOT EXISTS public.college_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_seo text NOT NULL REFERENCES public.college_schools(seo) ON DELETE CASCADE,
  gender text NOT NULL CHECK (gender IN ('m','w')),
  ncaa_team_id integer,
  site_sport_slug text,                            -- sidearm: mens-soccer ; presto: msoc
  site_sport_id integer,                           -- sidearm sport id (EventsResults sportId)
  site_team_slug text,                             -- presto: /teams/{slug}
  site_status text NOT NULL DEFAULT 'unknown' CHECK (site_status IN ('unknown','ok','not_found','failed')),
  name text NOT NULL,
  short_name text,
  name6 text,
  preloaded_club_id uuid REFERENCES public.preloaded_clubs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_seo, gender)
);
CREATE INDEX IF NOT EXISTS idx_college_programs_gender ON public.college_programs(gender);
CREATE INDEX IF NOT EXISTS idx_college_programs_name_trgm ON public.college_programs USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.college_program_seasons (
  program_id uuid NOT NULL REFERENCES public.college_programs(id) ON DELETE CASCADE,
  season integer NOT NULL REFERENCES public.college_seasons(season),
  division text NOT NULL CHECK (division IN ('d1','d2','d3')),
  conference_id uuid REFERENCES public.college_conferences(id) ON DELETE SET NULL,
  roster_synced_at timestamptz,
  schedule_synced_at timestamptz,
  stats_synced_at timestamptz,
  boxscores_synced_at timestamptz,
  site_parse_failures integer NOT NULL DEFAULT 0,
  PRIMARY KEY (program_id, season)
);
CREATE INDEX IF NOT EXISTS idx_college_program_seasons_lookup ON public.college_program_seasons(season, division, conference_id);

-- ---------- people ----------
CREATE TABLE IF NOT EXISTS public.college_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  display_name text NOT NULL,
  name_key text NOT NULL,                          -- normalised "last|first"
  site_player_ids jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {host: id}
  hometown_city text,
  hometown_region text,
  hometown_country text,
  high_school text,
  headshot_url text,
  bio_url text,
  suppress boolean NOT NULL DEFAULT false,         -- takedown requests: hide from product surfaces
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_college_players_name_key ON public.college_players(name_key);
CREATE INDEX IF NOT EXISTS idx_college_players_display_trgm ON public.college_players USING gin (display_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.college_player_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.college_players(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.college_programs(id) ON DELETE CASCADE,
  season integer NOT NULL REFERENCES public.college_seasons(season),
  jersey integer,
  position text,
  position_raw text,
  class_year integer,
  class_raw text,
  is_redshirt boolean NOT NULL DEFAULT false,
  is_grad boolean NOT NULL DEFAULT false,
  height_cm integer,
  weight_lb integer,
  hometown_raw text,
  high_school text,
  previous_school text,
  major text,
  is_captain boolean NOT NULL DEFAULT false,
  headshot_url text,
  bio_url text,
  source text NOT NULL DEFAULT 'boxscore_only' CHECK (source IN ('site_json','site_html','boxscore_only')),
  confidence numeric(3,2) NOT NULL DEFAULT 0.50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, season, program_id)
);
CREATE INDEX IF NOT EXISTS idx_college_player_seasons_program ON public.college_player_seasons(program_id, season);
CREATE INDEX IF NOT EXISTS idx_college_player_seasons_player ON public.college_player_seasons(player_id);

CREATE TABLE IF NOT EXISTS public.college_player_honors (
  id bigserial PRIMARY KEY,
  player_season_id uuid NOT NULL REFERENCES public.college_player_seasons(id) ON DELETE CASCADE,
  text text NOT NULL,
  source_url text,
  UNIQUE (player_season_id, text)
);

CREATE TABLE IF NOT EXISTS public.college_coaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_key text NOT NULL,
  headshot_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_college_coaches_name_key ON public.college_coaches(name_key);

CREATE TABLE IF NOT EXISTS public.college_coach_seasons (
  coach_id uuid NOT NULL REFERENCES public.college_coaches(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.college_programs(id) ON DELETE CASCADE,
  season integer NOT NULL REFERENCES public.college_seasons(season),
  title text,
  is_head boolean NOT NULL DEFAULT false,
  PRIMARY KEY (coach_id, program_id, season)
);

CREATE TABLE IF NOT EXISTS public.college_identity_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('merge','split','link')),
  from_player_id uuid,
  to_player_id uuid,
  player_season_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- games ----------
CREATE TABLE IF NOT EXISTS public.college_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL REFERENCES public.college_seasons(season),
  game_date date NOT NULL,
  start_epoch bigint,
  gender text NOT NULL CHECK (gender IN ('m','w')),
  division text CHECK (division IN ('d1','d2','d3')),
  home_program_id uuid REFERENCES public.college_programs(id) ON DELETE SET NULL,
  away_program_id uuid REFERENCES public.college_programs(id) ON DELETE SET NULL,
  home_name text,
  away_name text,
  home_score integer,
  away_score integer,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','final','postponed','cancelled')),
  overtime boolean NOT NULL DEFAULT false,
  shootout boolean NOT NULL DEFAULT false,
  neutral_site boolean NOT NULL DEFAULT false,
  conference_game boolean NOT NULL DEFAULT false,
  postseason boolean NOT NULL DEFAULT false,
  tournament text,
  attendance integer,
  venue_name text,
  venue_city text,
  duration_min integer,
  officials jsonb,
  ncaa_contest_id bigint UNIQUE,
  site_game_refs jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {host: box score url}
  source_of_truth text CHECK (source_of_truth IN ('site','ncaa')),
  site_fetched_at timestamptz,
  ncaa_fetched_at timestamptz,
  detail_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One row per fixture: same date + same two programs. NULL program ids (unresolved opponents)
-- are allowed to repeat, so the unique index is partial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_college_games_fixture ON public.college_games(game_date, home_program_id, away_program_id)
  WHERE home_program_id IS NOT NULL AND away_program_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_college_games_season_date ON public.college_games(season, game_date);
CREATE INDEX IF NOT EXISTS idx_college_games_home ON public.college_games(home_program_id, season);
CREATE INDEX IF NOT EXISTS idx_college_games_away ON public.college_games(away_program_id, season);
CREATE INDEX IF NOT EXISTS idx_college_games_needs_truth ON public.college_games(season) WHERE status = 'final' AND source_of_truth IS NULL;

CREATE TABLE IF NOT EXISTS public.college_game_team_stats (
  game_id uuid NOT NULL REFERENCES public.college_games(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.college_programs(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('site','ncaa')),
  is_home boolean NOT NULL,
  goals integer, assists integer, shots integer, shots_on_goal integer, shots_off_target integer,
  corners integer, fouls integer, offsides integer, saves integer,
  yellow_cards integer, red_cards integer, pk_goals integer, pk_attempts integer,
  gk_minutes integer, gk_goals_allowed integer, gk_saves integer,
  shutout boolean,
  period_lines jsonb,
  PRIMARY KEY (game_id, program_id, source)
);

CREATE TABLE IF NOT EXISTS public.college_game_player_stats (
  game_id uuid NOT NULL REFERENCES public.college_games(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.college_programs(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('site','ncaa')),
  source_key text NOT NULL,
  player_season_id uuid REFERENCES public.college_player_seasons(id) ON DELETE SET NULL,
  first_name text, last_name text, jersey integer, position text,
  starter boolean NOT NULL DEFAULT false,
  participated boolean NOT NULL DEFAULT true,
  minutes integer,
  goals integer, assists integer, points integer,
  shots integer, shots_on_goal integer, shots_off_target integer,
  pk_goals integer, pk_attempts integer,
  fouls integer, yellow_cards integer, red_cards integer, green_cards integer,
  corners integer, offsides integer,
  is_goalie boolean NOT NULL DEFAULT false,
  goals_allowed integer, saves integer, gk_minutes integer,
  gwg integer, unassisted_goals integer, first_goals integer, ot_goals integer,
  empty_net_goals integer, tying_goals integer, shootout_goals integer,
  hat_trick boolean NOT NULL DEFAULT false,
  PRIMARY KEY (game_id, program_id, source, source_key)
);
CREATE INDEX IF NOT EXISTS idx_college_gps_player_season ON public.college_game_player_stats(player_season_id);
CREATE INDEX IF NOT EXISTS idx_college_gps_program ON public.college_game_player_stats(program_id, source);

CREATE TABLE IF NOT EXISTS public.college_game_events (
  id bigserial PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES public.college_games(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('site','ncaa')),
  period integer NOT NULL,
  clock text,
  clock_seconds integer,
  seq integer NOT NULL,
  program_id uuid REFERENCES public.college_programs(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('goal','shot','save','corner','foul','yellow','red','green','sub_in','sub_out','offside','pk','goalie_change','other')),
  player_season_id uuid REFERENCES public.college_player_seasons(id) ON DELETE SET NULL,
  player_name_raw text,
  assist_player_season_id uuid REFERENCES public.college_player_seasons(id) ON DELETE SET NULL,
  assist_name_raw text,
  home_score integer,
  away_score integer,
  play_text text,
  UNIQUE (game_id, source, period, seq)
);
CREATE INDEX IF NOT EXISTS idx_college_events_game ON public.college_game_events(game_id, source);

CREATE TABLE IF NOT EXISTS public.college_game_raw (
  game_id uuid NOT NULL REFERENCES public.college_games(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('site','ncaa')),
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, source)
);

-- ---------- aggregates (refreshed by RPC) ----------
CREATE TABLE IF NOT EXISTS public.college_player_season_stats (
  player_season_id uuid PRIMARY KEY REFERENCES public.college_player_seasons(id) ON DELETE CASCADE,
  gp integer NOT NULL DEFAULT 0, gs integer NOT NULL DEFAULT 0, minutes integer,
  goals integer, assists integer, points integer, shots integer, sog integer,
  pk_goals integer, pk_att integer, fouls integer, yc integer, rc integer, corners integer, offsides integer,
  gwg integer, hat_tricks integer,
  ga integer, saves integer, shutouts integer, gk_minutes integer, gk_wins integer, gk_losses integer, gk_ties integer,
  goals_p90 numeric(6,2), assists_p90 numeric(6,2), shots_p90 numeric(6,2), sog_p90 numeric(6,2), points_p90 numeric(6,2),
  shot_accuracy numeric(5,3), conversion_pct numeric(5,3), gaa numeric(6,3), save_pct numeric(5,3), minutes_share numeric(5,3),
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.college_team_season_stats (
  program_id uuid NOT NULL REFERENCES public.college_programs(id) ON DELETE CASCADE,
  season integer NOT NULL REFERENCES public.college_seasons(season),
  gp integer NOT NULL DEFAULT 0, w integer NOT NULL DEFAULT 0, l integer NOT NULL DEFAULT 0, t integer NOT NULL DEFAULT 0,
  conf_w integer NOT NULL DEFAULT 0, conf_l integer NOT NULL DEFAULT 0, conf_t integer NOT NULL DEFAULT 0,
  home_w integer NOT NULL DEFAULT 0, home_l integer NOT NULL DEFAULT 0, home_t integer NOT NULL DEFAULT 0,
  away_w integer NOT NULL DEFAULT 0, away_l integer NOT NULL DEFAULT 0, away_t integer NOT NULL DEFAULT 0,
  neutral_w integer NOT NULL DEFAULT 0, neutral_l integer NOT NULL DEFAULT 0, neutral_t integer NOT NULL DEFAULT 0,
  gf integer, ga integer, gd integer,
  shots integer, sog integer, corners integer, fouls integer, offsides integer, saves integer, yc integer, rc integer,
  clean_sheets integer, avg_attendance numeric(9,1), form_last5 text, streak text,
  gf_pg numeric(5,2), ga_pg numeric(5,2), shots_pg numeric(5,2), sog_pg numeric(5,2), corners_pg numeric(5,2),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (program_id, season)
);

-- The school's own season-to-date table, kept verbatim as a cross-check for the aggregates.
CREATE TABLE IF NOT EXISTS public.college_site_season_stats (
  player_season_id uuid PRIMARY KEY REFERENCES public.college_player_seasons(id) ON DELETE CASCADE,
  gp integer, gs integer, minutes integer, goals integer, assists integer, points integer,
  shots integer, sog integer, yc integer, rc integer, gwg integer, pk_g integer, pk_a integer,
  ga integer, saves integer, shutouts integer,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.college_standings (
  season integer NOT NULL REFERENCES public.college_seasons(season),
  program_id uuid NOT NULL REFERENCES public.college_programs(id) ON DELETE CASCADE,
  division text,
  conference_id uuid REFERENCES public.college_conferences(id) ON DELETE SET NULL,
  conf_w integer, conf_l integer, conf_t integer, conf_pts integer,
  overall_w integer, overall_l integer, overall_t integer,
  rank integer,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, program_id)
);

CREATE TABLE IF NOT EXISTS public.college_rankings (
  id bigserial PRIMARY KEY,
  season integer NOT NULL REFERENCES public.college_seasons(season),
  gender text NOT NULL CHECK (gender IN ('m','w')),
  division text NOT NULL,
  poll text NOT NULL,                                -- 'usc' | 'ncaa:<statCategoryId>'
  week_of date NOT NULL,
  rank integer NOT NULL,
  program_id uuid REFERENCES public.college_programs(id) ON DELETE CASCADE,
  player_season_id uuid REFERENCES public.college_player_seasons(id) ON DELETE CASCADE,
  subject_name text,
  value numeric,
  subject_key text GENERATED ALWAYS AS (coalesce(program_id::text, '') || '|' || coalesce(player_season_id::text, '') || '|' || coalesce(subject_name, '')) STORED,
  UNIQUE (season, poll, week_of, subject_key)
);
CREATE INDEX IF NOT EXISTS idx_college_rankings_lookup ON public.college_rankings(season, gender, division, poll, week_of);

CREATE TABLE IF NOT EXISTS public.college_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.college_players(id) ON DELETE CASCADE,
  from_program_id uuid REFERENCES public.college_programs(id) ON DELETE SET NULL,
  to_program_id uuid NOT NULL REFERENCES public.college_programs(id) ON DELETE CASCADE,
  from_season integer,
  to_season integer NOT NULL,
  confidence numeric(3,2) NOT NULL DEFAULT 0.5,
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, to_season)
);

-- ---------- ops ----------
CREATE TABLE IF NOT EXISTS public.college_source_fetches (
  url text PRIMARY KEY,
  host text NOT NULL,
  status integer,
  etag text,
  last_modified text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  content_sha text,
  body text,                                        -- last successful body (HTML/JSON) for offline replay
  error text,
  attempts integer NOT NULL DEFAULT 1,
  next_retry_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_college_fetches_host ON public.college_source_fetches(host, fetched_at);
CREATE INDEX IF NOT EXISTS idx_college_fetches_retry ON public.college_source_fetches(next_retry_at) WHERE next_retry_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.college_crawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_college_runs_status ON public.college_crawl_runs(status, created_at);

CREATE TABLE IF NOT EXISTS public.college_kv (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- updated_at triggers ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['college_schools','college_programs','college_players','college_player_seasons','college_games'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------- RLS ----------
DO $$
DECLARE t text;
BEGIN
  -- Public data: signed-in users read, service_role writes.
  FOREACH t IN ARRAY ARRAY[
    'college_seasons','college_conferences','college_schools','college_programs','college_program_seasons',
    'college_players','college_player_seasons','college_player_honors','college_coaches','college_coach_seasons',
    'college_games','college_game_team_stats','college_game_player_stats','college_game_events',
    'college_player_season_stats','college_team_season_stats','college_site_season_stats',
    'college_standings','college_rankings','college_transfers'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (auth.uid() IS NOT NULL)', t || '_select', t);
  END LOOP;
  -- Ops + raw payloads + overrides: service_role only.
  FOREACH t IN ARRAY ARRAY['college_game_raw','college_identity_overrides','college_source_fetches','college_crawl_runs','college_kv'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.college_player_honors_id_seq, public.college_game_events_id_seq, public.college_rankings_id_seq TO service_role;

-- ---------- views ----------
CREATE OR REPLACE VIEW public.college_v_schedule WITH (security_invoker = true) AS
SELECT g.id, g.season, g.game_date, g.gender, g.division, g.status,
       g.home_program_id, hp.name AS home_name, hs.seo AS home_seo, hs.logo_svg_url AS home_logo,
       g.away_program_id, ap.name AS away_name, aws.seo AS away_seo, aws.logo_svg_url AS away_logo,
       g.home_score, g.away_score, g.overtime, g.shootout, g.neutral_site, g.conference_game, g.postseason,
       g.tournament, g.attendance, g.venue_name, g.venue_city, g.source_of_truth, g.ncaa_contest_id
FROM public.college_games g
LEFT JOIN public.college_programs hp ON hp.id = g.home_program_id
LEFT JOIN public.college_schools hs ON hs.seo = hp.school_seo
LEFT JOIN public.college_programs ap ON ap.id = g.away_program_id
LEFT JOIN public.college_schools aws ON aws.seo = ap.school_seo;

CREATE OR REPLACE VIEW public.college_v_player_leaders WITH (security_invoker = true) AS
SELECT ps.player_id, p.display_name, p.suppress, ps.program_id, pr.name AS program_name, pr.gender,
       s.seo AS school_seo, s.logo_svg_url, ps.season, pse.division, pse.conference_id, c.name AS conference_name,
       ps.jersey, ps.position, ps.class_year, ps.class_raw, ps.height_cm, ps.headshot_url,
       st.*
FROM public.college_player_season_stats st
JOIN public.college_player_seasons ps ON ps.id = st.player_season_id
JOIN public.college_players p ON p.id = ps.player_id
JOIN public.college_programs pr ON pr.id = ps.program_id
JOIN public.college_schools s ON s.seo = pr.school_seo
LEFT JOIN public.college_program_seasons pse ON pse.program_id = ps.program_id AND pse.season = ps.season
LEFT JOIN public.college_conferences c ON c.id = pse.conference_id;

CREATE OR REPLACE VIEW public.college_v_team_leaders WITH (security_invoker = true) AS
SELECT pr.name AS program_name, pr.gender, s.seo AS school_seo, s.logo_svg_url,
       pse.division, pse.conference_id, c.name AS conference_name, ts.*
FROM public.college_team_season_stats ts
JOIN public.college_programs pr ON pr.id = ts.program_id
JOIN public.college_schools s ON s.seo = pr.school_seo
LEFT JOIN public.college_program_seasons pse ON pse.program_id = ts.program_id AND pse.season = ts.season
LEFT JOIN public.college_conferences c ON c.id = pse.conference_id;

CREATE OR REPLACE VIEW public.college_v_player_career WITH (security_invoker = true) AS
SELECT ps.player_id,
       count(*) AS seasons,
       count(DISTINCT ps.program_id) AS programs,
       sum(st.gp) AS gp, sum(st.gs) AS gs, sum(st.minutes) AS minutes,
       sum(st.goals) AS goals, sum(st.assists) AS assists, sum(st.points) AS points,
       sum(st.shots) AS shots, sum(st.sog) AS sog, sum(st.yc) AS yc, sum(st.rc) AS rc, sum(st.gwg) AS gwg,
       sum(st.ga) AS ga, sum(st.saves) AS saves, sum(st.shutouts) AS shutouts, sum(st.gk_minutes) AS gk_minutes
FROM public.college_player_season_stats st
JOIN public.college_player_seasons ps ON ps.id = st.player_season_id
GROUP BY ps.player_id;

GRANT SELECT ON public.college_v_schedule, public.college_v_player_leaders, public.college_v_team_leaders, public.college_v_player_career TO authenticated, service_role;

-- ---------- RPCs ----------
-- Claim the oldest queued run (or re-claim one whose heartbeat went stale) for the worker.
CREATE OR REPLACE FUNCTION public.college_claim_run(p_stale_minutes integer DEFAULT 10)
RETURNS SETOF public.college_crawl_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.college_crawl_runs;
BEGIN
  SELECT * INTO r FROM college_crawl_runs
   WHERE status = 'queued' OR (status = 'running' AND heartbeat_at < now() - make_interval(mins => p_stale_minutes))
   ORDER BY created_at
   FOR UPDATE SKIP LOCKED LIMIT 1;
  IF r.id IS NULL THEN RETURN; END IF;
  UPDATE college_crawl_runs SET status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now()
   WHERE id = r.id RETURNING * INTO r;
  RETURN NEXT r;
END $$;
REVOKE ALL ON FUNCTION public.college_claim_run(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_claim_run(integer) TO service_role;

-- Recompute player + team season aggregates from the truth-source game rows.
CREATE OR REPLACE FUNCTION public.college_refresh_season_aggregates(p_season integer, p_program uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_players integer; n_teams integer;
BEGIN
  -- ---- player season stats ----
  -- Truth-source lines, with minutes / starter / goalkeeper minutes borrowed from the other source for the
  -- same player when the truth source does not publish them (PrestoSports box scores list minutes only for
  -- goalkeepers and do not mark starters; NCAA.com does).
  WITH truth AS (
    SELECT gps.game_id, gps.program_id, gps.source, gps.source_key, gps.player_season_id,
           coalesce(gps.minutes, alt.minutes) AS minutes,
           (gps.starter OR coalesce(alt.starter, false)) AS starter,
           gps.participated,
           gps.goals, gps.assists, gps.points, gps.shots, gps.shots_on_goal, gps.pk_goals, gps.pk_attempts,
           gps.fouls, gps.yellow_cards, gps.red_cards, gps.corners, gps.offsides, gps.gwg, gps.hat_trick,
           gps.is_goalie, gps.goals_allowed, gps.saves, coalesce(gps.gk_minutes, alt.gk_minutes) AS gk_minutes,
           g.home_program_id, g.away_program_id, g.home_score, g.away_score, g.overtime
      FROM college_game_player_stats gps
      JOIN college_games g ON g.id = gps.game_id
      LEFT JOIN college_game_player_stats alt
             ON alt.game_id = gps.game_id AND alt.program_id = gps.program_id AND alt.player_season_id = gps.player_season_id
            AND alt.source <> gps.source
     WHERE g.season = p_season AND g.status = 'final' AND g.source_of_truth IS NOT NULL AND gps.source = g.source_of_truth
       AND gps.player_season_id IS NOT NULL
       AND (p_program IS NULL OR gps.program_id = p_program)
  ), team_minutes AS (
    SELECT game_id, program_id, greatest(max(minutes), 90) AS team_min FROM truth GROUP BY game_id, program_id
  ), agg AS (
    SELECT t.player_season_id,
      count(*) FILTER (WHERE t.participated) AS gp,
      count(*) FILTER (WHERE t.starter) AS gs,
      sum(t.minutes) AS minutes,
      sum(t.goals) AS goals, sum(t.assists) AS assists, sum(coalesce(t.points, coalesce(t.goals,0)*2 + coalesce(t.assists,0))) AS points,
      sum(t.shots) AS shots, sum(t.shots_on_goal) AS sog, sum(t.pk_goals) AS pk_goals, sum(t.pk_attempts) AS pk_att,
      sum(t.fouls) AS fouls, sum(t.yellow_cards) AS yc, sum(t.red_cards) AS rc, sum(t.corners) AS corners, sum(t.offsides) AS offsides,
      sum(t.gwg) AS gwg, count(*) FILTER (WHERE t.hat_trick) AS hat_tricks,
      sum(t.goals_allowed) FILTER (WHERE t.is_goalie) AS ga,
      sum(t.saves) FILTER (WHERE t.is_goalie) AS saves,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) >= 45 AND coalesce(t.goals_allowed,0) = 0
                        AND CASE WHEN t.program_id = t.home_program_id THEN t.away_score ELSE t.home_score END = 0) AS shutouts,
      sum(coalesce(t.gk_minutes, t.minutes)) FILTER (WHERE t.is_goalie) AS gk_minutes,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) >= 45 AND
        CASE WHEN t.program_id = t.home_program_id THEN t.home_score > t.away_score ELSE t.away_score > t.home_score END) AS gk_wins,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) >= 45 AND
        CASE WHEN t.program_id = t.home_program_id THEN t.home_score < t.away_score ELSE t.away_score < t.home_score END) AS gk_losses,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) >= 45 AND t.home_score = t.away_score) AS gk_ties,
      sum(tm.team_min) FILTER (WHERE t.participated) AS team_minutes
    FROM truth t JOIN team_minutes tm ON tm.game_id = t.game_id AND tm.program_id = t.program_id
    GROUP BY t.player_season_id
  )
  INSERT INTO college_player_season_stats AS s (player_season_id, gp, gs, minutes, goals, assists, points, shots, sog, pk_goals, pk_att,
      fouls, yc, rc, corners, offsides, gwg, hat_tricks, ga, saves, shutouts, gk_minutes, gk_wins, gk_losses, gk_ties,
      goals_p90, assists_p90, shots_p90, sog_p90, points_p90, shot_accuracy, conversion_pct, gaa, save_pct, minutes_share, computed_at)
  SELECT a.player_season_id, a.gp, a.gs, a.minutes, a.goals, a.assists, a.points, a.shots, a.sog, a.pk_goals, a.pk_att,
      a.fouls, a.yc, a.rc, a.corners, a.offsides, a.gwg, a.hat_tricks, a.ga, a.saves, a.shutouts, a.gk_minutes, a.gk_wins, a.gk_losses, a.gk_ties,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.goals::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.assists::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.shots::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.sog::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.points::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.shots,0) > 0 THEN round(a.sog::numeric / a.shots, 3) END,
      CASE WHEN coalesce(a.shots,0) > 0 THEN round(a.goals::numeric / a.shots, 3) END,
      CASE WHEN coalesce(a.gk_minutes,0) > 0 THEN round(a.ga::numeric * 90 / a.gk_minutes, 3) END,
      CASE WHEN coalesce(a.saves,0) + coalesce(a.ga,0) > 0 THEN round(a.saves::numeric / (a.saves + a.ga), 3) END,
      CASE WHEN coalesce(a.team_minutes,0) > 0 THEN round(a.minutes::numeric / a.team_minutes, 3) END,
      now()
  FROM agg a
  ON CONFLICT (player_season_id) DO UPDATE SET
    gp = EXCLUDED.gp, gs = EXCLUDED.gs, minutes = EXCLUDED.minutes, goals = EXCLUDED.goals, assists = EXCLUDED.assists, points = EXCLUDED.points,
    shots = EXCLUDED.shots, sog = EXCLUDED.sog, pk_goals = EXCLUDED.pk_goals, pk_att = EXCLUDED.pk_att, fouls = EXCLUDED.fouls, yc = EXCLUDED.yc, rc = EXCLUDED.rc,
    corners = EXCLUDED.corners, offsides = EXCLUDED.offsides, gwg = EXCLUDED.gwg, hat_tricks = EXCLUDED.hat_tricks, ga = EXCLUDED.ga, saves = EXCLUDED.saves,
    shutouts = EXCLUDED.shutouts, gk_minutes = EXCLUDED.gk_minutes, gk_wins = EXCLUDED.gk_wins, gk_losses = EXCLUDED.gk_losses, gk_ties = EXCLUDED.gk_ties,
    goals_p90 = EXCLUDED.goals_p90, assists_p90 = EXCLUDED.assists_p90, shots_p90 = EXCLUDED.shots_p90, sog_p90 = EXCLUDED.sog_p90, points_p90 = EXCLUDED.points_p90,
    shot_accuracy = EXCLUDED.shot_accuracy, conversion_pct = EXCLUDED.conversion_pct, gaa = EXCLUDED.gaa, save_pct = EXCLUDED.save_pct,
    minutes_share = EXCLUDED.minutes_share, computed_at = now();
  GET DIAGNOSTICS n_players = ROW_COUNT;

  -- ---- team season stats ----
  WITH tg AS (
    SELECT ts.program_id, g.season, g.game_date, ts.is_home, g.neutral_site, g.conference_game, g.attendance,
           CASE WHEN ts.is_home THEN g.home_score ELSE g.away_score END AS gf,
           CASE WHEN ts.is_home THEN g.away_score ELSE g.home_score END AS ga,
           ts.shots, ts.shots_on_goal, ts.corners, ts.fouls, ts.offsides, ts.saves, ts.yellow_cards, ts.red_cards
      FROM college_game_team_stats ts
      JOIN college_games g ON g.id = ts.game_id
     WHERE g.season = p_season AND g.status = 'final' AND g.source_of_truth IS NOT NULL AND ts.source = g.source_of_truth
       AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
       AND (p_program IS NULL OR ts.program_id = p_program)
  ), res AS (
    SELECT *, CASE WHEN gf > ga THEN 'W' WHEN gf < ga THEN 'L' ELSE 'T' END AS r FROM tg
  ), ordered AS (
    SELECT program_id, string_agg(r, '' ORDER BY game_date DESC) AS seq FROM res GROUP BY program_id
  ), agg AS (
    SELECT program_id, count(*) AS gp,
      count(*) FILTER (WHERE r='W') AS w, count(*) FILTER (WHERE r='L') AS l, count(*) FILTER (WHERE r='T') AS t,
      count(*) FILTER (WHERE r='W' AND conference_game) AS conf_w, count(*) FILTER (WHERE r='L' AND conference_game) AS conf_l, count(*) FILTER (WHERE r='T' AND conference_game) AS conf_t,
      count(*) FILTER (WHERE r='W' AND is_home AND NOT neutral_site) AS home_w, count(*) FILTER (WHERE r='L' AND is_home AND NOT neutral_site) AS home_l, count(*) FILTER (WHERE r='T' AND is_home AND NOT neutral_site) AS home_t,
      count(*) FILTER (WHERE r='W' AND NOT is_home AND NOT neutral_site) AS away_w, count(*) FILTER (WHERE r='L' AND NOT is_home AND NOT neutral_site) AS away_l, count(*) FILTER (WHERE r='T' AND NOT is_home AND NOT neutral_site) AS away_t,
      count(*) FILTER (WHERE r='W' AND neutral_site) AS neutral_w, count(*) FILTER (WHERE r='L' AND neutral_site) AS neutral_l, count(*) FILTER (WHERE r='T' AND neutral_site) AS neutral_t,
      sum(gf) AS gf, sum(ga) AS ga, sum(shots) AS shots, sum(shots_on_goal) AS sog, sum(corners) AS corners, sum(fouls) AS fouls,
      sum(offsides) AS offsides, sum(saves) AS saves, sum(yellow_cards) AS yc, sum(red_cards) AS rc,
      count(*) FILTER (WHERE ga = 0) AS clean_sheets, avg(attendance) AS avg_attendance
    FROM res GROUP BY program_id
  )
  INSERT INTO college_team_season_stats AS s (program_id, season, gp, w, l, t, conf_w, conf_l, conf_t, home_w, home_l, home_t, away_w, away_l, away_t,
      neutral_w, neutral_l, neutral_t, gf, ga, gd, shots, sog, corners, fouls, offsides, saves, yc, rc, clean_sheets, avg_attendance, form_last5, streak,
      gf_pg, ga_pg, shots_pg, sog_pg, corners_pg, computed_at)
  SELECT a.program_id, p_season, a.gp, a.w, a.l, a.t, a.conf_w, a.conf_l, a.conf_t, a.home_w, a.home_l, a.home_t, a.away_w, a.away_l, a.away_t,
      a.neutral_w, a.neutral_l, a.neutral_t, a.gf, a.ga, a.gf - a.ga, a.shots, a.sog, a.corners, a.fouls, a.offsides, a.saves, a.yc, a.rc, a.clean_sheets,
      round(a.avg_attendance::numeric, 1), left(o.seq, 5),
      (SELECT left(o.seq,1) || length(substring(o.seq from '^(' || left(o.seq,1) || '+)'))),
      round(a.gf::numeric / a.gp, 2), round(a.ga::numeric / a.gp, 2), round(a.shots::numeric / a.gp, 2), round(a.sog::numeric / a.gp, 2), round(a.corners::numeric / a.gp, 2), now()
  FROM agg a JOIN ordered o ON o.program_id = a.program_id
  ON CONFLICT (program_id, season) DO UPDATE SET
    gp = EXCLUDED.gp, w = EXCLUDED.w, l = EXCLUDED.l, t = EXCLUDED.t, conf_w = EXCLUDED.conf_w, conf_l = EXCLUDED.conf_l, conf_t = EXCLUDED.conf_t,
    home_w = EXCLUDED.home_w, home_l = EXCLUDED.home_l, home_t = EXCLUDED.home_t, away_w = EXCLUDED.away_w, away_l = EXCLUDED.away_l, away_t = EXCLUDED.away_t,
    neutral_w = EXCLUDED.neutral_w, neutral_l = EXCLUDED.neutral_l, neutral_t = EXCLUDED.neutral_t, gf = EXCLUDED.gf, ga = EXCLUDED.ga, gd = EXCLUDED.gd,
    shots = EXCLUDED.shots, sog = EXCLUDED.sog, corners = EXCLUDED.corners, fouls = EXCLUDED.fouls, offsides = EXCLUDED.offsides, saves = EXCLUDED.saves,
    yc = EXCLUDED.yc, rc = EXCLUDED.rc, clean_sheets = EXCLUDED.clean_sheets, avg_attendance = EXCLUDED.avg_attendance, form_last5 = EXCLUDED.form_last5,
    streak = EXCLUDED.streak, gf_pg = EXCLUDED.gf_pg, ga_pg = EXCLUDED.ga_pg, shots_pg = EXCLUDED.shots_pg, sog_pg = EXCLUDED.sog_pg, corners_pg = EXCLUDED.corners_pg,
    computed_at = now();
  GET DIAGNOSTICS n_teams = ROW_COUNT;

  RETURN jsonb_build_object('season', p_season, 'program', p_program, 'players', n_players, 'teams', n_teams);
END $$;
REVOKE ALL ON FUNCTION public.college_refresh_season_aggregates(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_refresh_season_aggregates(integer, uuid) TO service_role;

-- Trigram search helpers (read-only, available to signed-in users).
CREATE OR REPLACE FUNCTION public.college_search_programs(q text, p_gender text DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS TABLE (program_id uuid, name text, gender text, school_seo text, logo_svg_url text, athletics_host text, similarity real)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT p.id, p.name, p.gender, s.seo, s.logo_svg_url, s.athletics_host, greatest(similarity(p.name, q), similarity(coalesce(s.long_name,''), q)) AS sim
    FROM college_programs p JOIN college_schools s ON s.seo = p.school_seo
   WHERE (p_gender IS NULL OR p.gender = p_gender)
     AND (p.name ILIKE '%' || q || '%' OR s.long_name ILIKE '%' || q || '%' OR similarity(p.name, q) > 0.3)
   ORDER BY sim DESC, p.name
   LIMIT least(greatest(p_limit, 1), 50);
$$;
CREATE OR REPLACE FUNCTION public.college_search_players(q text, p_gender text DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS TABLE (player_id uuid, display_name text, gender text, program_id uuid, program_name text, season integer, pos text, class_raw text, headshot_url text, similarity real)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT DISTINCT ON (pl.id) pl.id, pl.display_name, pr.gender, pr.id, pr.name, ps.season, ps.position, ps.class_raw, coalesce(ps.headshot_url, pl.headshot_url), similarity(pl.display_name, q) AS sim
    FROM college_players pl
    JOIN college_player_seasons ps ON ps.player_id = pl.id
    JOIN college_programs pr ON pr.id = ps.program_id
   WHERE NOT pl.suppress AND (p_gender IS NULL OR pr.gender = p_gender)
     AND (pl.display_name ILIKE '%' || q || '%' OR similarity(pl.display_name, q) > 0.3)
   ORDER BY pl.id, ps.season DESC
   LIMIT least(greatest(p_limit, 1), 50);
$$;
GRANT EXECUTE ON FUNCTION public.college_search_programs(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.college_search_players(text, text, integer) TO authenticated, service_role;
