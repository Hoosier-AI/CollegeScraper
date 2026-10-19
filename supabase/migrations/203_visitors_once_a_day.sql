-- 203: a visitor counts once a day, whatever restarts. The distinct-visitor set lived only in the web process, with a
-- salt that changed on every start: each deploy (ten a day at times) counted every visitor again. Now the one-way
-- daily code (IP + browser + a server secret that differs every day, never the IP itself) is kept in
-- stats_visitor_seen for the day and deleted the day after; stats_visitors_add counts a code once and adds the day's
-- page views. Rollback: drop the function and the table (the service falls back to stats_analytics_add's visitors).
CREATE TABLE IF NOT EXISTS public.stats_visitor_seen (day date NOT NULL, who text NOT NULL, PRIMARY KEY (day, who));
ALTER TABLE public.stats_visitor_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stats_visitor_seen FROM anon, authenticated;

-- p: [{day, views, who: [code, ...]}]
CREATE OR REPLACE FUNCTION public.stats_visitors_add(p jsonb) RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE x jsonb; fresh integer; total integer := 0;
BEGIN
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p, '[]')) LOOP
    INSERT INTO stats_visitor_seen (day, who)
    SELECT (x->>'day')::date, w FROM jsonb_array_elements_text(coalesce(x->'who', '[]')) w
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS fresh = ROW_COUNT;
    INSERT INTO stats_visitors_daily (day, uniques, views) VALUES ((x->>'day')::date, fresh, coalesce((x->>'views')::int, 0))
    ON CONFLICT (day) DO UPDATE SET uniques = stats_visitors_daily.uniques + excluded.uniques, views = stats_visitors_daily.views + excluded.views;
    total := total + fresh;
  END LOOP;
  -- Codes are kept for their own day only (the day after, for a late flush), then gone.
  DELETE FROM stats_visitor_seen WHERE day < current_date - 1;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.stats_visitors_add(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stats_visitors_add(jsonb) TO service_role;
