-- Plaibook's API reads (2026-10-16).
-- 1. A program page found its last crawl runs with `params @> {"program": <seo>}` over every run ever recorded (no
--    index on params): a GIN index answers the containment directly. Built CONCURRENTLY: run this statement on its own,
--    outside a transaction.
-- 2. The rankings page listed its polls and weeks by reading every ranking row of the season (tens of thousands, each
--    team and player list of every week): the distinct (poll, week, label) rows in one small read instead.
--    src/ui/queries.ts falls back to the old read until this function exists.

CREATE INDEX CONCURRENTLY IF NOT EXISTS college_crawl_runs_params_gin ON public.college_crawl_runs USING gin (params jsonb_path_ops);

CREATE OR REPLACE FUNCTION public.college_ranking_weeks(p_season integer, p_gender text DEFAULT NULL, p_division text DEFAULT NULL)
RETURNS TABLE (poll text, week_of date, label text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT DISTINCT r.poll, r.week_of, r.label
    FROM college_rankings r
   WHERE r.season = p_season
     AND (p_gender IS NULL OR r.gender = p_gender)
     AND (p_division IS NULL OR r.division = p_division)
$$;
REVOKE ALL ON FUNCTION public.college_ranking_weeks(integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_ranking_weeks(integer, text, text) TO service_role;
