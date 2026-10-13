-- 169: a national side's gender from its international matches (2026-10-13).
--
-- pro_teams.gender is the gender of the competition a team was last seen in, so one stray "Friendlies Women" fixture
-- made the Central African Republic's men's side (55 men's internationals) a women's one: the men's nation had no
-- team, no flag and no history. pro_refresh_intl_teams() (daily, intl-refresh) now also sets a national side's
-- gender when 90% of its 10+ internationals say so. Previewed on prod: only the Central African Republic changes.

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
  -- A national side's men's or women's from its international matches (those competitions' genders are right): a
  -- team row takes the gender of the last competition it was seen in, and one stray "Friendlies Women" fixture made
  -- the Central African Republic's men's side a women's one (55 men's internationals to 1). Only a clear call: 10+
  -- internationals, 90% of them one way. The slug trigger follows.
  WITH g AS (
    SELECT team_id, count(*) FILTER (WHERE gender = 'm') AS m, count(*) FILTER (WHERE gender = 'w') AS w FROM (
      SELECT f.home_team_id AS team_id, l.gender FROM public.pro_fixtures f JOIN public.pro_leagues l ON l.id = f.league_id AND l.scope = 'intl'
      UNION ALL
      SELECT f.away_team_id, l.gender FROM public.pro_fixtures f JOIN public.pro_leagues l ON l.id = f.league_id AND l.scope = 'intl'
    ) x GROUP BY team_id
  ), want AS (
    SELECT team_id, CASE WHEN m >= 9 * w THEN 'm' ELSE 'w' END AS gender FROM g WHERE m + w >= 10 AND (m >= 9 * w OR w >= 9 * m)
  )
  UPDATE public.pro_teams t SET gender = want.gender FROM want
   WHERE t.id = want.team_id AND t.intl AND t.gender IS DISTINCT FROM want.gender;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pro_refresh_intl_teams() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_refresh_intl_teams() TO service_role;

SELECT public.pro_refresh_intl_teams();
