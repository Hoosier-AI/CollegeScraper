-- Cookie-free analytics for the Stats site and a daily count of what the database holds (2026-10-13), for the hub's
-- Stats Overview and Traffic tabs. Visits are counted per day: page views per page (and its page type), referrer host,
-- device type, distinct visitors, and searches (with the ones that found nothing). No cookies, no addresses, no user
-- agents: the service keeps a salted visitor hash in memory for the day and writes only counts (src/api/analytics.ts).
-- Rollback: DROP FUNCTION stats_analytics_add(jsonb), stats_traffic(integer); DROP TABLE stats_views_daily,
-- stats_referrers_daily, stats_devices_daily, stats_visitors_daily, stats_searches_daily, stats_daily_counts.

CREATE TABLE IF NOT EXISTS public.stats_views_daily (
  day date NOT NULL, path text NOT NULL, page_group text NOT NULL, views integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
CREATE TABLE IF NOT EXISTS public.stats_referrers_daily (day date NOT NULL, host text NOT NULL, views integer NOT NULL DEFAULT 0, PRIMARY KEY (day, host));
CREATE TABLE IF NOT EXISTS public.stats_devices_daily (day date NOT NULL, device text NOT NULL, views integer NOT NULL DEFAULT 0, PRIMARY KEY (day, device));
CREATE TABLE IF NOT EXISTS public.stats_visitors_daily (day date PRIMARY KEY, uniques integer NOT NULL DEFAULT 0, views integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS public.stats_searches_daily (
  day date NOT NULL, scope text NOT NULL, query text NOT NULL, searches integer NOT NULL DEFAULT 0, zero_results integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, scope, query)
);
-- One row a day: the content counts the hub charts (college games and box scores, pro matches, players, links ...).
CREATE TABLE IF NOT EXISTS public.stats_daily_counts (day date PRIMARY KEY, counts jsonb NOT NULL, taken_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE public.stats_views_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stats_referrers_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stats_devices_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stats_visitors_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stats_searches_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stats_daily_counts ENABLE ROW LEVEL SECURITY;

-- One flush from the service: {views:[{day,path,group,n}], refs:[{day,host,n}], devices:[{day,device,n}],
-- visitors:[{day,uniques,views}], searches:[{day,scope,query,n,zero}]}. Adds to whatever the day already has.
CREATE OR REPLACE FUNCTION public.stats_analytics_add(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO stats_views_daily(day, path, page_group, views)
  SELECT (x->>'day')::date, x->>'path', x->>'group', (x->>'n')::int FROM jsonb_array_elements(coalesce(p->'views', '[]')) x
  ON CONFLICT (day, path) DO UPDATE SET views = stats_views_daily.views + excluded.views, page_group = excluded.page_group;

  INSERT INTO stats_referrers_daily(day, host, views)
  SELECT (x->>'day')::date, x->>'host', (x->>'n')::int FROM jsonb_array_elements(coalesce(p->'refs', '[]')) x
  ON CONFLICT (day, host) DO UPDATE SET views = stats_referrers_daily.views + excluded.views;

  INSERT INTO stats_devices_daily(day, device, views)
  SELECT (x->>'day')::date, x->>'device', (x->>'n')::int FROM jsonb_array_elements(coalesce(p->'devices', '[]')) x
  ON CONFLICT (day, device) DO UPDATE SET views = stats_devices_daily.views + excluded.views;

  INSERT INTO stats_visitors_daily(day, uniques, views)
  SELECT (x->>'day')::date, (x->>'uniques')::int, (x->>'views')::int FROM jsonb_array_elements(coalesce(p->'visitors', '[]')) x
  ON CONFLICT (day) DO UPDATE SET uniques = stats_visitors_daily.uniques + excluded.uniques, views = stats_visitors_daily.views + excluded.views;

  INSERT INTO stats_searches_daily(day, scope, query, searches, zero_results)
  SELECT (x->>'day')::date, x->>'scope', x->>'query', (x->>'n')::int, (x->>'zero')::int FROM jsonb_array_elements(coalesce(p->'searches', '[]')) x
  ON CONFLICT (day, scope, query) DO UPDATE SET searches = stats_searches_daily.searches + excluded.searches, zero_results = stats_searches_daily.zero_results + excluded.zero_results;
END $$;

-- The Traffic tab in one read: per-day visitors and views, top pages and page types, referrers, devices, searches
-- and the searches that found nothing, over the last p_days days (today included).
CREATE OR REPLACE FUNCTION public.stats_traffic(p_days integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH since AS (SELECT (current_date - greatest(1, least(p_days, 400)) + 1) AS d)
  SELECT jsonb_build_object(
    'days', coalesce((SELECT jsonb_agg(jsonb_build_object('day', day, 'uniques', uniques, 'views', views) ORDER BY day) FROM stats_visitors_daily, since WHERE day >= since.d), '[]'),
    'pages', coalesce((SELECT jsonb_agg(t) FROM (SELECT path, max(page_group) AS page_group, sum(views)::int AS views FROM stats_views_daily, since WHERE day >= since.d AND path <> '(other)' GROUP BY path ORDER BY sum(views) DESC LIMIT 30) t), '[]'),
    'groups', coalesce((SELECT jsonb_agg(t) FROM (SELECT page_group, sum(views)::int AS views FROM stats_views_daily, since WHERE day >= since.d GROUP BY page_group ORDER BY sum(views) DESC) t), '[]'),
    'referrers', coalesce((SELECT jsonb_agg(t) FROM (SELECT host, sum(views)::int AS views FROM stats_referrers_daily, since WHERE day >= since.d GROUP BY host ORDER BY sum(views) DESC LIMIT 20) t), '[]'),
    'devices', coalesce((SELECT jsonb_agg(t) FROM (SELECT device, sum(views)::int AS views FROM stats_devices_daily, since WHERE day >= since.d GROUP BY device ORDER BY sum(views) DESC) t), '[]'),
    'searches', coalesce((SELECT jsonb_agg(t) FROM (SELECT scope, query, sum(searches)::int AS searches, sum(zero_results)::int AS zero_results FROM stats_searches_daily, since WHERE day >= since.d GROUP BY scope, query ORDER BY sum(searches) DESC LIMIT 30) t), '[]'),
    'zero', coalesce((SELECT jsonb_agg(t) FROM (SELECT scope, query, sum(zero_results)::int AS searches, max(day) AS last_day FROM stats_searches_daily, since WHERE day >= since.d AND zero_results > 0 GROUP BY scope, query ORDER BY sum(zero_results) DESC, max(day) DESC LIMIT 30) t), '[]'),
    'search_days', coalesce((SELECT jsonb_agg(t ORDER BY day) FROM (SELECT day, sum(searches)::int AS searches, sum(zero_results)::int AS zero_results FROM stats_searches_daily, since WHERE day >= since.d GROUP BY day) t), '[]'),
    'section_days', coalesce((SELECT jsonb_agg(t ORDER BY day) FROM (
      SELECT day,
        sum(views) FILTER (WHERE page_group LIKE 'College%' OR page_group = 'Search')::int AS college,
        sum(views) FILTER (WHERE page_group LIKE 'Pro%' OR page_group IN ('College to Pro', 'Americans abroad'))::int AS pro
      FROM stats_views_daily, since WHERE day >= since.d GROUP BY day) t), '[]')
  );
$$;

REVOKE ALL ON FUNCTION public.stats_analytics_add(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stats_analytics_add(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.stats_traffic(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stats_traffic(integer) TO service_role;
