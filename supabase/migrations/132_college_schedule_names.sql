-- Fixture lists never show a nameless side. An opponent no program was matched to (a placeholder like "SUNYAC TBD",
-- a school we do not index, or a name a twin made ambiguous) came back with no name and no crest; the schedule line's
-- own opponent name now fills in. Crests for real schools without a stored logo were filled from NCAA.com's crest
-- address (2026-10-05, 210 schools) and discover-teams keeps doing so, so the view needs no logo fallback.
-- Same columns as 128. Rollback: re-run the view from 128.

CREATE OR REPLACE VIEW public.college_v_schedule WITH (security_invoker = true) AS
SELECT g.id, g.season, g.game_date, g.gender, g.division, g.status,
       g.home_program_id, coalesce(hp.name, g.home_name) AS home_name, hs.seo AS home_seo, hs.logo_svg_url AS home_logo,
       g.away_program_id, coalesce(ap.name, g.away_name) AS away_name, aws.seo AS away_seo, aws.logo_svg_url AS away_logo,
       g.home_score, g.away_score, g.overtime, g.shootout, g.neutral_site, g.conference_game, g.postseason,
       g.tournament, g.attendance, g.venue_name, g.venue_city, g.source_of_truth, g.ncaa_contest_id, g.forfeit,
       g.start_epoch, g.live_period, g.live_clock, g.live_updated_at,
       hp.short_name AS home_short_name, ap.short_name AS away_short_name,
       hps.conference_id AS home_conference_id, hc.name AS home_conference_name, hc.short_name AS home_conference_short, hps.division AS home_division,
       aps.conference_id AS away_conference_id, ac.name AS away_conference_name, ac.short_name AS away_conference_short, aps.division AS away_division,
       g.weather, g.weather_at
FROM public.college_games g
LEFT JOIN public.college_programs hp ON hp.id = g.home_program_id
LEFT JOIN public.college_schools hs ON hs.seo = hp.school_seo
LEFT JOIN public.college_programs ap ON ap.id = g.away_program_id
LEFT JOIN public.college_schools aws ON aws.seo = ap.school_seo
LEFT JOIN public.college_program_seasons hps ON hps.program_id = g.home_program_id AND hps.season = g.season
LEFT JOIN public.college_conferences hc ON hc.id = hps.conference_id
LEFT JOIN public.college_program_seasons aps ON aps.program_id = g.away_program_id AND aps.season = g.season
LEFT JOIN public.college_conferences ac ON ac.id = aps.conference_id;
