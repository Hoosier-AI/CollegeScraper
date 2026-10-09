-- Players fetched on demand when someone opens their page (transfers, honours, this and last season in every
-- competition): when, so each is fetched at most once every 14 days. Re-runnable.
BEGIN;
CREATE TABLE IF NOT EXISTS public.pro_player_refresh (
  player_id integer PRIMARY KEY,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  calls smallint NOT NULL DEFAULT 0,
  transfers integer NOT NULL DEFAULT 0,
  season_rows integer NOT NULL DEFAULT 0,
  trophies integer NOT NULL DEFAULT 0
);
ALTER TABLE public.pro_player_refresh ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_player_refresh FROM anon, authenticated;
GRANT ALL ON public.pro_player_refresh TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
