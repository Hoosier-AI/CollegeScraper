-- The hub's Crawling page: every request to every site the pro crawl reads, and which source supplies what.
--
-- * pro_source_requests: requests per day, source and host, counted by the HTTP clients (src/ops/sourceRequests.ts)
--   and flushed every 30 s through pro_source_requests_add. Source fetches are never stored in
--   college_source_fetches (noStore), and that table keeps one row per URL anyway, so until now nothing said how
--   much each site was asked.
-- * pro_crawl_matrix(): per league season, how many fixtures, tables and player rows each source supplied, the
--   match detail and club season stats, and each scraped source's sync of that season.
-- Rollback: drop the two functions and the table.

CREATE TABLE IF NOT EXISTS public.pro_source_requests (
  day date NOT NULL,
  source text NOT NULL,
  host text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  not_modified integer NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  last_at timestamptz,
  last_error text,
  PRIMARY KEY (day, source, host)
);
ALTER TABLE public.pro_source_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pro_source_requests FROM anon, authenticated;

-- p_rows: [{day, source, host, requests, errors, not_modified, bytes, last_at, last_error}], added to what is there.
CREATE OR REPLACE FUNCTION public.pro_source_requests_add(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO pro_source_requests AS t (day, source, host, requests, errors, not_modified, bytes, last_at, last_error)
  SELECT r.day, r.source, r.host, coalesce(r.requests, 0), coalesce(r.errors, 0), coalesce(r.not_modified, 0), coalesce(r.bytes, 0), r.last_at, r.last_error
    FROM jsonb_to_recordset(p_rows) AS r(day date, source text, host text, requests integer, errors integer, not_modified integer, bytes bigint, last_at timestamptz, last_error text)
  ON CONFLICT (day, source, host) DO UPDATE SET
    requests = t.requests + EXCLUDED.requests, errors = t.errors + EXCLUDED.errors, not_modified = t.not_modified + EXCLUDED.not_modified,
    bytes = t.bytes + EXCLUDED.bytes, last_at = greatest(t.last_at, EXCLUDED.last_at), last_error = coalesce(EXCLUDED.last_error, t.last_error);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pro_source_requests_add(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_source_requests_add(jsonb) TO service_role;

-- League seasons in view: the current and last season of every enabled league, every season of a US league, and any
-- season a scraped source has synced.
CREATE OR REPLACE FUNCTION public.pro_crawl_matrix()
RETURNS TABLE (league_id integer, season integer, fixtures integer, fixtures_by jsonb, finals integer, detailed integer,
  table_by text, table_rows integer, players_by jsonb, club_stats integer, src jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ls AS (
    SELECT s.league_id, s.season FROM pro_seasons s JOIN pro_leagues l ON l.id = s.league_id
     WHERE l.enabled AND (s.season >= coalesce(l.current_season, date_part('year', now())::int) - 1 OR l.country = 'USA')
    UNION
    SELECT ss.league_id, ss.season FROM pro_source_seasons ss
  ), fx AS (
    SELECT f.league_id, f.season, coalesce(f.source, 'api-football') AS source, count(*)::int AS n,
           count(*) FILTER (WHERE f.status = 'final')::int AS finals, count(*) FILTER (WHERE f.detail_fetched_at IS NOT NULL)::int AS detailed
      FROM pro_fixtures f GROUP BY 1, 2, 3
  ), fxa AS (
    SELECT fx.league_id, fx.season, sum(fx.n)::int AS fixtures, jsonb_object_agg(fx.source, fx.n) AS fixtures_by,
           sum(fx.finals)::int AS finals, sum(fx.detailed)::int AS detailed
      FROM fx GROUP BY 1, 2
  ), st AS (
    SELECT p.league_id, p.season, min(coalesce(p.source, 'api-football')) AS table_by, count(*)::int AS table_rows
      FROM pro_standings p GROUP BY 1, 2
  ), pl AS (
    SELECT x.league_id, x.season, jsonb_object_agg(x.source, x.n) AS players_by
      FROM (SELECT ps.league_id, ps.season, ps.source, count(*)::int AS n FROM pro_player_season_stats ps GROUP BY 1, 2, 3) x GROUP BY 1, 2
  ), cs AS (
    SELECT d.league_id, d.season, count(*)::int AS club_stats FROM pro_team_season_detail d GROUP BY 1, 2
  ), src AS (
    SELECT ss.league_id, ss.season,
           jsonb_object_agg(ss.source, jsonb_build_object('synced_at', ss.synced_at, 'games', ss.games, 'player_rows', ss.player_rows, 'last_error', ss.last_error)) AS src
      FROM pro_source_seasons ss GROUP BY 1, 2
  )
  SELECT ls.league_id, ls.season, coalesce(fxa.fixtures, 0), coalesce(fxa.fixtures_by, '{}'::jsonb), coalesce(fxa.finals, 0), coalesce(fxa.detailed, 0),
         st.table_by, coalesce(st.table_rows, 0), coalesce(pl.players_by, '{}'::jsonb), coalesce(cs.club_stats, 0), coalesce(src.src, '{}'::jsonb)
    FROM ls
    LEFT JOIN fxa ON fxa.league_id = ls.league_id AND fxa.season = ls.season
    LEFT JOIN st ON st.league_id = ls.league_id AND st.season = ls.season
    LEFT JOIN pl ON pl.league_id = ls.league_id AND pl.season = ls.season
    LEFT JOIN cs ON cs.league_id = ls.league_id AND cs.season = ls.season
    LEFT JOIN src ON src.league_id = ls.league_id AND src.season = ls.season;
$$;
REVOKE ALL ON FUNCTION public.pro_crawl_matrix() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_crawl_matrix() TO service_role;
