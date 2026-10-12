-- Player lines from lineups and events (2026-10-13). API-Football covers lineups and events but not per-player stats
-- for many competitions (most women's leagues: A-League Women, Brasileiro, Eredivisie Women...; men's lower leagues),
-- so every line had 0 minutes and the season totals came out empty: 2,047 competition seasons with match detail had
-- no player totals. For a match whose lines all lack minutes, each line gets
--   minutes   starters: until subbed off or sent off, else the full match (90, 120 after extra time);
--             subs: from the minute they came on (a substitution's assist) to that end;
--   goals, assists, yellow, red, pen_scored  from the events (own goals and missed penalties not counted).
-- Never over provider numbers: a match with any line holding minutes is left alone. pro_refresh_season_aggregates
-- runs it first, so new matches get it too. Rollback: 135's pro_refresh_season_aggregates; drop the function.

CREATE OR REPLACE FUNCTION public.pro_fill_lines_from_events(p_league integer, p_season integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  WITH fx AS (
    SELECT f.id, CASE WHEN f.status_short IN ('AET', 'PEN') THEN 120 ELSE 90 END AS full_time
    FROM public.pro_fixtures f
    WHERE f.league_id = p_league AND f.season = p_season AND f.status = 'final'
      AND NOT EXISTS (SELECT 1 FROM public.pro_fixture_players x WHERE x.fixture_id = f.id AND coalesce(x.minutes, 0) > 0)
      AND EXISTS (SELECT 1 FROM public.pro_fixture_events e WHERE e.fixture_id = f.id)
  ), ev AS (
    SELECT e.fixture_id, e.type, e.detail, e.minute, e.player_id, e.assist_id FROM public.pro_fixture_events e JOIN fx ON fx.id = e.fixture_id
  ), calc AS (
    SELECT fp.fixture_id, fp.team_id, fp.slot, fp.starter, fx.full_time,
      (SELECT min(minute) FROM ev WHERE ev.fixture_id = fp.fixture_id AND ev.type = 'subst' AND ev.assist_id = fp.player_id) AS on_min,
      (SELECT min(minute) FROM ev WHERE ev.fixture_id = fp.fixture_id AND ev.type = 'subst' AND ev.player_id = fp.player_id) AS off_min,
      (SELECT min(minute) FROM ev WHERE ev.fixture_id = fp.fixture_id AND ev.type = 'card' AND ev.detail IN ('Red Card', 'Second Yellow card') AND ev.player_id = fp.player_id) AS red_min,
      (SELECT count(*) FROM ev WHERE ev.fixture_id = fp.fixture_id AND ev.type = 'goal' AND ev.detail IN ('Normal Goal', 'Penalty') AND ev.player_id = fp.player_id) AS goals,
      (SELECT count(*) FROM ev WHERE ev.fixture_id = fp.fixture_id AND ev.type = 'goal' AND ev.detail IN ('Normal Goal', 'Penalty') AND ev.assist_id = fp.player_id) AS assists,
      (SELECT count(*) FROM ev WHERE ev.fixture_id = fp.fixture_id AND ev.type = 'goal' AND ev.detail = 'Penalty' AND ev.player_id = fp.player_id) AS pens,
      (SELECT count(*) FROM ev WHERE ev.fixture_id = fp.fixture_id AND ev.type = 'card' AND ev.detail = 'Yellow Card' AND ev.player_id = fp.player_id) AS yellow,
      (SELECT count(*) FROM ev WHERE ev.fixture_id = fp.fixture_id AND ev.type = 'card' AND ev.detail IN ('Red Card', 'Second Yellow card') AND ev.player_id = fp.player_id) AS red
    FROM public.pro_fixture_players fp JOIN fx ON fx.id = fp.fixture_id
    WHERE fp.player_id IS NOT NULL
  )
  UPDATE public.pro_fixture_players fp SET
    minutes = CASE
      WHEN c.starter THEN least(coalesce(c.off_min, c.full_time), coalesce(c.red_min, c.full_time), c.full_time)
      WHEN c.on_min IS NOT NULL THEN greatest(least(coalesce(c.off_min, c.full_time), coalesce(c.red_min, c.full_time), c.full_time) - c.on_min, 1)
      ELSE 0 END,
    goals = c.goals, assists = c.assists, yellow = c.yellow, red = least(c.red, 1), pen_scored = c.pens
  FROM calc c
  WHERE fp.fixture_id = c.fixture_id AND fp.team_id = c.team_id AND fp.slot = c.slot;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pro_fill_lines_from_events(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_fill_lines_from_events(integer, integer) TO service_role;

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

  DELETE FROM public.pro_player_season_stats WHERE league_id = p_league AND season = p_season AND source = 'computed';
  INSERT INTO public.pro_player_season_stats (player_id, league_id, season, team_id, apps, starts, minutes, goals, assists,
    shots, shots_on, key_passes, passes, tackles, interceptions, duels_won, dribbles_won, yellow, red, saves, conceded,
    clean_sheets, pen_scored, rating, computed_at, source)
  SELECT fp.player_id, p_league, p_season, fp.team_id,
    count(*) FILTER (WHERE coalesce(fp.minutes, 0) > 0),
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
  HAVING count(*) FILTER (WHERE coalesce(fp.minutes, 0) > 0) > 0
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
