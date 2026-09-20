-- Live scores (period and clock from NCAA.com's scoreboard), a schedule view with kickoff time and conference ids,
-- and worker lanes so the 3-minute live job never queues behind the 30-minute crawl.

ALTER TABLE public.college_games
  ADD COLUMN IF NOT EXISTS live_period text,        -- NCAA currentPeriod as printed: '1ST HALF', 'HALFTIME', '2ND HALF', 'OT', 'FINAL'
  ADD COLUMN IF NOT EXISTS live_clock text,         -- NCAA contestClock 'MM:SS' (counts up)
  ADD COLUMN IF NOT EXISTS live_updated_at timestamptz;

-- The live gate and the live job read "unfinished games on these dates".
CREATE INDEX IF NOT EXISTS idx_college_games_pending
  ON public.college_games(game_date, start_epoch) WHERE status IN ('scheduled','live');

-- Appended columns only, so CREATE OR REPLACE VIEW is allowed; the original list is repeated verbatim from 124.
CREATE OR REPLACE VIEW public.college_v_schedule WITH (security_invoker = true) AS
SELECT g.id, g.season, g.game_date, g.gender, g.division, g.status,
       g.home_program_id, hp.name AS home_name, hs.seo AS home_seo, hs.logo_svg_url AS home_logo,
       g.away_program_id, ap.name AS away_name, aws.seo AS away_seo, aws.logo_svg_url AS away_logo,
       g.home_score, g.away_score, g.overtime, g.shootout, g.neutral_site, g.conference_game, g.postseason,
       g.tournament, g.attendance, g.venue_name, g.venue_city, g.source_of_truth, g.ncaa_contest_id, g.forfeit,
       g.start_epoch, g.live_period, g.live_clock, g.live_updated_at,
       hp.short_name AS home_short_name, ap.short_name AS away_short_name,
       hps.conference_id AS home_conference_id, hc.name AS home_conference_name, hc.short_name AS home_conference_short, hps.division AS home_division,
       aps.conference_id AS away_conference_id, ac.name AS away_conference_name, ac.short_name AS away_conference_short, aps.division AS away_division
FROM public.college_games g
LEFT JOIN public.college_programs hp ON hp.id = g.home_program_id
LEFT JOIN public.college_schools hs ON hs.seo = hp.school_seo
LEFT JOIN public.college_programs ap ON ap.id = g.away_program_id
LEFT JOIN public.college_schools aws ON aws.seo = ap.school_seo
LEFT JOIN public.college_program_seasons hps ON hps.program_id = g.home_program_id AND hps.season = g.season
LEFT JOIN public.college_conferences hc ON hc.id = hps.conference_id
LEFT JOIN public.college_program_seasons aps ON aps.program_id = g.away_program_id AND aps.season = g.season
LEFT JOIN public.college_conferences ac ON ac.id = aps.conference_id;

-- Worker lanes: the main loop claims everything except 'live'; a second loop claims only 'live'.
-- The one-argument overload is dropped first so rpc('college_claim_run', {p_stale_minutes}) stays unambiguous.
DROP FUNCTION IF EXISTS public.college_claim_run(integer);
CREATE OR REPLACE FUNCTION public.college_claim_run(p_stale_minutes integer DEFAULT 10, p_jobs text[] DEFAULT NULL, p_exclude text[] DEFAULT NULL)
RETURNS SETOF public.college_crawl_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.college_crawl_runs;
BEGIN
  SELECT * INTO r FROM college_crawl_runs
   WHERE (status = 'queued' OR (status = 'running' AND heartbeat_at < now() - make_interval(mins => p_stale_minutes)))
     AND (p_jobs IS NULL OR job = ANY(p_jobs))
     AND (p_exclude IS NULL OR NOT (job = ANY(p_exclude)))
   ORDER BY created_at
   FOR UPDATE SKIP LOCKED LIMIT 1;
  IF r.id IS NULL THEN RETURN; END IF;
  UPDATE college_crawl_runs SET status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now()
   WHERE id = r.id RETURNING * INTO r;
  RETURN NEXT r;
END $$;
REVOKE ALL ON FUNCTION public.college_claim_run(integer, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_claim_run(integer, text[], text[]) TO service_role;
