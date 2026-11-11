-- 207: a job that kills its worker is not retried forever, and a job cannot be queued twice.
--
-- 1. A run whose heartbeat stopped is claimed again. A job that crashes the worker every time (out of memory, a
--    poisoned input) was claimed again every 10 minutes without end, taking the lane down each time. Each claim now
--    counts; a run already claimed 3 times whose heartbeat stopped again is closed as failed instead.
-- 2. enqueue() reads for a twin and then inserts, so two requests at the same moment both inserted. One queued run
--    per (job, params) is now a rule of the table; enqueue() answers a conflict with the run that is already there.
-- Re-runnable.

ALTER TABLE public.college_crawl_runs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- Twins queued before the rule existed: keep the oldest.
DELETE FROM public.college_crawl_runs a USING public.college_crawl_runs b
 WHERE a.status = 'queued' AND b.status = 'queued' AND a.job = b.job AND a.params = b.params
   AND (b.created_at, b.id) < (a.created_at, a.id);

CREATE UNIQUE INDEX IF NOT EXISTS college_crawl_runs_one_queued
  ON public.college_crawl_runs (job, md5(params::text)) WHERE status = 'queued';

CREATE OR REPLACE FUNCTION public.college_claim_run(p_stale_minutes integer DEFAULT 10, p_jobs text[] DEFAULT NULL, p_exclude text[] DEFAULT NULL)
RETURNS SETOF public.college_crawl_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.college_crawl_runs;
BEGIN
  -- Runs in this lane that died for the third time: closed, not claimed.
  UPDATE college_crawl_runs
     SET status = 'failed', finished_at = now(),
         error = coalesce(error || ' | ', '') || 'stopped after 3 attempts: the worker died or stalled each time'
   WHERE status = 'running' AND attempts >= 3
     AND heartbeat_at < now() - make_interval(mins => p_stale_minutes)
     AND (p_jobs IS NULL OR job = ANY(p_jobs))
     AND (p_exclude IS NULL OR NOT (job = ANY(p_exclude)));

  SELECT * INTO r FROM college_crawl_runs
   WHERE (status = 'queued' OR (status = 'running' AND heartbeat_at < now() - make_interval(mins => p_stale_minutes)))
     AND (p_jobs IS NULL OR job = ANY(p_jobs))
     AND (p_exclude IS NULL OR NOT (job = ANY(p_exclude)))
   ORDER BY created_at
   FOR UPDATE SKIP LOCKED LIMIT 1;
  IF r.id IS NULL THEN RETURN; END IF;
  UPDATE college_crawl_runs SET status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now(), attempts = attempts + 1
   WHERE id = r.id RETURNING * INTO r;
  RETURN NEXT r;
END $$;
REVOKE ALL ON FUNCTION public.college_claim_run(integer, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_claim_run(integer, text[], text[]) TO service_role;
