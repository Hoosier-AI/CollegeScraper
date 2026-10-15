-- College player match ratings (2026-10-15), FotMob/Sofascore style, from the box score we trust for the game
-- (college_games.source_of_truth). 0 to 10, one decimal; 6.3 is an anonymous 90 minutes in a loss-free game:
--   goals +1.0, assists +0.7, shots on goal that were not goals +0.2, other shots +0.04, fouls -0.04,
--   yellow -0.35, red -1.3, team result (win +0.35, tie +0.05, loss -0.25), team goal difference +0.07 a goal
--   (to +-4, scaled by minutes), a clean sheet in 60+ minutes (defenders +0.45, keepers +0.5), keepers +0.18 a save
--   (to 8) and -0.3 a goal allowed, +0.25 for a full 90 (scaled by minutes). Lines under 10 minutes are not rated.
-- Above 8 the score bends towards 10 (college_rating_curve). Calibrated on 2026 D1 men: median about 6.6, the best
-- player of a game about 8.4.
-- A table (not a matview) so one game can be rated the moment its box score lands: college_rate_games(ids) from
-- final-detail, college_rate_recent() from the half-hourly college-ratings job, college_rate_season(s) for backfill.
-- Rollback: DROP FUNCTION college_rate_games, college_rate_recent, college_rate_season, college_pos_group,
-- college_team_of_week; DROP TABLE college_player_ratings.

