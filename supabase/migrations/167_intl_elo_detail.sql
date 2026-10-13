-- Plaibook Elo, explained (2026-10-13, Evan: hover a year on the Elo chart and see the rating and why).
--   intl_elo gains each move's reasons: the score from this side's view (gf, ga), the opponent's rating before the
--     match, this side's expected score (0..1), the match weight k, the goal factor and the venue (home/away/neutral).
--   intl_elo_ranks: each side's month-end world ranks, [{m: '2009-06', r: 7}] (the chart's World rank view; its
--     minimum is intl_elo_current.best_rank).
-- Additive; intl-elo fills them on its next run (its method version changes). Rollback: drop the columns and table.

ALTER TABLE public.intl_elo ADD COLUMN IF NOT EXISTS gf smallint;
ALTER TABLE public.intl_elo ADD COLUMN IF NOT EXISTS ga smallint;
ALTER TABLE public.intl_elo ADD COLUMN IF NOT EXISTS opp_rating real;
ALTER TABLE public.intl_elo ADD COLUMN IF NOT EXISTS expected real;
ALTER TABLE public.intl_elo ADD COLUMN IF NOT EXISTS k smallint;
ALTER TABLE public.intl_elo ADD COLUMN IF NOT EXISTS goal_factor real;
ALTER TABLE public.intl_elo ADD COLUMN IF NOT EXISTS venue text;

CREATE TABLE IF NOT EXISTS public.intl_elo_ranks (
  gender text NOT NULL CHECK (gender IN ('m', 'w')),
  nation text NOT NULL,
  ranks jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gender, nation)
);
ALTER TABLE public.intl_elo_ranks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.intl_elo_ranks FROM anon, authenticated;
