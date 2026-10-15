-- Traffic by section in three parts (2026-10-15): International's pages ('International home', 'International match'...)
-- get their own column in stats_traffic's section_days instead of counting as Pro, for the hub's Traffic tab.
-- Same function as migration 163 otherwise; re-runnable. Rollback: re-run 163's stats_traffic.

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
        sum(views) FILTER (WHERE (page_group LIKE 'College%' AND page_group <> 'College to Pro') OR page_group = 'Search')::int AS college,
        sum(views) FILTER (WHERE page_group LIKE 'Pro%' OR page_group IN ('College to Pro', 'Americans abroad'))::int AS pro,
        sum(views) FILTER (WHERE page_group LIKE 'International%')::int AS intl
      FROM stats_views_daily, since WHERE day >= since.d GROUP BY day) t), '[]')
  );
$$;

REVOKE ALL ON FUNCTION public.stats_traffic(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stats_traffic(integer) TO service_role;
