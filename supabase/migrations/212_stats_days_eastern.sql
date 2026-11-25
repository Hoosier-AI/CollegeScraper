-- The site's daily counters (page views, visitors, searches, API usage) are keyed by Eastern day from 2026-11-24
-- (src/api/analytics.ts, src/api/usage.ts): keyed by UTC day, everything after 7 PM Eastern showed in the hub as
-- tomorrow's. The two functions that reason about "today" run in the same zone.
ALTER FUNCTION public.stats_traffic(integer) SET timezone = 'America/New_York';
ALTER FUNCTION public.stats_visitors_add(jsonb) SET timezone = 'America/New_York';
