-- Americans abroad and US transfers for the US-first Pro side (2026-10-12).
--   pro_americans_abroad(days, limit): American players' lines in club matches outside the US scene in the last days
--     (minutes > 0, national teams left out), best first: goals + assists, rating, minutes. ~12 s on a cold cache
--     (22k random reads of pro_fixture_players), so the service keeps the answer and refreshes it in the background.
--   pro_americans_upcoming(days): matches in the next days of clubs outside the US scene with an American in the squad.
--   pro_us_transfers(limit, offset): moves to or from a club in a current US competition, newest first.
-- Rollback: DROP FUNCTION the three.

CREATE OR REPLACE FUNCTION public.pro_americans_abroad(p_days integer DEFAULT 7, p_limit integer DEFAULT 200)
 RETURNS TABLE(fixture_id bigint, player_id integer, team_id integer, league_id integer, gender text, minutes integer, goals integer, assists integer, rating numeric, starter boolean)
 LANGUAGE sql STABLE SET search_path TO 'public' SET statement_timeout TO '90s'
AS $$
  WITH us AS (SELECT id FROM public.pro_players WHERE nationality = 'USA' AND minutes_recent > 0)
  SELECT fp.fixture_id, fp.player_id, fp.team_id, l.id, l.gender, fp.minutes::int, coalesce(fp.goals, 0)::int, coalesce(fp.assists, 0)::int, fp.rating, fp.starter
  FROM us
  JOIN public.pro_fixture_players fp ON fp.player_id = us.id
  JOIN public.pro_fixtures f ON f.id = fp.fixture_id AND f.status = 'final' AND f.kickoff >= now() - make_interval(days => p_days)
  JOIN public.pro_leagues l ON l.id = f.league_id AND NOT public.pro_us_league(l.id, l.country)
  JOIN public.pro_teams t ON t.id = fp.team_id AND NOT t.national
  WHERE coalesce(fp.minutes, 0) > 0
  ORDER BY coalesce(fp.goals, 0) + coalesce(fp.assists, 0) DESC, fp.rating DESC NULLS LAST, fp.minutes DESC
  LIMIT p_limit
$$;

CREATE OR REPLACE FUNCTION public.pro_americans_upcoming(p_days integer DEFAULT 7)
 RETURNS TABLE(fixture_id bigint, team_id integer, gender text, player_ids integer[])
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH am AS (
    SELECT q.team_id, array_agg(p.id ORDER BY p.minutes_recent DESC) ids
    FROM public.pro_squads q JOIN public.pro_players p ON p.id = q.player_id AND p.nationality = 'USA'
    GROUP BY q.team_id
  )
  SELECT f.id, side.team_id, l.gender, am.ids
  FROM public.pro_fixtures f
  JOIN public.pro_leagues l ON l.id = f.league_id AND l.enabled AND NOT public.pro_us_league(l.id, l.country)
  CROSS JOIN LATERAL (VALUES (f.home_team_id), (f.away_team_id)) side(team_id)
  JOIN am ON am.team_id = side.team_id
  JOIN public.pro_teams t ON t.id = side.team_id AND NOT t.national
  WHERE f.status = 'scheduled' AND f.kickoff BETWEEN now() AND now() + make_interval(days => p_days)
$$;

CREATE OR REPLACE FUNCTION public.pro_us_transfers(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS SETOF public.pro_transfers
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH us_teams AS (
    SELECT DISTINCT lt.team_id FROM public.pro_league_teams lt JOIN public.pro_leagues l ON l.id = lt.league_id AND lt.season = l.current_season
     WHERE l.enabled AND public.pro_us_league(l.id, l.country)
  )
  SELECT tr.* FROM public.pro_transfers tr
  WHERE tr.date <= current_date AND (tr.to_team_id IN (SELECT team_id FROM us_teams) OR tr.from_team_id IN (SELECT team_id FROM us_teams))
  ORDER BY tr.date DESC
  LIMIT least(p_limit, 100) OFFSET p_offset
$$;

REVOKE ALL ON FUNCTION public.pro_americans_abroad(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pro_americans_upcoming(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pro_us_transfers(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_americans_abroad(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pro_americans_upcoming(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pro_us_transfers(integer, integer) TO service_role;
