-- 204: the referee tables refresh inside the database (pg_cron), not through the REST API.
-- pro_refresh_referees (187) takes about 5 minutes; the service called it through PostgREST, whose gateway gave up
-- first ("upstream request timeout", every day 2026-10-16 to 10-21). The refresh still finished in the database, but
-- the job threw, so college_refresh_referees after it never ran and the college referee tables never refreshed.
-- Now two cron jobs (one failing never blocks the other); the service's daily `referees` job only reads how they went
-- through referees_refresh_status(). Rollback: SELECT cron.unschedule('pro-referees'), cron.unschedule('college-referees');
-- DROP FUNCTION referees_refresh_status(); the job then reports the cron runs missing (put back 187's job body).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;

-- 10:40 and 10:55 UTC, before the service's 11:10 check. cron.schedule with a name replaces an existing job.
SELECT cron.schedule('pro-referees', '40 10 * * *', 'SELECT public.pro_refresh_referees()');
SELECT cron.schedule('college-referees', '55 10 * * *', 'SELECT public.college_refresh_referees()');

-- The latest run of each referee job: status, when, and the message (an error's text when it failed).
CREATE OR REPLACE FUNCTION public.referees_refresh_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_object_agg(j.jobname, to_jsonb(r) - 'jobid' - 'runid'), '{}'::jsonb)
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT d.status, d.start_time, d.end_time, left(d.return_message, 300) AS message
    FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1
  ) r ON true
  WHERE j.jobname IN ('pro-referees', 'college-referees')
$$;
REVOKE ALL ON FUNCTION public.referees_refresh_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referees_refresh_status() TO service_role;
