-- Season simulations (2026-10-15): each college team's chances from the college-sims job (src/college/sim.ts), which
-- plays the rest of the season thousands of times with Plaibook Elo: winning the conference's regular season,
-- taking the automatic bid (conference tournament approximated as a four-team knockout), making the NCAA tournament
-- and being seeded (Division I only, by the simulated RPI), plus points now, the most still reachable, clinched,
-- eliminated and the leader's magic number. One row per program and season, replaced on every run.
-- Rollback: DROP TABLE college_sim_odds.

CREATE TABLE IF NOT EXISTS public.college_sim_odds (
  season integer NOT NULL,
  program_id uuid NOT NULL,
  gender text NOT NULL,
  division text NOT NULL,
  conference_id uuid,
  reg_title numeric(4, 3) NOT NULL,
  auto_bid numeric(4, 3) NOT NULL,
  bid numeric(4, 3),
  seed numeric(4, 3),
  avg_rank numeric(6, 1),
  avg_points numeric(6, 1) NOT NULL,
  points_now integer NOT NULL,
  max_points integer NOT NULL,
  conf_left integer NOT NULL,
  clinched boolean NOT NULL DEFAULT false,
  eliminated boolean NOT NULL DEFAULT false,
  magic integer,
  sims integer NOT NULL,
  run_at timestamptz NOT NULL,
  PRIMARY KEY (season, program_id)
);
CREATE INDEX IF NOT EXISTS college_sim_odds_scope_idx ON public.college_sim_odds (season, gender, division, bid DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS college_sim_odds_conf_idx ON public.college_sim_odds (season, conference_id);
ALTER TABLE public.college_sim_odds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.college_sim_odds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.college_sim_odds TO service_role;
