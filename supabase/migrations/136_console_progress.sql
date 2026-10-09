-- Progress numbers for the owner's console and the PlaibookOS hub (Stats → Pro → Crawl progress, College → Progress).
--   pro_crawl_tasks.tier        0 = everyone (countries, clubs, player profiles), 1 = hand-picked competitions,
--                               2 = other leagues, 3 = cups; set by pro-plan, backfilled here for existing tasks
--   pro_crawl_progress()        the crawl queue grouped by kind and tier
--   college_sync_progress(s)    NCAA programs of a season with each crawl stage done, by division
-- Read-only functions, service role only. Re-runnable.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.pro_crawl_tasks ADD COLUMN IF NOT EXISTS tier smallint;

-- League-season tasks: the competition's tier.
UPDATE public.pro_crawl_tasks t
SET tier = CASE WHEN l.priority < 100 THEN 1 WHEN l.type = 'league' AND l.priority < 600 THEN 2 ELSE 3 END
FROM public.pro_leagues l
WHERE t.tier IS NULL AND t.kind IN ('season_fixtures','standings','league_players','detail','injuries')
  AND l.id = split_part(t.key, '|', 1)::int;

-- Club tasks: the best tier among the competitions the club plays this season.
UPDATE public.pro_crawl_tasks t
SET tier = s.tier
FROM (
  SELECT lt.team_id, min(CASE WHEN l.priority < 100 THEN 1 WHEN l.type = 'league' AND l.priority < 600 THEN 2 ELSE 3 END) AS tier
  FROM public.pro_league_teams lt JOIN public.pro_leagues l ON l.id = lt.league_id AND lt.season = l.current_season
  GROUP BY lt.team_id
) s
WHERE t.tier IS NULL AND t.kind IN ('squad','transfers','coach') AND s.team_id = t.key::int;

UPDATE public.pro_crawl_tasks SET tier = 0 WHERE tier IS NULL AND kind IN ('countries','country_teams','profiles_page','profile');
UPDATE public.pro_crawl_tasks SET tier = 1 WHERE tier IS NULL AND kind = 'trophies';

CREATE OR REPLACE FUNCTION public.pro_crawl_progress()
RETURNS TABLE (kind text, tier smallint, tasks integer, done integer, due integer, errors integer, calls bigint, done_calls bigint, pages_left bigint, never_done integer)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT t.kind, coalesce(t.tier, 3)::smallint,
    count(*)::int,
    count(*) FILTER (WHERE t.last_done_at IS NOT NULL)::int,
    count(*) FILTER (WHERE t.due_at <= now())::int,
    count(*) FILTER (WHERE t.last_error IS NOT NULL)::int,
    coalesce(sum(t.calls), 0)::bigint,
    coalesce(sum(t.calls) FILTER (WHERE t.last_done_at IS NOT NULL), 0)::bigint,
    coalesce(sum(greatest(coalesce(t.pages, 0) - t.page, 0)) FILTER (WHERE t.due_at <= now()), 0)::bigint,
    count(*) FILTER (WHERE t.last_done_at IS NULL)::int
  FROM public.pro_crawl_tasks t
  GROUP BY t.kind, coalesce(t.tier, 3)
$$;

CREATE OR REPLACE FUNCTION public.college_sync_progress(p_season integer)
RETURNS TABLE (division text, programs integer, roster integer, schedule integer, stats integer, boxscores integer,
  roster_24h integer, schedule_24h integer, stats_24h integer, boxscores_24h integer, failing integer)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(ps.division, 'other'),
    count(*)::int,
    count(ps.roster_synced_at)::int, count(ps.schedule_synced_at)::int, count(ps.stats_synced_at)::int, count(ps.boxscores_synced_at)::int,
    count(*) FILTER (WHERE ps.roster_synced_at > now() - interval '24 hours')::int,
    count(*) FILTER (WHERE ps.schedule_synced_at > now() - interval '24 hours')::int,
    count(*) FILTER (WHERE ps.stats_synced_at > now() - interval '24 hours')::int,
    count(*) FILTER (WHERE ps.boxscores_synced_at > now() - interval '24 hours')::int,
    count(*) FILTER (WHERE coalesce(ps.site_parse_failures, 0) > 0)::int
  FROM public.college_program_seasons ps
  WHERE ps.season = p_season AND ps.ncaa_member IS NOT FALSE
  GROUP BY coalesce(ps.division, 'other')
  ORDER BY 1
$$;

REVOKE ALL ON FUNCTION public.pro_crawl_progress() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_crawl_progress() TO service_role;
REVOKE ALL ON FUNCTION public.college_sync_progress(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_sync_progress(integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
