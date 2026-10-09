-- Clubs fetched on demand when someone opens their page (or a player's): match detail for this season's finals,
-- transfers, squad, coaches, season stats; when, so each is fetched at most once every 14 days. Re-runnable.
BEGIN;
CREATE TABLE IF NOT EXISTS public.pro_team_refresh (
  team_id integer PRIMARY KEY,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  calls smallint NOT NULL DEFAULT 0,
  matches integer NOT NULL DEFAULT 0,
  transfers integer NOT NULL DEFAULT 0,
  squad integer NOT NULL DEFAULT 0,
  coaches integer NOT NULL DEFAULT 0,
  season_stats integer NOT NULL DEFAULT 0
);
ALTER TABLE public.pro_team_refresh ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_team_refresh FROM anon, authenticated;
GRANT ALL ON public.pro_team_refresh TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
