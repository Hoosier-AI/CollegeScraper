-- The console's job rollup in one query (2026-10-11): the service read every run of the last 14 days (35k rows, 5 MB
-- of counters, 35 pages one after another) to find each job's last success, last failure and queue, and the hub's
-- Overview and Crawling pages timed out at 8 s. Same window and answer, computed in the database.
-- Rollback: DROP FUNCTION public.college_job_rollup().
CREATE OR REPLACE FUNCTION public.college_job_rollup()
 RETURNS TABLE(job text, last_done jsonb, last_failed jsonb, queued integer, running integer)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH r AS (
    SELECT id, job, status, created_at, started_at, finished_at, error
    FROM public.college_crawl_runs WHERE created_at >= now() - interval '14 days'
  ), d AS (
    SELECT DISTINCT ON (job) job, jsonb_build_object('id', id, 'finished_at', finished_at, 'started_at', started_at) AS v
    FROM r WHERE status = 'done' ORDER BY job, created_at DESC
  ), f AS (
    SELECT DISTINCT ON (job) job, jsonb_build_object('id', id, 'finished_at', finished_at, 'error', error) AS v
    FROM r WHERE status = 'failed' ORDER BY job, created_at DESC
  ), c AS (
    SELECT job, count(*) FILTER (WHERE status = 'queued')::int AS q, count(*) FILTER (WHERE status = 'running')::int AS ru
    FROM r GROUP BY job
  )
  SELECT c.job, d.v, f.v, c.q, c.ru FROM c LEFT JOIN d USING (job) LEFT JOIN f USING (job)
$$;
REVOKE ALL ON FUNCTION public.college_job_rollup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_job_rollup() TO service_role;
