-- Plaibook Elo, corrected (2026-10-13, Evan: "it says US was the best in 2022 but we werent that good"): ratings no
-- longer creep upward (a side is provisional for its first 15 matches, see src/sources/intl/elo.ts), and a side's best
-- is its best world rank, comparable across eras, instead of its highest rating.
--   intl_elo_current.best_rank / best_rank_date   the best month-end world rank and the month it came
-- Additive; intl-elo fills them on its next run. Rollback: drop the two columns.

ALTER TABLE public.intl_elo_current ADD COLUMN IF NOT EXISTS best_rank integer;
ALTER TABLE public.intl_elo_current ADD COLUMN IF NOT EXISTS best_rank_date date;
