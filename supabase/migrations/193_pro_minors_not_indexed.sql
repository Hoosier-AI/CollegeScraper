-- No player pages for anyone under 18 (privacy policy; src/pro/minor.ts). The nightly rank job no longer marks a
-- player with a known birth date less than 18 years ago as indexable, so he leaves the sitemap; the page itself is a
-- short noindex notice (src/pro/queries.ts player()).
CREATE OR REPLACE FUNCTION public.pro_refresh_player_rank()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '600s'
AS $function$
DECLARE n integer := 0; k integer;
BEGIN
  WITH m AS (
    SELECT player_id, sum(minutes)::int AS mins FROM public.pro_player_season_stats
    WHERE season >= date_part('year', now())::int - 2 GROUP BY player_id
  ), sq AS (SELECT DISTINCT player_id FROM public.pro_squads),
  v AS (
    SELECT p.id, coalesce(m.mins, 0) AS mins,
      (coalesce(m.mins, 0) > 0 OR sq.player_id IS NOT NULL OR p.appeared)
        AND (p.birth_date IS NULL OR p.birth_date <= (current_date - interval '18 years')::date) AS idx
    FROM public.pro_players p LEFT JOIN m ON m.player_id = p.id LEFT JOIN sq ON sq.player_id = p.id
  )
  UPDATE public.pro_players p SET minutes_recent = v.mins, indexable = v.idx
  FROM v WHERE v.id = p.id AND (p.minutes_recent <> v.mins OR p.indexable <> v.idx);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  -- A club squad wins over a national-team squad; the most recently read squad wins between clubs.
  WITH s AS (
    SELECT DISTINCT ON (sq.player_id) sq.player_id, sq.team_id, sq.number
    FROM public.pro_squads sq LEFT JOIN public.pro_teams t ON t.id = sq.team_id
    ORDER BY sq.player_id, coalesce(t.national, false), sq.updated_at DESC
  )
  UPDATE public.pro_players p SET current_team_id = s.team_id, number = s.number
  FROM s WHERE s.player_id = p.id AND (p.current_team_id IS DISTINCT FROM s.team_id OR p.number IS DISTINCT FROM s.number);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $function$;

-- Now, without waiting for tonight's run.
UPDATE public.pro_players SET indexable = false WHERE indexable AND birth_date > (current_date - interval '18 years')::date;
