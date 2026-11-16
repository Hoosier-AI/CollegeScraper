-- 208: tournament games marked as such, with rounds, seeds and bracket slots (2026-11-16).
--
-- Until now no game was ever postseason: NCAA.com's championship flags were parsed and dropped, school box scores
-- reset the flag, and conference tournaments are flagged by no source. reconcile-games then counted every
-- conference-tournament game as a regular-season conference game (conference tables, titles and the sims with it).
--   - NCAA tournament games: sweep-scoreboard writes them from NCAA.com (isChampionship, bracketId, roundNumber,
--     roundDescription, seeds), postseason_source 'ncaa';
--   - conference tournaments: classify-postseason finds them from the games (src/college/postseason.ts),
--     postseason_source 'inferred'.
-- bracket_slot is NCAA.com's bracketId (round * 100 + position; position i feeds position ceil(i/2) next round).
-- shootout_winner: the side that won a level knockout game on penalties (box-score shootout goals, else who played on).
-- college_sim_odds.rounds: once the NCAA field is out, each team's chance to reach each round, [round 2, ..., champion].
-- Re-runnable.

ALTER TABLE public.college_games
  ADD COLUMN IF NOT EXISTS tournament_round text,
  ADD COLUMN IF NOT EXISTS round_number smallint,
  ADD COLUMN IF NOT EXISTS home_seed smallint,
  ADD COLUMN IF NOT EXISTS away_seed smallint,
  ADD COLUMN IF NOT EXISTS bracket_slot integer,
  ADD COLUMN IF NOT EXISTS shootout_winner uuid REFERENCES public.college_programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS postseason_source text,
  ADD COLUMN IF NOT EXISTS tournament_conference_id uuid REFERENCES public.college_conferences(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.college_games ADD CONSTRAINT college_games_postseason_source_chk CHECK (postseason_source IS NULL OR postseason_source IN ('ncaa', 'inferred', 'site'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_college_games_postseason ON public.college_games (season, gender, division) WHERE postseason;
CREATE INDEX IF NOT EXISTS idx_college_games_tournament_conf ON public.college_games (season, tournament_conference_id) WHERE tournament_conference_id IS NOT NULL;

ALTER TABLE public.college_sim_odds ADD COLUMN IF NOT EXISTS rounds jsonb;

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
       g.weather, g.weather_at, g.broadcast, g.watch_url,
       g.tournament_round, g.round_number, g.home_seed, g.away_seed, g.bracket_slot, g.shootout_winner, g.tournament_conference_id
FROM public.college_games g
LEFT JOIN public.college_programs hp ON hp.id = g.home_program_id
LEFT JOIN public.college_schools hs ON hs.seo = hp.school_seo
LEFT JOIN public.college_programs ap ON ap.id = g.away_program_id
LEFT JOIN public.college_schools aws ON aws.seo = ap.school_seo
LEFT JOIN public.college_program_seasons hps ON hps.program_id = g.home_program_id AND hps.season = g.season
LEFT JOIN public.college_conferences hc ON hc.id = hps.conference_id
LEFT JOIN public.college_program_seasons aps ON aps.program_id = g.away_program_id AND aps.season = g.season
LEFT JOIN public.college_conferences ac ON ac.id = aps.conference_id;

notify pgrst, 'reload schema';
