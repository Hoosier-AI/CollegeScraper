-- Advertising, sponsorship and data-access enquiries from the /advertise form (2026-10-16), read by the hub's Dealmaker
-- bot (Bots > Deals). Same table, limits and retention as the corrections form (migration 192); adds the company asking.
-- Re-runnable.
-- Rollback: DELETE FROM stats_requests WHERE kind IN ('advertising','sponsorship','data_access'); then re-add the 192
--   check (kind IN ('correction','removal','privacy','copyright','other')) and ALTER TABLE stats_requests DROP COLUMN company.

ALTER TABLE public.stats_requests ADD COLUMN IF NOT EXISTS company text;
ALTER TABLE public.stats_requests DROP CONSTRAINT IF EXISTS stats_requests_kind_check;
ALTER TABLE public.stats_requests ADD CONSTRAINT stats_requests_kind_check
  CHECK (kind IN ('correction', 'removal', 'privacy', 'copyright', 'other', 'advertising', 'sponsorship', 'data_access'));
