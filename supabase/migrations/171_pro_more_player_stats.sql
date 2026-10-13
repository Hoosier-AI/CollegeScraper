-- More player stats where the provider has none (2026-10-13).
--
-- 1. Matches with events but no lineups or player lines (lower leagues, USL League Two, women's leagues): 726
--    competition seasons named their scorers, assisters and carded players in the events but had no player totals,
--    because 162 fills existing lines only. pro_lines_from_events_only() adds a line per player an event names
--    (scorer, assister, carded, substituted), from_events = true: an appearance with unknown minutes. Goals, assists and
--    cards come from the events; minutes stay empty. Never for a match that has any line already.
-- 2. Squads: 3,950 clubs playing this season have no squad from the provider (it answered empty). pro_fill_squads_
--    from_play() lists the players who played for them this season (their season totals), source 'played'. The
--    provider's squad replaces it the day it has one (the squad sync rewrites a club's rows).
-- Rollback: drop both functions and the two columns; re-run 162's pro_refresh_season_aggregates.

ALTER TABLE public.pro_fixture_players ADD COLUMN IF NOT EXISTS from_events boolean NOT NULL DEFAULT false;
ALTER TABLE public.pro_squads ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'provider';

CREATE OR REPLACE FUNCTION public.pro_lines_from_events_only(p_league integer, p_season integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  WITH fx AS (
    SELECT f.id FROM public.pro_fixtures f
    WHERE f.league_id = p_league AND f.season = p_season AND f.status = 'final'
      AND NOT EXISTS (SELECT 1 FROM public.pro_fixture_players x WHERE x.fixture_id = f.id)
      AND EXISTS (SELECT 1 FROM public.pro_fixture_events e WHERE e.fixture_id = f.id AND e.player_id IS NOT NULL)
  ), named AS (
    -- Everyone an event names, with the team of that event (an assister is the scorer's team-mate; a sub coming on is
    -- the assist_id of a substitution).
    SELECT e.fixture_id, e.team_id, e.player_id AS pid, max(e.player_name) AS pname FROM public.pro_fixture_events e JOIN fx ON fx.id = e.fixture_id
      WHERE e.player_id IS NOT NULL AND e.team_id IS NOT NULL AND e.detail IS DISTINCT FROM 'Own Goal' GROUP BY 1, 2, 3
    UNION
    SELECT e.fixture_id, e.team_id, e.assist_id, max(e.assist_name) FROM public.pro_fixture_events e JOIN fx ON fx.id = e.fixture_id
      WHERE e.assist_id IS NOT NULL AND e.team_id IS NOT NULL GROUP BY 1, 2, 3
  ), ppl AS (
    SELECT fixture_id, team_id, pid, max(pname) AS pname FROM named GROUP BY 1, 2, 3
  ), lines AS (
    SELECT p.fixture_id, p.team_id, p.pid, p.pname,
      (200 + row_number() OVER (PARTITION BY p.fixture_id, p.team_id ORDER BY p.pid))::smallint AS slot,
      (SELECT count(*) FROM public.pro_fixture_events e WHERE e.fixture_id = p.fixture_id AND e.type = 'goal' AND e.detail IN ('Normal Goal', 'Penalty') AND e.player_id = p.pid) AS goals,
      (SELECT count(*) FROM public.pro_fixture_events e WHERE e.fixture_id = p.fixture_id AND e.type = 'goal' AND e.detail IN ('Normal Goal', 'Penalty') AND e.assist_id = p.pid) AS assists,
      (SELECT count(*) FROM public.pro_fixture_events e WHERE e.fixture_id = p.fixture_id AND e.type = 'goal' AND e.detail = 'Penalty' AND e.player_id = p.pid) AS pens,
      (SELECT count(*) FROM public.pro_fixture_events e WHERE e.fixture_id = p.fixture_id AND e.type = 'card' AND e.detail = 'Yellow Card' AND e.player_id = p.pid) AS yellow,
      (SELECT count(*) FROM public.pro_fixture_events e WHERE e.fixture_id = p.fixture_id AND e.type = 'card' AND e.detail IN ('Red Card', 'Second Yellow card') AND e.player_id = p.pid) AS red
    FROM ppl p
  )
  INSERT INTO public.pro_fixture_players (fixture_id, team_id, slot, player_id, name, starter, substitute, goals, assists, pen_scored, yellow, red, from_events)
  SELECT fixture_id, team_id, slot, pid, pname, false, false, goals, assists, pens, yellow, least(red, 1), true FROM lines
  ON CONFLICT (fixture_id, team_id, slot) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pro_lines_from_events_only(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_lines_from_events_only(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.pro_fill_squads_from_play() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '300s' AS $$
DECLARE n integer;
BEGIN
  WITH cur AS (
    SELECT DISTINCT lt.team_id, lt.season FROM public.pro_league_teams lt
    JOIN public.pro_leagues l ON l.id = lt.league_id AND lt.season = l.current_season AND l.enabled
    WHERE lt.team_id > 0 AND NOT EXISTS (SELECT 1 FROM public.pro_squads s WHERE s.team_id = lt.team_id AND s.source = 'provider')
  )
  INSERT INTO public.pro_squads (team_id, player_id, position, updated_at, source)
  SELECT DISTINCT ON (s.team_id, s.player_id) s.team_id, s.player_id, p.position, now(), 'played'
  FROM public.pro_player_season_stats s JOIN cur ON cur.team_id = s.team_id AND cur.season = s.season
  JOIN public.pro_players p ON p.id = s.player_id
  WHERE s.apps > 0
  ON CONFLICT (team_id, player_id) DO UPDATE SET updated_at = now() WHERE pro_squads.source = 'played';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pro_fill_squads_from_play() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_fill_squads_from_play() TO service_role;

CREATE OR REPLACE FUNCTION public.pro_refresh_season_aggregates(p_league integer, p_season integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(p_league, p_season);
  -- Matches the provider gave lineups and events for but no per-player stats: their lines from those first (162).
  PERFORM public.pro_fill_lines_from_events(p_league, p_season);
  -- Matches with events but no lineups at all: a line for each player the events name (171).
  PERFORM public.pro_lines_from_events_only(p_league, p_season);

  DELETE FROM public.pro_player_season_stats WHERE league_id = p_league AND season = p_season AND source = 'computed';
  INSERT INTO public.pro_player_season_stats (player_id, league_id, season, team_id, apps, starts, minutes, goals, assists,
    shots, shots_on, key_passes, passes, tackles, interceptions, duels_won, dribbles_won, yellow, red, saves, conceded,
    clean_sheets, pen_scored, rating, computed_at, source)
  SELECT fp.player_id, p_league, p_season, fp.team_id,
    count(*) FILTER (WHERE coalesce(fp.minutes, 0) > 0 OR fp.from_events),
    count(*) FILTER (WHERE fp.starter),
    coalesce(sum(fp.minutes), 0),
    coalesce(sum(fp.goals), 0),
    coalesce(sum(fp.assists), 0),
    sum(fp.shots), sum(fp.shots_on), sum(fp.key_passes), sum(fp.passes),
    sum(fp.tackles), sum(fp.interceptions), sum(fp.duels_won), sum(fp.dribbles_won),
    coalesce(sum(fp.yellow), 0), coalesce(sum(fp.red), 0),
    sum(fp.saves) FILTER (WHERE fp.pos = 'G'),
    sum(fp.conceded) FILTER (WHERE fp.pos = 'G'),
    count(*) FILTER (WHERE fp.pos = 'G' AND coalesce(fp.minutes, 0) >= 60
      AND (CASE WHEN fp.team_id = f.home_team_id THEN f.away_goals ELSE f.home_goals END) = 0),
    sum(fp.pen_scored),
    round(avg(fp.rating) FILTER (WHERE fp.rating IS NOT NULL), 2),
    now(), 'computed'
  FROM public.pro_fixture_players fp
  JOIN public.pro_fixtures f ON f.id = fp.fixture_id
  WHERE f.league_id = p_league AND f.season = p_season AND f.status = 'final' AND fp.player_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.pro_players p WHERE p.id = fp.player_id)
  GROUP BY fp.player_id, fp.team_id
  HAVING count(*) FILTER (WHERE coalesce(fp.minutes, 0) > 0 OR fp.from_events) > 0
  ON CONFLICT (player_id, league_id, season, team_id) DO NOTHING;

  UPDATE public.pro_players p SET appeared = true
  WHERE NOT p.appeared AND p.id IN (SELECT player_id FROM public.pro_player_season_stats WHERE league_id = p_league AND season = p_season);

  DELETE FROM public.pro_team_season_stats WHERE league_id = p_league AND season = p_season;
  INSERT INTO public.pro_team_season_stats (team_id, league_id, season, played, w, d, l, gf, ga, clean_sheets,
    shots, shots_on, corners, fouls, yellow, red, possession, computed_at)
  SELECT s.team_id, p_league, p_season, count(*),
    count(*) FILTER (WHERE s.gf > s.ga), count(*) FILTER (WHERE s.gf = s.ga), count(*) FILTER (WHERE s.gf < s.ga),
    sum(s.gf), sum(s.ga), count(*) FILTER (WHERE s.ga = 0),
    sum(ts.shots), sum(ts.shots_on), sum(ts.corners), sum(ts.fouls), sum(ts.yellow), sum(ts.red),
    round(avg(ts.possession), 2), now()
  FROM (
    SELECT id AS fixture_id, home_team_id AS team_id, home_goals AS gf, away_goals AS ga FROM public.pro_fixtures
      WHERE league_id = p_league AND season = p_season AND status = 'final' AND home_goals IS NOT NULL
    UNION ALL
    SELECT id, away_team_id, away_goals, home_goals FROM public.pro_fixtures
      WHERE league_id = p_league AND season = p_season AND status = 'final' AND away_goals IS NOT NULL
  ) s
  LEFT JOIN public.pro_fixture_team_stats ts ON ts.fixture_id = s.fixture_id AND ts.team_id = s.team_id
  WHERE EXISTS (SELECT 1 FROM public.pro_teams t WHERE t.id = s.team_id)
  GROUP BY s.team_id;
END $function$;
