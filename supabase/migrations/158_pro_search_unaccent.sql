-- Accent-free search (2026-10-12): "pulisic" did not find Christian Pulišić, nor "atletico" Atlético. Names are
-- compared lowercased and without accents (unaccent), with trigram indexes on that form; the lowered-name indexes of
-- 155 are dropped (nothing reads them any more). Rollback: 157's pro_search, drop the pro_fold indexes and function.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

-- unaccent() is only STABLE (it reads a dictionary); fixing the dictionary makes it safe to index.
CREATE OR REPLACE FUNCTION public.pro_fold(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;

CREATE OR REPLACE FUNCTION public.pro_search(p_q text, p_limit integer DEFAULT 8)
 RETURNS TABLE(kind text, id bigint, name text, slug text, sub text, logo text, score real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH q AS (SELECT public.pro_fold(trim(p_q)) AS t),
  us_teams AS (
    SELECT DISTINCT lt.team_id FROM public.pro_league_teams lt JOIN public.pro_leagues l ON l.id = lt.league_id AND lt.season = l.current_season
     WHERE l.enabled AND public.pro_us_league(l.id, l.country)
  )
  (SELECT 'league', l.id::bigint, l.name, l.slug, l.country, l.logo, similarity(public.pro_fold(l.name), q.t)
     FROM public.pro_leagues l, q WHERE l.enabled AND (public.pro_fold(l.name) % q.t OR public.pro_fold(l.name) LIKE '%' || q.t || '%')
     ORDER BY public.pro_fold(l.name) = q.t DESC, public.pro_us_league(l.id, l.country) DESC, l.priority, similarity(public.pro_fold(l.name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'team', t.id::bigint, t.display_name, t.slug, t.country, t.logo, similarity(public.pro_fold(t.display_name), q.t)
     FROM public.pro_teams t, q WHERE public.pro_fold(t.display_name) % q.t OR public.pro_fold(t.display_name) LIKE q.t || '%' OR public.pro_fold(t.display_name) LIKE '% ' || q.t || '%'
     ORDER BY public.pro_fold(t.display_name) = q.t DESC, public.pro_fold(t.display_name) LIKE '%' || q.t || '%' DESC, EXISTS (SELECT 1 FROM us_teams u WHERE u.team_id = t.id) DESC,
       EXISTS (SELECT 1 FROM public.pro_league_teams lt WHERE lt.team_id = t.id) DESC,
       similarity(public.pro_fold(t.display_name), q.t) DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'player', p.id::bigint, p.display_name, p.slug, p.nationality, p.photo, similarity(public.pro_fold(p.display_name), q.t)
     FROM public.pro_players p, q WHERE NOT p.noindex AND (public.pro_fold(p.display_name) % q.t OR public.pro_fold(p.display_name) LIKE q.t || '%')
     ORDER BY public.pro_fold(p.display_name) = q.t DESC, public.pro_fold(p.display_name) LIKE '%' || q.t || '%' DESC, (p.minutes_recent > 0) DESC,
       (p.nationality = 'USA' OR EXISTS (SELECT 1 FROM us_teams u WHERE u.team_id = p.current_team_id)) DESC,
       similarity(public.pro_fold(p.display_name), q.t) DESC, p.minutes_recent DESC LIMIT p_limit)
$function$;
REVOKE ALL ON FUNCTION public.pro_search(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_search(text, integer) TO service_role;

-- Run these outside a transaction, one at a time.
CREATE INDEX CONCURRENTLY IF NOT EXISTS pro_players_fold_trgm ON public.pro_players USING gin (public.pro_fold(display_name) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS pro_teams_fold_trgm ON public.pro_teams USING gin (public.pro_fold(display_name) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS pro_leagues_fold_trgm ON public.pro_leagues USING gin (public.pro_fold(name) gin_trgm_ops);
DROP INDEX CONCURRENTLY IF EXISTS public.pro_players_lname_trgm;
DROP INDEX CONCURRENTLY IF EXISTS public.pro_teams_lname_trgm;
DROP INDEX CONCURRENTLY IF EXISTS public.pro_leagues_lname_trgm;
