-- College records and streaks (2026-10-15) for /records and the team page's Streaks card, in one read: each team's
-- runs still going (unbeaten, winning, clean sheets, scoring, winless) from finished games, each player's runs
-- still going (games in a row they played with a goal; with a goal or assist) from the box-score lines
-- (college_player_ratings, migration 189), and the season's best single games. Rollback: DROP FUNCTION college_records.

CREATE OR REPLACE FUNCTION public.college_records(p_season integer, p_gender text, p_division text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout TO '20s' AS $$
  WITH g AS MATERIALIZED (
    SELECT id, game_date, home_program_id AS team, home_score AS gf, away_score AS ga FROM college_games
    WHERE season = p_season AND gender = p_gender AND division = p_division AND status = 'final' AND home_score IS NOT NULL AND home_program_id IS NOT NULL AND away_program_id IS NOT NULL AND NOT coalesce(forfeit, false)
    UNION ALL
    SELECT id, game_date, away_program_id, away_score, home_score FROM college_games
    WHERE season = p_season AND gender = p_gender AND division = p_division AND status = 'final' AND home_score IS NOT NULL AND home_program_id IS NOT NULL AND away_program_id IS NOT NULL AND NOT coalesce(forfeit, false)
  ),
  gr AS (SELECT g.*, row_number() OVER (PARTITION BY team ORDER BY game_date DESC, id) AS rn FROM g),
  tr AS (
    SELECT team AS program_id,
           coalesce(min(rn) FILTER (WHERE gf < ga), max(rn) + 1) - 1 AS unbeaten,
           coalesce(min(rn) FILTER (WHERE gf <= ga), max(rn) + 1) - 1 AS winning,
           coalesce(min(rn) FILTER (WHERE ga > 0), max(rn) + 1) - 1 AS clean,
           coalesce(min(rn) FILTER (WHERE gf = 0), max(rn) + 1) - 1 AS scoring,
           coalesce(min(rn) FILTER (WHERE gf > ga), max(rn) + 1) - 1 AS winless,
           max(game_date) AS last
    FROM gr GROUP BY team
  ),
  l AS MATERIALIZED (
    SELECT player_id, name, program_id, game_id, game_date, goals, assists, saves, rating, opponent_id,
           row_number() OVER (PARTITION BY player_id ORDER BY game_date DESC, game_id) AS rn
    FROM college_player_ratings WHERE season = p_season AND gender = p_gender AND division = p_division AND player_id IS NOT NULL
  ),
  pr AS (
    SELECT player_id, (array_agg(name ORDER BY rn))[1] AS name, (array_agg(program_id ORDER BY rn))[1] AS program_id, max(game_date) AS last,
           coalesce(min(rn) FILTER (WHERE goals = 0), max(rn) + 1) - 1 AS goals,
           coalesce(min(rn) FILTER (WHERE goals + assists = 0), max(rn) + 1) - 1 AS points
    FROM l GROUP BY player_id
  ),
  best AS (SELECT * FROM l)
  SELECT jsonb_build_object(
    'played', (SELECT count(*) / 2 FROM g),
    'team', jsonb_build_object(
      'unbeaten', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.unbeaten DESC, x.last DESC), '[]') FROM (SELECT * FROM tr WHERE unbeaten > 0 ORDER BY unbeaten DESC, last DESC LIMIT 10) x),
      'winning', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.winning DESC, x.last DESC), '[]') FROM (SELECT * FROM tr WHERE winning > 0 ORDER BY winning DESC, last DESC LIMIT 10) x),
      'clean', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.clean DESC, x.last DESC), '[]') FROM (SELECT * FROM tr WHERE clean > 0 ORDER BY clean DESC, last DESC LIMIT 10) x),
      'scoring', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.scoring DESC, x.last DESC), '[]') FROM (SELECT * FROM tr WHERE scoring > 0 ORDER BY scoring DESC, last DESC LIMIT 10) x)),
    'player', jsonb_build_object(
      'goals', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.goals DESC, x.last DESC), '[]') FROM (SELECT * FROM pr WHERE goals >= 2 ORDER BY goals DESC, last DESC LIMIT 10) x),
      'points', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.points DESC, x.last DESC), '[]') FROM (SELECT * FROM pr WHERE points >= 3 ORDER BY points DESC, last DESC LIMIT 10) x)),
    'games', jsonb_build_object(
      'goals', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.goals DESC, x.rating DESC), '[]') FROM (SELECT * FROM best WHERE goals >= 3 ORDER BY goals DESC, rating DESC LIMIT 10) x),
      'points', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.goals * 2 + x.assists DESC, x.rating DESC), '[]') FROM (SELECT * FROM best WHERE goals * 2 + assists >= 6 ORDER BY goals * 2 + assists DESC, rating DESC LIMIT 10) x),
      'saves', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.saves DESC, x.rating DESC), '[]') FROM (SELECT * FROM best WHERE coalesce(saves, 0) >= 10 ORDER BY saves DESC, rating DESC LIMIT 10) x),
      'rating', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.rating DESC, x.goals DESC), '[]') FROM (SELECT * FROM best WHERE rating >= 9 ORDER BY rating DESC, goals DESC LIMIT 10) x)),
    'runs', (SELECT coalesce(jsonb_object_agg(program_id, to_jsonb(tr) - 'program_id'), '{}') FROM tr)
  )
$$;
REVOKE ALL ON FUNCTION public.college_records(integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_records(integer, text, text) TO service_role;
