-- Search: a name that contains what was typed comes before a fuzzy match ("morris": Jordan, Jake and Aidan Morris
-- before "M. Parris"), then the US-first order of 155. Rollback: 155's pro_search.
CREATE OR REPLACE FUNCTION public.pro_search(p_q text, p_limit integer DEFAULT 8)
 RETURNS TABLE(kind text, id bigint, name text, slug text, sub text, logo text, score real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH q AS (SELECT lower(trim(p_q)) AS t),
  us_teams AS (
    SELECT DISTINCT lt.team_id FROM public.pro_league_teams lt JOIN public.pro_leagues l ON l.id = lt.league_id AND lt.season = l.current_season
     WHERE l.enabled AND public.pro_us_league(l.id, l.country)
  )
  (SELECT 'league', l.id::bigint, l.name, l.slug, l.country, l.logo, similarity(lower(l.name), q.t)
     FROM public.pro_leagues l, q WHERE l.enabled AND (lower(l.name) % q.t OR lower(l.name) LIKE '%' || q.t || '%')
     ORDER BY lower(l.name) = q.t DESC, public.pro_us_league(l.id, l.country) DESC, l.priority, similarity(lower(l.name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'team', t.id::bigint, t.display_name, t.slug, t.country, t.logo, similarity(lower(t.display_name), q.t)
     FROM public.pro_teams t, q WHERE lower(t.display_name) % q.t OR lower(t.display_name) LIKE q.t || '%' OR lower(t.display_name) LIKE '% ' || q.t || '%'
     ORDER BY lower(t.display_name) = q.t DESC, lower(t.display_name) LIKE '%' || q.t || '%' DESC, EXISTS (SELECT 1 FROM us_teams u WHERE u.team_id = t.id) DESC,
       EXISTS (SELECT 1 FROM public.pro_league_teams lt WHERE lt.team_id = t.id) DESC,
       similarity(lower(t.display_name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'player', p.id::bigint, p.display_name, p.slug, p.nationality, p.photo, similarity(lower(p.display_name), q.t)
     FROM public.pro_players p, q WHERE NOT p.noindex AND (lower(p.display_name) % q.t OR lower(p.display_name) LIKE q.t || '%')
     ORDER BY lower(p.display_name) = q.t DESC, lower(p.display_name) LIKE '%' || q.t || '%' DESC, (p.minutes_recent > 0) DESC,
       (p.nationality = 'USA' OR EXISTS (SELECT 1 FROM us_teams u WHERE u.team_id = p.current_team_id)) DESC,
       similarity(lower(p.display_name), q.t) DESC, p.minutes_recent DESC LIMIT p_limit)
$function$;
REVOKE ALL ON FUNCTION public.pro_search(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_search(text, integer) TO service_role;
