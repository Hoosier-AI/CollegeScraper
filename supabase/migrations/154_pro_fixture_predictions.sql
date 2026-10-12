-- API-Football's prediction for an upcoming match (2026-10-12, Evan: "predictions on match previews"): the chances of
-- a home win, a draw and an away win, and its side-by-side comparison (form, attack, defence, Poisson, head to head,
-- goals, total), one row per fixture, read again until kickoff. Shown on the match preview only; no betting advice.
-- Rollback: DROP TABLE public.pro_fixture_predictions.
CREATE TABLE IF NOT EXISTS public.pro_fixture_predictions (
  fixture_id  bigint PRIMARY KEY REFERENCES public.pro_fixtures(id) ON DELETE CASCADE,
  home_pct    smallint,
  draw_pct    smallint,
  away_pct    smallint,
  -- { "form": [home, away], "att": [..], "def": [..], "poisson_distribution": [..], "h2h": [..], "goals": [..], "total": [..] }, percentages
  comparison  jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pro_fixture_predictions_fetched ON public.pro_fixture_predictions (fetched_at);
ALTER TABLE public.pro_fixture_predictions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_fixture_predictions FROM anon, authenticated;
GRANT ALL ON public.pro_fixture_predictions TO service_role;
