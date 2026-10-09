-- Plaibook Stats Pro history from other sources (openfootball, public domain): MLS results before API-Football's
-- coverage, checked first against API-Football on the seasons both have.
--   pro_src_games        gains round, half-time, extra-time and penalty scores
--   pro_fixtures.source  'api-football' (default) or the source a history match came from; those carry negative ids
--   pro_teams.source     the same, for clubs API-Football does not know (negative ids)
-- Re-runnable. Apply by hand like the others (see README.md).

BEGIN;

SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.pro_src_games
  ADD COLUMN IF NOT EXISTS round text,
  ADD COLUMN IF NOT EXISTS ht_home smallint, ADD COLUMN IF NOT EXISTS ht_away smallint,
  ADD COLUMN IF NOT EXISTS et_home smallint, ADD COLUMN IF NOT EXISTS et_away smallint,
  ADD COLUMN IF NOT EXISTS pen_home smallint, ADD COLUMN IF NOT EXISTS pen_away smallint;

ALTER TABLE public.pro_fixtures ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'api-football';
ALTER TABLE public.pro_teams ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'api-football';

COMMIT;

NOTIFY pgrst, 'reload schema';
