-- Every stat API-Football offers, and a US-first crawl.
--   pro_team_season_detail     teams/statistics: a club's season in one competition (form, home/away record, goals by
--                              15-minute window and over/under, biggest wins and streaks, clean sheets, failed to score,
--                              penalties, formations used, cards by minute)
--   pro_venues                 grounds (venues?country= and the ground teams?country= carries); pro_teams.venue_id
--   pro_sidelined              a player's injury, illness and suspension history (sidelined?player=)
--   pro_fixture_players        gains dribbled_past, pen_won, pen_committed
--   pro_fixture_team_stats     gains extra: every other stat type the provider sends (free kicks, goals prevented ...)
--   pro_reschedule_tasks()     after pro-plan changes refresh intervals: a finished one-off task that is now recurring
--                              gets a due date, and a recurring one whose interval shrank comes due sooner
-- pro_crawl_tasks.tier is renumbered by pro-plan: 0 everyone, 1 US scene, 2 top competitions, 3 other leagues, 4 cups.
-- Re-runnable. Apply by hand like the others (see README.md).

BEGIN;

SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.pro_team_season_detail (
  team_id integer NOT NULL,
  league_id integer NOT NULL,
  season integer NOT NULL,
  form text,                                       -- oldest first, as the provider sends it
  fixtures jsonb,                                  -- {played|wins|draws|loses: {home, away, total}}
  goals jsonb,                                     -- {for|against: {total, average, minute: {"0-15": n ...}, under_over}}
  biggest jsonb,                                   -- {streak: {wins, draws, loses}, wins: {home, away}, loses, goals}
  clean_sheet jsonb,                               -- {home, away, total}
  failed_to_score jsonb,
  penalty jsonb,                                   -- {scored, missed, total}
  lineups jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{formation, played}], most used first
  cards jsonb,                                     -- {yellow|red: {"0-15": n ...}}
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, league_id, season)
);
CREATE INDEX IF NOT EXISTS pro_team_season_detail_league_idx ON public.pro_team_season_detail (league_id, season);

CREATE TABLE IF NOT EXISTS public.pro_venues (
  id integer PRIMARY KEY,
  name text NOT NULL,
  address text,
  city text,
  country text,
  capacity integer,
  surface text,
  image text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pro_venues_country_idx ON public.pro_venues (country);

ALTER TABLE public.pro_teams ADD COLUMN IF NOT EXISTS venue_id integer;

CREATE TABLE IF NOT EXISTS public.pro_sidelined (
  player_id integer NOT NULL,
  start date NOT NULL,
  type text NOT NULL,
  "end" date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, start, type)
);

ALTER TABLE public.pro_fixture_players
  ADD COLUMN IF NOT EXISTS dribbled_past smallint,
  ADD COLUMN IF NOT EXISTS pen_won smallint,
  ADD COLUMN IF NOT EXISTS pen_committed smallint;

ALTER TABLE public.pro_fixture_team_stats ADD COLUMN IF NOT EXISTS extra jsonb;

CREATE OR REPLACE FUNCTION public.pro_reschedule_tasks()
RETURNS integer
LANGUAGE sql VOLATILE SET search_path = public AS $$
  WITH t AS (
    UPDATE public.pro_crawl_tasks
    SET due_at = last_done_at + every_days * interval '1 day'
    WHERE every_days IS NOT NULL AND last_done_at IS NOT NULL AND attempts = 0
      AND due_at > last_done_at + every_days * interval '1 day'
    RETURNING 1
  )
  SELECT count(*)::int FROM t
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pro_team_season_detail','pro_venues','pro_sidelined'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.pro_reschedule_tasks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_reschedule_tasks() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
