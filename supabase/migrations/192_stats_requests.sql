-- Corrections and removal requests from the public form on /corrections (2026-10-15), plus pictures off for GDELT.
--   stats_requests: what a visitor asked (kind, page, details) and how to reply; the IP only as a salted hash (for the
--   per-IP limit of 5 an hour), never stored raw. Read and closed in the console (Requests); rows are deleted 12
--   months after they are closed (ops-retention job).
--   GDELT story pictures come from whichever outlet ran the story (copyright unknown): switched off by default.
-- Rollback: DROP TABLE stats_requests; UPDATE news_sources SET show_images = true WHERE kind = 'gdelt'.

CREATE TABLE IF NOT EXISTS public.stats_requests (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('correction', 'removal', 'privacy', 'copyright', 'other')),
  name text,
  email text NOT NULL,
  relation text,                       -- player, parent or guardian, school staff, other
  page_url text,
  details text NOT NULL,
  ip_hash text,
  user_agent text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'declined', 'spam')),
  note text,                           -- what was done (console)
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS stats_requests_open_idx ON public.stats_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS stats_requests_ip_idx ON public.stats_requests (ip_hash, created_at DESC);
ALTER TABLE public.stats_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stats_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stats_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stats_requests_id_seq TO service_role;

UPDATE public.news_sources SET show_images = false WHERE kind = 'gdelt';