-- G, D, M or F from a box score line or a roster: a keeper flag first, then the roster position, then the first letter
-- of the box score's ("- MID", "000M", "Defender", "B" back, "C" centre mid, "A"/"S" attacker or striker).
CREATE OR REPLACE FUNCTION public.college_pos_group(box_pos text, is_goalie boolean, roster_pos text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN coalesce(is_goalie, false) THEN 'G'
    ELSE (SELECT CASE left(p, 1) WHEN 'G' THEN 'G' WHEN 'D' THEN 'D' WHEN 'B' THEN 'D' WHEN 'M' THEN 'M' WHEN 'C' THEN 'M' WHEN 'F' THEN 'F' WHEN 'A' THEN 'F' WHEN 'S' THEN 'F' END
          FROM (SELECT coalesce(nullif(regexp_replace(upper(coalesce(roster_pos, '')), '[^A-Z]', '', 'g'), ''), nullif(regexp_replace(upper(coalesce(box_pos, '')), '[^A-Z]', '', 'g'), ''), '') AS p) x)
  END
$$;

-- The raw score up to 8 as it is; above 8 it bends towards 10 (a four-assist game is about 9.7), so a week's best
-- players spread out instead of all reading 10.0. Never below 3.
CREATE OR REPLACE FUNCTION public.college_rating_curve(raw numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT greatest(3, CASE WHEN raw > 8 THEN 8 + 2 * (1 - exp(-(raw - 8) / 1.5)) ELSE raw END)
$$;

CREATE TABLE IF NOT EXISTS public.college_player_ratings (
  game_id uuid NOT NULL,
  program_id uuid NOT NULL,
  line_key text NOT NULL,
  player_season_id uuid,
  player_id uuid,
  name text NOT NULL,
  season integer NOT NULL,
  gender text NOT NULL,
  division text,
  conference_id uuid,
  game_date date NOT NULL,
  opponent_id uuid,
  is_home boolean NOT NULL,
  pos text,
  starter boolean,
  minutes integer,
  goals integer NOT NULL DEFAULT 0,
  assists integer NOT NULL DEFAULT 0,
  saves integer,
  rating numeric(3, 1) NOT NULL,
  PRIMARY KEY (game_id, program_id, line_key)
);
CREATE INDEX IF NOT EXISTS college_player_ratings_week_idx ON public.college_player_ratings (season, gender, division, game_date);
CREATE INDEX IF NOT EXISTS college_player_ratings_all_idx ON public.college_player_ratings (season, gender, game_date);
CREATE INDEX IF NOT EXISTS college_player_ratings_player_idx ON public.college_player_ratings (player_id, game_date DESC);
CREATE INDEX IF NOT EXISTS college_player_ratings_season_player_idx ON public.college_player_ratings (player_season_id);
ALTER TABLE public.college_player_ratings ENABLE ROW LEVEL SECURITY;

-- (Re)rates the given games: every line of the trusted box score with 10+ minutes.
CREATE OR REPLACE FUNCTION public.college_rate_games(p_ids uuid[]) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET statement_timeout TO '10min' AS $$
DECLARE n integer;
BEGIN
  DELETE FROM college_player_ratings WHERE game_id = ANY(p_ids);
  INSERT INTO college_player_ratings (game_id, program_id, line_key, player_season_id, player_id, name, season, gender, division, conference_id, game_date,
                                      opponent_id, is_home, pos, starter, minutes, goals, assists, saves, rating)
  SELECT DISTINCT ON (l.game_id, l.program_id, l.source_key)
         l.game_id, l.program_id, l.source_key, l.player_season_id, ps.player_id, btrim(concat_ws(' ', l.first_name, l.last_name)),
         g.season, g.gender, g.division, CASE WHEN l.is_home THEN g.home_conference_id ELSE g.away_conference_id END, g.game_date,
         CASE WHEN l.is_home THEN g.away_program_id ELSE g.home_program_id END, l.is_home,
         college_pos_group(l.position, l.is_goalie, ps.position), l.starter, l.mins, coalesce(l.goals, 0), coalesce(l.assists, 0),
         CASE WHEN l.is_goalie THEN l.saves END,
         round(college_rating_curve((6.3
           + 1.0 * coalesce(l.goals, 0) + 0.7 * coalesce(l.assists, 0)
           + 0.2 * greatest(0, coalesce(l.shots_on_goal, 0) - coalesce(l.goals, 0))
           + 0.04 * coalesce(l.shots_off_target, greatest(0, coalesce(l.shots, 0) - coalesce(l.shots_on_goal, 0)))
           - 0.35 * coalesce(l.yellow_cards, 0) - 1.3 * coalesce(l.red_cards, 0) - 0.04 * coalesce(l.fouls, 0)
           + CASE WHEN l.gf > l.ga THEN 0.35 WHEN l.gf = l.ga THEN 0.05 ELSE -0.25 END
           + 0.07 * greatest(-4, least(4, l.gf - l.ga)) * least(1, l.mins / 90.0)
           + CASE WHEN l.is_goalie THEN 0.18 * least(coalesce(l.saves, 0), 8) - 0.3 * coalesce(l.goals_allowed, 0)
                                        + CASE WHEN coalesce(l.goals_allowed, 0) = 0 AND l.mins >= 60 THEN 0.5 ELSE 0 END ELSE 0 END
           + CASE WHEN NOT coalesce(l.is_goalie, false) AND college_pos_group(l.position, false, ps.position) = 'D' AND l.ga = 0 AND l.mins >= 60 THEN 0.45 ELSE 0 END
           + 0.25 * least(1, l.mins / 90.0)))::numeric, 1)
  FROM (
    SELECT s.*, s.program_id = g.home_program_id AS is_home,
           CASE WHEN s.program_id = g.home_program_id THEN g.home_score ELSE g.away_score END AS gf,
           CASE WHEN s.program_id = g.home_program_id THEN g.away_score ELSE g.home_score END AS ga,
           coalesce(s.minutes, CASE WHEN s.starter THEN 90 ELSE 20 END) AS mins
    FROM college_game_player_stats s JOIN college_v_schedule g ON g.id = s.game_id AND s.source = g.source_of_truth
    WHERE s.game_id = ANY(p_ids) AND coalesce(s.participated, true)
  ) l
  JOIN college_v_schedule g ON g.id = l.game_id
  LEFT JOIN college_player_seasons ps ON ps.id = l.player_season_id
  WHERE g.status = 'final' AND g.home_score IS NOT NULL AND l.mins >= 10 AND nullif(btrim(concat_ws(' ', l.first_name, l.last_name)), '') IS NOT NULL
    AND NOT coalesce(g.forfeit, false)
  ORDER BY l.game_id, l.program_id, l.source_key, l.mins DESC;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Games whose box score may have changed in the last three days (finals, late site box scores, corrections).
CREATE OR REPLACE FUNCTION public.college_rate_recent() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public SET statement_timeout TO '10min' AS $$
  SELECT college_rate_games(coalesce((SELECT array_agg(id) FROM college_games
    WHERE status = 'final' AND source_of_truth IS NOT NULL
      AND greatest(final_at, site_fetched_at, ncaa_fetched_at, updated_at) > now() - interval '3 days'), '{}'))
$$;

CREATE OR REPLACE FUNCTION public.college_rate_season(p_season integer) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public SET statement_timeout TO '30min' AS $$
  SELECT college_rate_games(coalesce((SELECT array_agg(id) FROM college_games WHERE season = p_season AND status = 'final' AND source_of_truth IS NOT NULL), '{}'))
$$;

-- A week's (Monday to Sunday, Eastern) best-rated XI for a gender and division, or one conference: one keeper, four
-- defenders, three midfielders, three forwards, 45+ minutes, each player once (their best game of the week).
-- Also the weeks that have ratings, newest first, for the picker, and `current` for the week in play.
CREATE OR REPLACE FUNCTION public.college_team_of_week(p_season integer, p_gender text, p_division text, p_week date DEFAULT NULL, p_conference uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout TO '15s' AS $$
DECLARE
  cur date := date_trunc('week', (now() AT TIME ZONE 'America/New_York')::date)::date;
  wks jsonb; wk date; xi jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('week', w, 'games', n) ORDER BY w DESC), '[]') INTO wks FROM (
    SELECT date_trunc('week', game_date)::date AS w, count(DISTINCT game_id) AS n FROM college_player_ratings
    WHERE season = p_season AND gender = p_gender AND (p_division IS NULL OR division = p_division) AND (p_conference IS NULL OR conference_id = p_conference)
    GROUP BY 1 HAVING count(DISTINCT game_id) >= 3) x;
  -- The asked week if it has ratings, else the last finished week (the week in play stays pickable, as "so far").
  SELECT coalesce(
    (SELECT (e ->> 'week')::date FROM jsonb_array_elements(wks) e WHERE (e ->> 'week')::date = date_trunc('week', p_week)::date),
    (SELECT max((e ->> 'week')::date) FROM jsonb_array_elements(wks) e WHERE (e ->> 'week')::date < cur),
    (SELECT max((e ->> 'week')::date) FROM jsonb_array_elements(wks) e)) INTO wk;
  IF wk IS NOT NULL THEN
    WITH best AS (
      SELECT DISTINCT ON (coalesce(r.player_id::text, r.program_id::text || r.line_key)) r.*
      FROM college_player_ratings r
      WHERE r.season = p_season AND r.gender = p_gender AND (p_division IS NULL OR r.division = p_division) AND (p_conference IS NULL OR r.conference_id = p_conference)
        AND r.game_date >= wk AND r.game_date < wk + 7 AND r.minutes >= 45 AND r.pos IS NOT NULL
      ORDER BY coalesce(r.player_id::text, r.program_id::text || r.line_key), r.rating DESC, r.goals + r.assists DESC
    ),
    ranked AS (
      SELECT b.*, row_number() OVER (PARTITION BY pos ORDER BY rating DESC, goals + assists DESC, minutes DESC, game_id) AS rk,
             row_number() OVER (ORDER BY rating DESC, goals + assists DESC, minutes DESC, game_id) AS overall
      FROM best b
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('game_id', game_id, 'program_id', program_id, 'player_id', player_id, 'name', name, 'pos', pos,
             'rank', rk, 'rating', rating, 'minutes', minutes, 'goals', goals, 'assists', assists, 'saves', saves, 'opponent_id', opponent_id, 'is_home', is_home,
             'game_date', game_date, 'best', overall = 1) ORDER BY CASE pos WHEN 'G' THEN 1 WHEN 'D' THEN 2 WHEN 'M' THEN 3 ELSE 4 END, rk), '[]') INTO xi
    FROM ranked WHERE (pos = 'G' AND rk = 1) OR (pos = 'D' AND rk <= 4) OR (pos IN ('M', 'F') AND rk <= 3);
  END IF;
  RETURN jsonb_build_object('week', wk, 'current', cur, 'weeks', wks, 'xi', coalesce(xi, '[]'));
END $$;

REVOKE ALL ON public.college_player_ratings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.college_player_ratings TO service_role;
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['college_rate_games(uuid[])', 'college_rate_recent()', 'college_rate_season(integer)', 'college_team_of_week(integer, text, text, date, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
