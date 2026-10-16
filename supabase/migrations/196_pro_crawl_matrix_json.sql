-- The Pro Crawling console read pro_crawl_matrix() a page of 1,000 rows at a time, three pages at once, and each page
-- ran the whole function: ~1.7 s each when written, 15-31 s each by 2026-10-15. With the hub's Crawling page open that
-- was about six full runs a minute, and with the season-wide ratings and aggregates beside them the database ran out
-- of memory and restarted (19:46 and 00:21 UTC). This returns the whole matrix in one value, computed once; the
-- service keeps it for 10 minutes (src/ops/proCrawlConsole.ts). Rollback: DROP FUNCTION pro_crawl_matrix_json().

CREATE OR REPLACE FUNCTION public.pro_crawl_matrix_json() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout TO '120s' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) FROM pro_crawl_matrix() m
$$;

REVOKE ALL ON FUNCTION public.pro_crawl_matrix_json() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_crawl_matrix_json() TO service_role;
