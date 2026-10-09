-- American Soccer Analysis season totals where API-Football has none (USL League One, USL Super League, and seasons it
-- has not reached): pro_player_season_stats rows with source 'asa'. API-Football's own totals replace them (provider
-- upserts update the row); totals worked out from match lines never do (they insert ON CONFLICT DO NOTHING).
--   pro_players.source            'api-football', or 'asa' for players API-Football does not know (negative ids)
--   pro_adv_player_seasons.games  appearances (ASA counts games with minutes)
-- Re-runnable.

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.pro_player_season_stats DROP CONSTRAINT IF EXISTS pro_player_season_stats_source_check;
ALTER TABLE public.pro_player_season_stats ADD CONSTRAINT pro_player_season_stats_source_check CHECK (source IN ('computed','provider','asa'));
ALTER TABLE public.pro_players ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'api-football';
-- ASA has no starts or cards: left empty rather than shown as zero.
ALTER TABLE public.pro_player_season_stats ALTER COLUMN starts DROP NOT NULL, ALTER COLUMN yellow DROP NOT NULL, ALTER COLUMN red DROP NOT NULL;
ALTER TABLE public.pro_adv_player_seasons ADD COLUMN IF NOT EXISTS games integer;

COMMIT;

NOTIFY pgrst, 'reload schema';
