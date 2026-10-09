-- League tables from other sources (Wikipedia season articles), keyed by the source's own club names; checked against
-- API-Football's tables (points, played) where both have the season, and used for seasons API-Football does not have.
-- Re-runnable. Apply by hand like the others (see README.md).

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.pro_src_standings (
  source text NOT NULL,
  league_id integer NOT NULL,
  season integer NOT NULL,
  group_name text NOT NULL,
  team_ext text NOT NULL,
  rank smallint,
  played smallint, win smallint, draw smallint, lose smallint, shootout_wins smallint,
  gf smallint, ga smallint, gd smallint, points smallint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, league_id, season, group_name, team_ext)
);

ALTER TABLE public.pro_src_standings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_src_standings FROM anon, authenticated;
GRANT ALL ON public.pro_src_standings TO service_role;

-- pro_source_ids.kind already allows team / player / game; tables need nothing more.

COMMIT;

NOTIFY pgrst, 'reload schema';
