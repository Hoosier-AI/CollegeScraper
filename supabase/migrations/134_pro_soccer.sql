-- Plaibook Stats Pro: professional leagues worldwide, from API-Football (api-sports.io, the Pro plan Plaibook already
-- pays for; its terms allow showing the data on a website, not reselling the raw feed, so nothing here is exposed
-- through /v1). Separate from the college_* tables: pro seasons, competitions and clubs share nothing with NCAA
-- programs. Rows are keyed by the provider's own integer ids (league, team, fixture, player), which are stable.
--   pro_leagues / pro_seasons          the competition catalog and per-season coverage flags
--   pro_teams / pro_players            clubs (and national teams) and people, with slugs for the public pages
--   pro_fixtures                       one row per match; detail_fetched_at once events / lineups / stats landed
--   pro_fixture_events                 goals, cards, substitutions, VAR decisions
--   pro_fixture_lineups                formation and coach per side
--   pro_fixture_players                one line per player per side: lineup slot + match stats
--   pro_fixture_team_stats             possession, shots, corners... per side
--   pro_standings                      the provider's tables (league phase, groups, conferences)
--   pro_player_season_stats / pro_team_season_stats   season totals, refreshed by pro_refresh_season_aggregates()
--   pro_college_links                  pro players who played NCAA soccer (Wikidata + name/age matching)
--   pro_slug_redirects                 old slugs answer with a 301
-- Re-runnable: IF NOT EXISTS / CREATE OR REPLACE throughout. Apply by hand like the others (see README.md).

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '10s';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- catalog ----------
CREATE TABLE IF NOT EXISTS public.pro_leagues (
  id integer PRIMARY KEY,                          -- API-Football league id
  name text NOT NULL,
  type text NOT NULL DEFAULT 'league' CHECK (type IN ('league','cup')),
  country text,
  country_code text,
  country_flag text,
  logo text,
  gender text NOT NULL DEFAULT 'm' CHECK (gender IN ('m','w')),
  -- 'pro' is crawled by default; youth, friendlies and amateur leagues are kept in the catalog but off.
  kind text NOT NULL DEFAULT 'pro' CHECK (kind IN ('pro','youth','friendly','amateur')),
  -- Lower first: backfill order and the home page's featured list (1-99 hand-picked, then 500 leagues, 600 cups...).
  priority integer NOT NULL DEFAULT 900,
  enabled boolean NOT NULL DEFAULT false,
  -- Set by hand (console / SQL): the catalog job then never changes `enabled` for this league.
  enabled_locked boolean NOT NULL DEFAULT false,
  current_season integer,
  slug text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pro_leagues_enabled_idx ON public.pro_leagues(enabled, priority);
CREATE INDEX IF NOT EXISTS pro_leagues_name_trgm ON public.pro_leagues USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.pro_seasons (
  league_id integer NOT NULL REFERENCES public.pro_leagues(id) ON DELETE CASCADE,
  season integer NOT NULL,                         -- the provider's season year (2026 = 2026 or 2026-27)
  starts_on date,
  ends_on date,
  is_current boolean NOT NULL DEFAULT false,
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  fixtures_synced_at timestamptz,
  teams_synced_at timestamptz,
  standings_synced_at timestamptz,
  -- Every finished fixture of the season has its detail (or the provider has none to give).
  backfilled_at timestamptz,
  PRIMARY KEY (league_id, season)
);

CREATE TABLE IF NOT EXISTS public.pro_teams (
  id integer PRIMARY KEY,                          -- API-Football team id
  name text NOT NULL,
  display_name text NOT NULL,                      -- the provider's women's sides end in " W"; dropped here
  code text,
  country text,
  founded integer,
  national boolean NOT NULL DEFAULT false,
  gender text CHECK (gender IN ('m','w')),
  logo text,
  venue_name text,
  venue_city text,
  venue_capacity integer,
  slug text,
  profile_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pro_teams_name_trgm ON public.pro_teams USING gin (display_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.pro_players (
  id integer PRIMARY KEY,                          -- API-Football player id
  name text NOT NULL,                              -- as the provider prints it in lineups ("M. Arnold")
  display_name text NOT NULL,                      -- first given name + last name once the profile is known
  first_name text,
  last_name text,
  name_key text,                                   -- "last|first" like college_players.name_key
  birth_date date,
  birth_place text,
  birth_country text,
  nationality text,
  height_cm smallint,
  weight_kg smallint,
  position text,
  photo text,
  gender text CHECK (gender IN ('m','w')),
  wikidata_qid text,
  noindex boolean NOT NULL DEFAULT false,
  slug text,
  profile_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pro_players_name_key_idx ON public.pro_players(name_key);
CREATE INDEX IF NOT EXISTS pro_players_name_trgm ON public.pro_players USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pro_players_profile_idx ON public.pro_players(profile_synced_at NULLS FIRST);

-- ---------- matches ----------
CREATE TABLE IF NOT EXISTS public.pro_fixtures (
  id bigint PRIMARY KEY,                           -- API-Football fixture id
  league_id integer NOT NULL REFERENCES public.pro_leagues(id) ON DELETE CASCADE,
  season integer NOT NULL,
  round text,
  kickoff timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','final','postponed','cancelled','abandoned')),
  status_short text,                               -- the provider's code: NS, 1H, HT, FT, AET, PEN, PST...
  elapsed smallint,
  elapsed_extra smallint,
  home_team_id integer NOT NULL REFERENCES public.pro_teams(id),
  away_team_id integer NOT NULL REFERENCES public.pro_teams(id),
  home_goals smallint,
  away_goals smallint,
  ht_home smallint, ht_away smallint,
  et_home smallint, et_away smallint,
  pen_home smallint, pen_away smallint,
  winner text CHECK (winner IN ('home','away','draw')),
  venue_name text,
  venue_city text,
  referee text,
  slug text,
  detail_fetched_at timestamptz,
  detail_attempts integer NOT NULL DEFAULT 0,
  final_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pro_fixtures_kickoff_idx ON public.pro_fixtures(kickoff);
CREATE INDEX IF NOT EXISTS pro_fixtures_league_idx ON public.pro_fixtures(league_id, season, kickoff);
CREATE INDEX IF NOT EXISTS pro_fixtures_home_idx ON public.pro_fixtures(home_team_id, kickoff);
CREATE INDEX IF NOT EXISTS pro_fixtures_away_idx ON public.pro_fixtures(away_team_id, kickoff);
CREATE INDEX IF NOT EXISTS pro_fixtures_live_idx ON public.pro_fixtures(status) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS pro_fixtures_pending_detail_idx ON public.pro_fixtures(kickoff DESC) WHERE status = 'final' AND detail_fetched_at IS NULL;

CREATE TABLE IF NOT EXISTS public.pro_fixture_events (
  fixture_id bigint NOT NULL REFERENCES public.pro_fixtures(id) ON DELETE CASCADE,
  seq smallint NOT NULL,
  minute smallint,
  extra smallint,
  team_id integer,
  player_id integer,
  player_name text,
  assist_id integer,
  assist_name text,
  type text NOT NULL,                              -- goal, card, subst, var
  detail text,                                     -- Normal Goal, Own Goal, Penalty, Missed Penalty, Yellow Card...
  comments text,
  PRIMARY KEY (fixture_id, seq)
);

CREATE TABLE IF NOT EXISTS public.pro_fixture_lineups (
  fixture_id bigint NOT NULL REFERENCES public.pro_fixtures(id) ON DELETE CASCADE,
  team_id integer NOT NULL,
  formation text,
  coach_id integer,
  coach_name text,
  PRIMARY KEY (fixture_id, team_id)
);

CREATE TABLE IF NOT EXISTS public.pro_fixture_players (
  fixture_id bigint NOT NULL REFERENCES public.pro_fixtures(id) ON DELETE CASCADE,
  team_id integer NOT NULL,
  slot smallint NOT NULL,                          -- order: starters as listed, then the bench, then anyone else
  player_id integer,                               -- the provider sometimes lists a lineup player without an id
  name text NOT NULL,
  number smallint,
  pos text,                                        -- G, D, M, F
  grid text,                                       -- "row:col" on the formation diagram
  starter boolean NOT NULL DEFAULT false,
  substitute boolean NOT NULL DEFAULT false,
  captain boolean NOT NULL DEFAULT false,
  minutes smallint,
  rating numeric(4,2),
  goals smallint, assists smallint, conceded smallint, saves smallint,
  shots smallint, shots_on smallint,
  passes smallint, key_passes smallint, pass_accuracy smallint,
  tackles smallint, blocks smallint, interceptions smallint,
  duels smallint, duels_won smallint,
  dribbles smallint, dribbles_won smallint,
  fouls_drawn smallint, fouls_committed smallint,
  yellow smallint, red smallint, offsides smallint,
  pen_scored smallint, pen_missed smallint, pen_saved smallint,
  PRIMARY KEY (fixture_id, team_id, slot)
);
CREATE INDEX IF NOT EXISTS pro_fixture_players_player_idx ON public.pro_fixture_players(player_id) WHERE player_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pro_fixture_team_stats (
  fixture_id bigint NOT NULL REFERENCES public.pro_fixtures(id) ON DELETE CASCADE,
  team_id integer NOT NULL,
  possession numeric(5,2),
  shots smallint, shots_on smallint, shots_off smallint, shots_blocked smallint, shots_inside smallint, shots_outside smallint,
  corners smallint, offsides smallint, fouls smallint, yellow smallint, red smallint, saves smallint,
  passes smallint, passes_accurate smallint, pass_pct numeric(5,2),
  xg numeric(5,2),
  PRIMARY KEY (fixture_id, team_id)
);

CREATE TABLE IF NOT EXISTS public.pro_standings (
  league_id integer NOT NULL REFERENCES public.pro_leagues(id) ON DELETE CASCADE,
  season integer NOT NULL,
  group_name text NOT NULL DEFAULT '',
  team_id integer NOT NULL REFERENCES public.pro_teams(id),
  rank smallint,
  points smallint,
  played smallint, win smallint, draw smallint, lose smallint,
  gf smallint, ga smallint, gd smallint,
  form text,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season, group_name, team_id)
);

-- ---------- season totals ----------
CREATE TABLE IF NOT EXISTS public.pro_player_season_stats (
  player_id integer NOT NULL REFERENCES public.pro_players(id) ON DELETE CASCADE,
  league_id integer NOT NULL,
  season integer NOT NULL,
  team_id integer NOT NULL,
  apps integer NOT NULL DEFAULT 0,
  starts integer NOT NULL DEFAULT 0,
  minutes integer NOT NULL DEFAULT 0,
  goals integer NOT NULL DEFAULT 0,
  assists integer NOT NULL DEFAULT 0,
  shots integer, shots_on integer, key_passes integer, passes integer,
  tackles integer, interceptions integer, duels_won integer, dribbles_won integer,
  yellow integer NOT NULL DEFAULT 0,
  red integer NOT NULL DEFAULT 0,
  saves integer, conceded integer, clean_sheets integer,
  pen_scored integer,
  rating numeric(4,2),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, league_id, season, team_id)
);
CREATE INDEX IF NOT EXISTS pro_player_season_stats_league_idx ON public.pro_player_season_stats(league_id, season, goals DESC);

CREATE TABLE IF NOT EXISTS public.pro_team_season_stats (
  team_id integer NOT NULL REFERENCES public.pro_teams(id) ON DELETE CASCADE,
  league_id integer NOT NULL,
  season integer NOT NULL,
  played integer NOT NULL DEFAULT 0,
  w integer NOT NULL DEFAULT 0, d integer NOT NULL DEFAULT 0, l integer NOT NULL DEFAULT 0,
  gf integer NOT NULL DEFAULT 0, ga integer NOT NULL DEFAULT 0,
  clean_sheets integer NOT NULL DEFAULT 0,
  shots integer, shots_on integer, corners integer, fouls integer, yellow integer, red integer,
  possession numeric(5,2),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, league_id, season)
);

-- ---------- college links ----------
CREATE TABLE IF NOT EXISTS public.pro_college_links (
  id bigserial PRIMARY KEY,
  pro_player_id integer NOT NULL REFERENCES public.pro_players(id) ON DELETE CASCADE,
  college_player_id uuid REFERENCES public.college_players(id) ON DELETE SET NULL,
  school_seo text,                                 -- college_schools.seo when the school is known to us
  college_name text NOT NULL,                      -- as the source names it
  first_season integer,
  last_season integer,
  method text NOT NULL CHECK (method IN ('wikidata','name_age','manual')),
  confidence numeric(3,2) NOT NULL DEFAULT 0.5,
  -- Review state: verified shows regardless of confidence; rejected never shows and is never re-proposed.
  verified boolean NOT NULL DEFAULT false,
  rejected boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pro_college_links_key ON public.pro_college_links(pro_player_id, college_name);
CREATE INDEX IF NOT EXISTS pro_college_links_college_idx ON public.pro_college_links(college_player_id) WHERE college_player_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pro_slug_redirects (
  kind text NOT NULL CHECK (kind IN ('league','team','player','match')),
  slug text NOT NULL,
  target_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, slug)
);

-- ---------- updated_at ----------
CREATE OR REPLACE FUNCTION public.pro_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pro_leagues','pro_teams','pro_players','pro_fixtures','pro_college_links'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pro_touch_updated_at()', 'trg_' || t || '_updated_at', t);
  END LOOP;
END $$;

-- ---------- slugs ----------
-- college_slugify() comes from migration 129. A slug is derived from the name; on a clash a longer, still readable
-- form is tried, then the provider id. A changed slug leaves a redirect behind.
CREATE OR REPLACE FUNCTION public.pro_remember_slug(p_kind text, p_old text, p_new text, p_id bigint) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.pro_slug_redirects (kind, slug, target_id)
  SELECT p_kind, p_old, p_id WHERE p_old IS NOT NULL AND p_old IS DISTINCT FROM p_new
  ON CONFLICT (kind, slug) DO UPDATE SET target_id = EXCLUDED.target_id, created_at = now()
$$;

-- League: "england-premier-league"; "World" competitions go by name alone ("uefa-champions-league").
CREATE OR REPLACE FUNCTION public.pro_leagues_set_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base text; cand text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug AND NEW.slug IS NOT NULL THEN
    PERFORM public.pro_remember_slug('league', OLD.slug, NEW.slug, NEW.id); RETURN NEW;
  END IF;
  base := coalesce(public.college_slugify(CASE WHEN coalesce(NEW.country, 'World') = 'World' THEN NEW.name ELSE NEW.country || ' ' || NEW.name END), 'league');
  IF NEW.slug IS NOT NULL AND (NEW.slug = base OR NEW.slug = base || '-' || NEW.id) THEN RETURN NEW; END IF;
  cand := base;
  IF EXISTS (SELECT 1 FROM public.pro_leagues WHERE slug = cand AND id <> NEW.id) THEN cand := base || '-' || NEW.id; END IF;
  IF TG_OP = 'UPDATE' THEN PERFORM public.pro_remember_slug('league', OLD.slug, cand, NEW.id); END IF;
  NEW.slug := cand;
  RETURN NEW;
END $$;

-- Team: "arsenal"; on a clash "arsenal-england" (or "-women"), then "arsenal-42".
CREATE OR REPLACE FUNCTION public.pro_teams_set_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base text; alt text; cand text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug AND NEW.slug IS NOT NULL THEN
    PERFORM public.pro_remember_slug('team', OLD.slug, NEW.slug, NEW.id); RETURN NEW;
  END IF;
  base := coalesce(public.college_slugify(NEW.display_name), 'team');
  IF NEW.gender = 'w' THEN base := base || '-women'; END IF;
  alt := base || coalesce('-' || public.college_slugify(NEW.country), '');
  IF NEW.slug IS NOT NULL AND (NEW.slug = base OR NEW.slug = alt OR NEW.slug = base || '-' || NEW.id) THEN RETURN NEW; END IF;
  cand := base;
  IF EXISTS (SELECT 1 FROM public.pro_teams WHERE slug = cand AND id <> NEW.id) THEN cand := alt; END IF;
  IF EXISTS (SELECT 1 FROM public.pro_teams WHERE slug = cand AND id <> NEW.id) THEN cand := base || '-' || NEW.id; END IF;
  IF TG_OP = 'UPDATE' THEN PERFORM public.pro_remember_slug('team', OLD.slug, cand, NEW.id); END IF;
  NEW.slug := cand;
  RETURN NEW;
END $$;

-- Player: "mackenzie-arnold-68776". The id keeps it unique without a lookup.
CREATE OR REPLACE FUNCTION public.pro_players_set_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cand text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug AND NEW.slug IS NOT NULL THEN
    PERFORM public.pro_remember_slug('player', OLD.slug, NEW.slug, NEW.id); RETURN NEW;
  END IF;
  cand := coalesce(public.college_slugify(NEW.display_name), 'player') || '-' || NEW.id;
  IF TG_OP = 'UPDATE' THEN PERFORM public.pro_remember_slug('player', OLD.slug, cand, NEW.id); END IF;
  NEW.slug := cand;
  RETURN NEW;
END $$;

-- Match: "2026-10-04-portland-thorns-women-vs-boston-legacy-women" (UTC date of kickoff); on a clash the fixture id.
CREATE OR REPLACE FUNCTION public.pro_fixtures_set_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base text; cand text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug AND NEW.slug IS NOT NULL THEN
    PERFORM public.pro_remember_slug('match', OLD.slug, NEW.slug, NEW.id); RETURN NEW;
  END IF;
  base := to_char(NEW.kickoff AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    || '-' || coalesce((SELECT slug FROM public.pro_teams WHERE id = NEW.home_team_id), 'tbd')
    || '-vs-' || coalesce((SELECT slug FROM public.pro_teams WHERE id = NEW.away_team_id), 'tbd');
  IF NEW.slug IS NOT NULL AND (NEW.slug = base OR NEW.slug = base || '-' || NEW.id) THEN RETURN NEW; END IF;
  cand := base;
  IF EXISTS (SELECT 1 FROM public.pro_fixtures WHERE slug = cand AND id <> NEW.id) THEN cand := base || '-' || NEW.id; END IF;
  IF TG_OP = 'UPDATE' THEN PERFORM public.pro_remember_slug('match', OLD.slug, cand, NEW.id); END IF;
  NEW.slug := cand;
  RETURN NEW;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pro_leagues_slug_key ON public.pro_leagues(slug);
CREATE UNIQUE INDEX IF NOT EXISTS pro_teams_slug_key ON public.pro_teams(slug);
CREATE UNIQUE INDEX IF NOT EXISTS pro_players_slug_key ON public.pro_players(slug);
CREATE UNIQUE INDEX IF NOT EXISTS pro_fixtures_slug_key ON public.pro_fixtures(slug);

DROP TRIGGER IF EXISTS trg_pro_leagues_slug ON public.pro_leagues;
CREATE TRIGGER trg_pro_leagues_slug BEFORE INSERT OR UPDATE OF name, country, slug ON public.pro_leagues
  FOR EACH ROW EXECUTE FUNCTION public.pro_leagues_set_slug();
DROP TRIGGER IF EXISTS trg_pro_teams_slug ON public.pro_teams;
CREATE TRIGGER trg_pro_teams_slug BEFORE INSERT OR UPDATE OF display_name, gender, country, slug ON public.pro_teams
  FOR EACH ROW EXECUTE FUNCTION public.pro_teams_set_slug();
DROP TRIGGER IF EXISTS trg_pro_players_slug ON public.pro_players;
CREATE TRIGGER trg_pro_players_slug BEFORE INSERT OR UPDATE OF display_name, slug ON public.pro_players
  FOR EACH ROW EXECUTE FUNCTION public.pro_players_set_slug();
DROP TRIGGER IF EXISTS trg_pro_fixtures_slug ON public.pro_fixtures;
CREATE TRIGGER trg_pro_fixtures_slug BEFORE INSERT OR UPDATE OF kickoff, home_team_id, away_team_id, slug ON public.pro_fixtures
  FOR EACH ROW EXECUTE FUNCTION public.pro_fixtures_set_slug();

-- final_at: the first time a fixture was seen final (the post-match lag metric, like college_games.final_at).
CREATE OR REPLACE FUNCTION public.pro_fixtures_final_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'final' AND NEW.final_at IS NULL THEN NEW.final_at := now(); END IF;
  IF TG_OP = 'UPDATE' AND OLD.final_at IS NOT NULL AND NEW.final_at IS NULL THEN NEW.final_at := OLD.final_at; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pro_fixtures_final_at ON public.pro_fixtures;
CREATE TRIGGER trg_pro_fixtures_final_at BEFORE INSERT OR UPDATE OF status, final_at ON public.pro_fixtures
  FOR EACH ROW EXECUTE FUNCTION public.pro_fixtures_final_at();

-- ---------- season totals ----------
-- Recomputed per league season from the stored match lines. Serialised per league season (advisory lock) so the
-- detail job and a backfill never interleave their delete + insert.
CREATE OR REPLACE FUNCTION public.pro_refresh_season_aggregates(p_league integer, p_season integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(p_league, p_season);

  DELETE FROM public.pro_player_season_stats WHERE league_id = p_league AND season = p_season;
  INSERT INTO public.pro_player_season_stats (player_id, league_id, season, team_id, apps, starts, minutes, goals, assists,
    shots, shots_on, key_passes, passes, tackles, interceptions, duels_won, dribbles_won, yellow, red, saves, conceded,
    clean_sheets, pen_scored, rating, computed_at)
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
    now()
  FROM public.pro_fixture_players fp
  JOIN public.pro_fixtures f ON f.id = fp.fixture_id
  WHERE f.league_id = p_league AND f.season = p_season AND f.status = 'final' AND fp.player_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.pro_players p WHERE p.id = fp.player_id)
  GROUP BY fp.player_id, fp.team_id
  HAVING count(*) FILTER (WHERE coalesce(fp.minutes, 0) > 0) > 0;

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
  GROUP BY s.team_id;
END $$;

-- ---------- search ----------
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
     ORDER BY lower(t.display_name) = q.t DESC, similarity(lower(t.display_name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'player', p.id::bigint, p.display_name, p.slug, p.nationality, p.photo, similarity(lower(p.display_name), q.t)
     FROM public.pro_players p, q WHERE NOT p.noindex AND (lower(p.display_name) % q.t OR lower(p.display_name) LIKE q.t || '%')
     ORDER BY lower(p.display_name) = q.t DESC, similarity(lower(p.display_name), q.t) DESC LIMIT p_limit)
$$;

-- ---------- access: service role only (the site reads through the server) ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pro_leagues','pro_seasons','pro_teams','pro_players','pro_fixtures','pro_fixture_events',
    'pro_fixture_lineups','pro_fixture_players','pro_fixture_team_stats','pro_standings','pro_player_season_stats',
    'pro_team_season_stats','pro_college_links','pro_slug_redirects'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.pro_college_links_id_seq TO service_role;
REVOKE ALL ON FUNCTION public.pro_refresh_season_aggregates(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_refresh_season_aggregates(integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.pro_search(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_search(text, integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
