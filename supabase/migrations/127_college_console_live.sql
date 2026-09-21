-- Live stats from NCAA.com's in-game feed (a provisional box score per live game), and the owner's console:
-- persisted quality snapshots, API keys in the database with per-principal usage, per-host crawl health.

-- When the live job last stored a provisional NCAA box score for the game; nulled by the final fetch.
ALTER TABLE public.college_games ADD COLUMN IF NOT EXISTS live_stats_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_college_games_live_detail ON public.college_games(live_stats_at) WHERE status = 'live';

-- Quality checks are slow to compute; the nightly (and the console's "run now") store them so trends are visible.
CREATE TABLE IF NOT EXISTS public.college_quality_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid,
  games integer,
  finals integer,
  checks jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_college_quality_snapshots ON public.college_quality_snapshots(season, taken_at DESC);

-- Named API keys created from the console (env COLLEGE_API_KEYS still works). Only a hash is stored.
CREATE TABLE IF NOT EXISTS public.college_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  key_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

-- Requests per day per principal (key name, 'anon', 'site', 'admin'), flushed by the server once a minute.
CREATE TABLE IF NOT EXISTS public.college_api_usage (
  day date NOT NULL,
  principal text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  limited integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  PRIMARY KEY (day, principal)
);

CREATE OR REPLACE FUNCTION public.college_api_usage_add(p_day date, p_principal text, p_requests integer, p_limited integer, p_seen timestamptz)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.college_api_usage(day, principal, requests, limited, last_seen_at)
  VALUES (p_day, p_principal, p_requests, p_limited, p_seen)
  ON CONFLICT (day, principal) DO UPDATE
    SET requests = college_api_usage.requests + excluded.requests,
        limited = college_api_usage.limited + excluded.limited,
        last_seen_at = greatest(college_api_usage.last_seen_at, excluded.last_seen_at);
$$;

-- Crawl health per host from the fetch log (the console's Crawl tab).
CREATE OR REPLACE FUNCTION public.college_fetch_host_stats(p_since timestamptz)
RETURNS TABLE (host text, fetches bigint, errors bigint, status_429 bigint, last_error text, last_error_at timestamptz, retry_backlog bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT host,
         count(*) AS fetches,
         count(*) FILTER (WHERE error IS NOT NULL AND (status IS NULL OR status >= 500 OR status = 429)) AS errors,
         count(*) FILTER (WHERE status = 429) AS status_429,
         (array_agg(error ORDER BY fetched_at DESC) FILTER (WHERE error IS NOT NULL))[1] AS last_error,
         max(fetched_at) FILTER (WHERE error IS NOT NULL) AS last_error_at,
         count(*) FILTER (WHERE next_retry_at IS NOT NULL) AS retry_backlog
  FROM public.college_source_fetches
  WHERE fetched_at >= p_since
  GROUP BY host
  ORDER BY 2 DESC;
$$;

-- Run history is filtered by job in the console.
CREATE INDEX IF NOT EXISTS idx_college_runs_job_created ON public.college_crawl_runs(job, created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['college_quality_snapshots', 'college_api_keys', 'college_api_usage'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.college_api_usage_add(date, text, integer, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_api_usage_add(date, text, integer, integer, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.college_fetch_host_stats(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_fetch_host_stats(timestamptz) TO service_role;
