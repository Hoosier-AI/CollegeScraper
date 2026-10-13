-- 168: national teams that the provider also lists in a club competition (2026-10-13).
--
-- pro_refresh_intl_teams() (migration 164) marked a side national only if it had never appeared in club football. The
-- provider's stray entries broke that for senior nations: Spain is a member of South Africa's domestic Cup for 2023
-- (no match), Liberia of a Primera División, and the China Cup (a national-team invitational) was filed as a club
-- competition, so Uruguay, Croatia, Wales, Czechia, Iceland, Chile, Thailand, Uzbekistan and China counted as clubs:
-- their pages had no flag and no history and showed a Transfers tab.
--
-- Now a side is national when it is flagged national or seen in an international competition, and either has never
-- appeared in club football or has played more international matches than club ones (a club in an invitational
-- stays a club: Konyaspor, flagged national by the provider, has hundreds of club matches and no internationals).
-- Previewed on prod before applying: 352 sides become national (Spain, Uruguay, the China Cup nations, Liberia, Hong
-- Kong, and youth sides added since the last refresh), none stop being national; the only ones with club matches are
-- Hong Kong, Qatar U23, Saudi Arabia U20, Morocco U20 and Chile U20.

UPDATE public.pro_leagues SET scope = 'intl', level = 'senior', confederation = 'AFC'
 WHERE id = 766 AND (scope, level, confederation) IS DISTINCT FROM ('intl', 'senior', 'AFC');

CREATE OR REPLACE FUNCTION public.pro_refresh_intl_teams() RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public' SET statement_timeout TO '300s' AS $$
DECLARE n integer;
BEGIN
  WITH fx AS (
    -- Matches per side in each kind of competition.
    SELECT team_id, count(*) FILTER (WHERE scope = 'intl') AS intl_n, count(*) FILTER (WHERE scope = 'club') AS club_n FROM (
      SELECT f.home_team_id AS team_id, l.scope FROM public.pro_fixtures f JOIN public.pro_leagues l ON l.id = f.league_id
      UNION ALL
      SELECT f.away_team_id, l.scope FROM public.pro_fixtures f JOIN public.pro_leagues l ON l.id = f.league_id
    ) x GROUP BY team_id
  ),
  mem AS (
    -- Season memberships (a side can be listed without a match).
    SELECT lt.team_id, bool_or(l.scope = 'intl') AS in_intl, bool_or(l.scope = 'club') AS in_club
      FROM public.pro_league_teams lt JOIN public.pro_leagues l ON l.id = lt.league_id GROUP BY lt.team_id
  ),
  nat AS (
    SELECT t.id FROM public.pro_teams t LEFT JOIN fx ON fx.team_id = t.id LEFT JOIN mem ON mem.team_id = t.id
     WHERE (t.national OR coalesce(fx.intl_n, 0) > 0 OR coalesce(mem.in_intl, false))
       AND ((coalesce(fx.club_n, 0) = 0 AND NOT coalesce(mem.in_club, false)) OR coalesce(fx.club_n, 0) < coalesce(fx.intl_n, 0))
  )
  UPDATE public.pro_teams t SET intl = (t.id IN (SELECT id FROM nat))
   WHERE t.intl IS DISTINCT FROM (t.id IN (SELECT id FROM nat));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pro_refresh_intl_teams() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_refresh_intl_teams() TO service_role;

SELECT public.pro_refresh_intl_teams();
