-- Penalty-shootout kicks are not goals (2026-10-14): API-Football lists each shootout kick as a goal event (detail
-- 'Penalty' or 'Missed Penalty', comments 'Penalty Shootout'; 21,481 scored kicks stored). The lines built from
-- events counted them as goals and penalties scored; leave them out, and take them back off the lines already built.

CREATE OR REPLACE FUNCTION public.pro_fill_lines_from_events(p_league integer, p_season integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     WHERE coalesce(e.comments, '') <> 'Penalty Shootout'
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
END $function$;

CREATE OR REPLACE FUNCTION public.pro_lines_from_events_only(p_league integer, p_season integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      (SELECT count(*) FROM public.pro_fixture_events e WHERE e.fixture_id = p.fixture_id AND e.type = 'goal' AND coalesce(e.comments, '') <> 'Penalty Shootout' AND e.detail IN ('Normal Goal', 'Penalty') AND e.player_id = p.pid) AS goals,
      (SELECT count(*) FROM public.pro_fixture_events e WHERE e.fixture_id = p.fixture_id AND e.type = 'goal' AND coalesce(e.comments, '') <> 'Penalty Shootout' AND e.detail IN ('Normal Goal', 'Penalty') AND e.assist_id = p.pid) AS assists,
      (SELECT count(*) FROM public.pro_fixture_events e WHERE e.fixture_id = p.fixture_id AND e.type = 'goal' AND coalesce(e.comments, '') <> 'Penalty Shootout' AND e.detail = 'Penalty' AND e.player_id = p.pid) AS pens,
      (SELECT count(*) FROM public.pro_fixture_events e WHERE e.fixture_id = p.fixture_id AND e.type = 'card' AND e.detail = 'Yellow Card' AND e.player_id = p.pid) AS yellow,
      (SELECT count(*) FROM public.pro_fixture_events e WHERE e.fixture_id = p.fixture_id AND e.type = 'card' AND e.detail IN ('Red Card', 'Second Yellow card') AND e.player_id = p.pid) AS red
    FROM ppl p
  )
  INSERT INTO public.pro_fixture_players (fixture_id, team_id, slot, player_id, name, starter, substitute, goals, assists, pen_scored, yellow, red, from_events)
  SELECT fixture_id, team_id, slot, pid, pname, false, false, goals, assists, pens, yellow, least(red, 1), true FROM lines
  ON CONFLICT (fixture_id, team_id, slot) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;

-- Lines already built from events only (never rebuilt): take the shootout kicks back off.
WITH so AS (
  SELECT e.fixture_id, e.player_id, count(*) AS n FROM public.pro_fixture_events e
   WHERE e.type = 'goal' AND e.detail = 'Penalty' AND e.comments = 'Penalty Shootout' AND e.player_id IS NOT NULL GROUP BY 1, 2
)
UPDATE public.pro_fixture_players fp SET goals = greatest(coalesce(fp.goals, 0) - so.n, 0), pen_scored = greatest(coalesce(fp.pen_scored, 0) - so.n, 0)
  FROM so WHERE fp.fixture_id = so.fixture_id AND fp.player_id = so.player_id AND fp.from_events;
