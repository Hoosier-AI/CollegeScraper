-- Where a league table came from: 'api-football' (default), 'wikipedia' (a season article's official table, checked
-- against results first) or 'results' (worked out from API-Football's results when no table exists anywhere; groups
-- are the sets of clubs that played each other). League pages credit and label it.
-- Re-runnable. Apply by hand like the others (see README.md).

BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE public.pro_standings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'api-football';
COMMIT;

NOTIFY pgrst, 'reload schema';
