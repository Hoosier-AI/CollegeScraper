-- League seasons whose stored table is behind their own results: more than half the clubs have played at least two
-- more regular-season matches (in pro_fixtures) than the table says (USL W League 2026: 93 of 95; MLS Next Pro 2022 and
-- 2023). results-tables works these out from the results instead. Rollback: drop the function.
CREATE OR REPLACE FUNCTION public.pro_tables_behind() RETURNS TABLE (league_id integer, season integer, teams integer, behind integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '60s' AS $$
  WITH st AS (
    SELECT p.league_id, p.season, p.team_id, sum(p.played) AS played FROM pro_standings p
     WHERE coalesce(p.source, 'api-football') <> 'results' GROUP BY 1, 2, 3
  ), fx AS (
    SELECT f.league_id, f.season, x.team_id, count(*) AS played FROM pro_fixtures f
     CROSS JOIN LATERAL (VALUES (f.home_team_id), (f.away_team_id)) x(team_id)
     WHERE f.status = 'final' AND f.home_goals IS NOT NULL AND coalesce(f.round, '') ~* 'regular|matchday|^round [0-9]|^[0-9]'
     GROUP BY 1, 2, 3
  ), c AS (
    SELECT st.league_id, st.season, count(*)::int AS teams, (count(*) FILTER (WHERE fx.played > st.played + 1))::int AS behind
      FROM st JOIN fx USING (league_id, season, team_id) GROUP BY 1, 2
  )
  SELECT league_id, season, teams, behind FROM c WHERE behind * 2 > teams;
$$;
REVOKE ALL ON FUNCTION public.pro_tables_behind() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_tables_behind() TO service_role;
