-- Indexes for college_game_events' links to a player season (2026-10-13). Both columns reference
-- college_player_seasons (ON DELETE SET NULL) with no index, so deleting or merging one player season scanned all
-- ~7.9M events twice: the backfill's deletes took 57 s each and its event re-links 27 s, ~1.5 TB read in all, and
-- the disk they kept busy slowed every page of the site (Pro leaders past the 20 s limit). college_rankings'
-- link gets one too.
-- CREATE INDEX CONCURRENTLY runs outside a transaction: run each statement on its own. Rollback: DROP INDEX the three.

CREATE INDEX CONCURRENTLY IF NOT EXISTS college_game_events_player_season_idx ON public.college_game_events (player_season_id) WHERE player_season_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS college_game_events_assist_season_idx ON public.college_game_events (assist_player_season_id) WHERE assist_player_season_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS college_rankings_player_season_idx ON public.college_rankings (player_season_id) WHERE player_season_id IS NOT NULL;
