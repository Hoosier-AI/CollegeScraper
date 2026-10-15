-- Team of the week (2026-10-15): for a competition season's round, the best-rated XI in a 4-3-3 from API-Football's
-- match ratings (pro_fixture_players.rating): the top keeper, four defenders, three midfielders and three forwards by
-- the position they played, 45 minutes or more, ties broken by goals and assists, then minutes. Rounds count only
-- when two or more of their finished matches have ratings; competitions without ratings (most outside the big
-- leagues) have no rounds and the page shows no tab. Rollback: DROP FUNCTION pro_team_of_week(integer, integer, text).

CREATE OR REPLACE FUNCTION public.pro_team_of_week(p_league integer, p_season integer, p_round text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout TO '15s' AS $$
  WITH fx AS MATERIALIZED (
    SELECT f.id, f.round, f.kickoff, f.slug FROM pro_fixtures f
    WHERE f.league_id = p_league AND f.season = p_season AND f.status = 'final' AND f.round IS NOT NULL
      AND EXISTS (SELECT 1 FROM pro_fixture_players p WHERE p.fixture_id = f.id AND p.rating IS NOT NULL)
  ),
  rounds AS (SELECT round, max(kickoff) AS last_at, min(kickoff) AS first_at, count(*) AS matches FROM fx GROUP BY round HAVING count(*) >= 2),
  pick AS (SELECT coalesce((SELECT round FROM rounds WHERE round = p_round), (SELECT round FROM rounds ORDER BY last_at DESC LIMIT 1)) AS r),
  cand AS (
    SELECT p.fixture_id, p.team_id, p.player_id, p.name, upper(left(p.pos, 1)) AS pos, p.rating, p.minutes, coalesce(p.goals, 0) AS goals, coalesce(p.assists, 0) AS assists,
           fx.slug AS fixture_slug,
           row_number() OVER (PARTITION BY upper(left(p.pos, 1)) ORDER BY p.rating DESC, coalesce(p.goals, 0) + coalesce(p.assists, 0) DESC, p.minutes DESC, p.player_id) AS rk,
           row_number() OVER (ORDER BY p.rating DESC, coalesce(p.goals, 0) + coalesce(p.assists, 0) DESC, p.minutes DESC, p.player_id) AS overall
    FROM pro_fixture_players p JOIN fx ON fx.id = p.fixture_id, pick
    WHERE fx.round = pick.r AND p.rating IS NOT NULL AND coalesce(p.minutes, 0) >= 45 AND upper(left(p.pos, 1)) IN ('G', 'D', 'M', 'F')
  )
  SELECT jsonb_build_object(
    'round', (SELECT r FROM pick),
    'rounds', coalesce((SELECT jsonb_agg(jsonb_build_object('round', round, 'first_at', first_at, 'last_at', last_at, 'matches', matches) ORDER BY last_at DESC) FROM rounds), '[]'),
    'xi', coalesce((SELECT jsonb_agg(jsonb_build_object('fixture_id', fixture_id, 'fixture_slug', fixture_slug, 'team_id', team_id, 'player_id', player_id, 'name', name, 'pos', pos,
             'rank', rk, 'rating', rating, 'minutes', minutes, 'goals', goals, 'assists', assists, 'best', overall = 1) ORDER BY CASE pos WHEN 'G' THEN 1 WHEN 'D' THEN 2 WHEN 'M' THEN 3 ELSE 4 END, rk)
           FROM cand WHERE (pos = 'G' AND rk = 1) OR (pos = 'D' AND rk <= 4) OR (pos IN ('M', 'F') AND rk <= 3)), '[]')
  )
$$;
REVOKE ALL ON FUNCTION public.pro_team_of_week(integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_team_of_week(integer, integer, text) TO service_role;
