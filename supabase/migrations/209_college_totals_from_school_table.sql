-- College quality pass (2026-11-24). Measured against NCAA.com's individual leaderboards, the season totals had
-- slipped well under target (assists 65%, saves 73%, keeper minutes 74%, goals 90%). Three causes, three fixes:
--
--   1. Season totals follow the school's own season table. The school sends NCAA.com the same numbers; our sum of
--      game lines misses an assist here and a corrected box score there. Read after the team's last final, and covering
--      as many games as we hold, the school table is the total; otherwise it is a floor. Where a school publishes no table the sum of lines stays.
--      Agreement with NCAA.com's leaders, school table vs sum of lines: assists 94% / 78%, goals 96% / 91%,
--      points 92% / 75%, saves 89% / 73%, game-winning goals 93% / 81%.
--   2. Keepers. NCAA.com's box score zero-fills the starting keeper (goalie minutes 0, goals allowed 0), and with
--      NCAA.com as the game's truth source those zeros were taken as facts. A zero is now "not published": the other
--      source's figure, else the minutes played; a keeper alone in goal for the whole game allowed the opponent's score.
--   3. Duplicate players. 153 players were twice on the same team this season (two roster syncs at once, or a box
--      score read before the roster), their games split between two identities: NCAA.com says 13 goals, each half
--      showed 0 and 13. college_duplicate_player_seasons lists them, college_merge_player_season folds one into the
--      other, resolve-orphans (nightly) does it every night. Roster rows with no name (710, a roster page that did
--      not parse) are removed by college_remove_blank_players.
--
-- Rollback: migration 183's college_refresh_season_aggregates; drop the three new functions.

CREATE OR REPLACE FUNCTION public.college_refresh_season_aggregates(p_season integer, p_program uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '240s'
AS $function$
DECLARE n_players integer; n_teams integer; n_splits integer;
BEGIN
  -- One refresh per season at a time (see the header): the others wait here instead of on 57k row locks.
  PERFORM pg_advisory_xact_lock(hashtext('college_refresh_season_aggregates'), p_season);
  -- Truth-source player lines, with minutes / starter / goalkeeper minutes borrowed from the other source for
  -- the same player when the truth source does not publish them (PrestoSports lists minutes only for keepers
  -- and does not mark starters; NCAA.com does).
  -- Every source's lines for the season's finals, read once and hash-joined below (a lookup per line through the
  -- primary key took 18-21 s for a full season).
  -- The season's lines are read from the big table once (2026-11-24: read twice, for _lines and for _truth, the two
  -- reads alone took 160 s on a busy database and the whole refresh ran into the 300 s statement limit).
  DROP TABLE IF EXISTS _raw;
  CREATE TEMP TABLE _raw ON COMMIT DROP AS
    SELECT gps.*, (gps.source = g.source_of_truth) AS from_truth
      FROM college_game_player_stats gps JOIN college_games g ON g.id = gps.game_id
     WHERE g.season = p_season AND g.status = 'final' AND g.source_of_truth IS NOT NULL AND gps.player_season_id IS NOT NULL
       AND (p_program IS NULL OR gps.program_id = p_program);
  ANALYZE _raw;
  DROP TABLE IF EXISTS _lines;
  CREATE TEMP TABLE _lines ON COMMIT DROP AS
    SELECT gps.game_id, gps.program_id, gps.source, gps.player_season_id, max(gps.minutes) AS minutes, bool_or(gps.starter) AS starter,
           max(gps.gk_minutes) AS gk_minutes, max(gps.goals) AS goals, max(gps.assists) AS assists, max(gps.saves) AS saves,
           max(gps.goals_allowed) AS goals_allowed
      FROM _raw gps
     GROUP BY gps.game_id, gps.program_id, gps.source, gps.player_season_id;
  ANALYZE _lines;
  -- Game-winning goals worked out from the order of the winner's goals (the loser's total + 1), from the truth source's
  -- play-by-play when its goal count matches the score, else the other source's; the box-score GWG column is left
  -- empty by most sources (2026-10-14: 2.5% of NCAA.com's GWG leaders matched).
  DROP TABLE IF EXISTS _gwg;
  CREATE TEMP TABLE _gwg ON COMMIT DROP AS
    WITH fin AS (
      SELECT g.id AS game_id, g.source_of_truth,
             CASE WHEN g.home_score > g.away_score THEN g.home_program_id ELSE g.away_program_id END AS win_pid,
             least(g.home_score, g.away_score) AS lose_score, greatest(g.home_score, g.away_score) AS win_score
        FROM college_games g
       WHERE g.season = p_season AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
         AND g.home_score <> g.away_score AND NOT coalesce(g.forfeit, false)
         AND (p_program IS NULL OR p_program IN (g.home_program_id, g.away_program_id))
    ), ev AS (
      SELECT e.game_id, e.source, e.player_season_id,
             row_number() OVER (PARTITION BY e.game_id, e.source ORDER BY e.period, e.clock_seconds NULLS LAST, e.seq) AS rn,
             count(*) OVER (PARTITION BY e.game_id, e.source) AS n
        FROM college_game_events e JOIN fin f ON f.game_id = e.game_id
       WHERE e.event_type = 'goal' AND e.program_id = f.win_pid
    )
    SELECT DISTINCT ON (f.game_id) f.game_id, ev.player_season_id
      FROM fin f JOIN ev ON ev.game_id = f.game_id AND ev.n = f.win_score AND ev.rn = f.lose_score + 1
     ORDER BY f.game_id, (ev.source = f.source_of_truth) DESC;
  ANALYZE _gwg;
  -- No usable goal order: when one winning player scored every goal, theirs was the winner. (A temp table, analysed,
  -- so the "not already known" test is a hash anti join: as a CTE it was a nested loop, 200 s.)
  INSERT INTO _gwg (game_id, player_season_id)
    WITH fin AS (
      SELECT g.id AS game_id, g.source_of_truth,
             CASE WHEN g.home_score > g.away_score THEN g.home_program_id ELSE g.away_program_id END AS win_pid,
             least(g.home_score, g.away_score) AS lose_score, greatest(g.home_score, g.away_score) AS win_score
        FROM college_games g
       WHERE g.season = p_season AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
         AND g.home_score <> g.away_score AND NOT coalesce(g.forfeit, false)
         AND (p_program IS NULL OR p_program IN (g.home_program_id, g.away_program_id))
    )
    , scorers AS (
      SELECT f.game_id, f.win_score, l.player_season_id, max(l.goals) AS goals
        FROM fin f JOIN college_game_player_stats l ON l.game_id = f.game_id AND l.program_id = f.win_pid
       WHERE l.player_season_id IS NOT NULL AND coalesce(l.goals, 0) > 0
         AND NOT EXISTS (SELECT 1 FROM _gwg b WHERE b.game_id = f.game_id)
       GROUP BY f.game_id, f.win_score, l.player_season_id
    )
    SELECT game_id, min(player_season_id::text)::uuid FROM scorers GROUP BY game_id
    HAVING count(*) = 1 AND max(goals) = max(win_score);

  DROP TABLE IF EXISTS _truth;
  CREATE TEMP TABLE _truth ON COMMIT DROP AS
    SELECT gps.game_id, gps.program_id, gps.source, gps.source_key, gps.player_season_id, gps.from_truth,
           coalesce(gps.minutes, alt.minutes) AS minutes,
           (gps.starter OR coalesce(alt.starter, false)) AS starter,
           gps.participated,
           -- Goals, assists and saves: the higher of the two sources' counts for the game (a source missing an assist
           -- is the common failure: 2026-10-14, assists matched NCAA.com's leaders 74.8% -> 87.2%).
           greatest(gps.goals, alt.goals) AS goals, greatest(gps.assists, alt.assists) AS assists,
           CASE WHEN greatest(gps.goals, alt.goals) IS NULL AND greatest(gps.assists, alt.assists) IS NULL THEN gps.points
                ELSE 2 * coalesce(greatest(gps.goals, alt.goals), 0) + coalesce(greatest(gps.assists, alt.assists), 0) END AS points,
           gps.shots, gps.shots_on_goal, gps.pk_goals, gps.pk_attempts,
           gps.fouls, gps.yellow_cards, gps.red_cards, gps.corners, gps.offsides,
           CASE WHEN gw.game_id IS NOT NULL THEN (gw.player_season_id IS NOT DISTINCT FROM gps.player_season_id)::int ELSE gps.gwg END AS gwg,
           gps.hat_trick,
           gps.is_goalie,
           -- Keepers: NCAA.com's box score zero-fills the starting keeper (goalie minutes 0, goals allowed 0, saves 0), so
           -- a zero there is "not published", not a fact: the other source's figure, else the minutes the keeper played.
           -- (2026-11-24: with NCAA.com as the truth source a keeper lost that game's goalie minutes and goals allowed;
           -- keeper minutes matched NCAA.com's leaders 74%.)
           greatest(gps.goals_allowed, alt.goals_allowed) AS goals_allowed, greatest(gps.saves, alt.saves) AS saves,
           coalesce(nullif(gps.gk_minutes, 0), nullif(alt.gk_minutes, 0),
                    CASE WHEN gps.is_goalie THEN nullif(coalesce(gps.minutes, alt.minutes), 0) END,
                    gps.gk_minutes, alt.gk_minutes) AS gk_minutes,
           g.home_program_id, g.away_program_id, g.home_score, g.away_score, g.overtime, g.game_date,
           (gps.program_id = g.home_program_id) AS is_home, g.neutral_site, g.conference_game,
           CASE WHEN gps.program_id = g.home_program_id THEN g.away_program_id ELSE g.home_program_id END AS opp_program_id
      FROM (SELECT DISTINCT ON (x.game_id, x.player_season_id) x.*
              FROM _raw x
             ORDER BY x.game_id, x.player_season_id, x.from_truth DESC, x.minutes DESC NULLS LAST) gps
      JOIN college_games g ON g.id = gps.game_id
      LEFT JOIN _lines alt
             ON alt.game_id = gps.game_id AND alt.program_id = gps.program_id AND alt.player_season_id = gps.player_season_id
            AND alt.source <> gps.source
      LEFT JOIN _gwg gw ON gw.game_id = gps.game_id
     WHERE g.season = p_season AND g.status = 'final';

  -- Analysed first: without row counts the two keeper updates below join by nested loop (minutes, not seconds).
  ANALYZE _truth;
  -- Two keepers cannot have more minutes in goal than the game had: when a zero-filled line was given the whole
  -- game ("90" for a keeper who came off at half-time), the keeper with the most minutes gets what the others left.
  UPDATE _truth t SET gk_minutes = x.len - x.others
    FROM (SELECT k.game_id, k.program_id, k.player_season_id, CASE WHEN k.overtime THEN 110 ELSE 90 END AS len,
                 sum(k.gk_minutes) OVER w - k.gk_minutes AS others, sum(k.gk_minutes) OVER w AS total,
                 row_number() OVER (PARTITION BY k.game_id, k.program_id ORDER BY k.gk_minutes DESC, k.player_season_id) AS rn
            FROM _truth k WHERE k.is_goalie AND coalesce(k.gk_minutes, 0) > 0
          WINDOW w AS (PARTITION BY k.game_id, k.program_id)) x
   WHERE x.rn = 1 AND x.others > 0 AND x.total > x.len + 5 AND x.len - x.others > 0
     AND t.game_id = x.game_id AND t.program_id = x.program_id AND t.player_season_id = x.player_season_id AND t.is_goalie;

  -- A keeper who kept goal alone for the whole game allowed exactly what the opponent scored.
  UPDATE _truth t SET goals_allowed = CASE WHEN t.is_home THEN t.away_score ELSE t.home_score END
    FROM (SELECT game_id, program_id FROM _truth WHERE is_goalie AND coalesce(gk_minutes, 0) > 0 GROUP BY game_id, program_id HAVING count(*) = 1) one
   WHERE one.game_id = t.game_id AND one.program_id = t.program_id AND t.is_goalie AND coalesce(t.gk_minutes, 0) >= 90
     AND t.home_score IS NOT NULL AND t.away_score IS NOT NULL
     AND t.goals_allowed IS DISTINCT FROM CASE WHEN t.is_home THEN t.away_score ELSE t.home_score END;

  -- Games where the opponent was in the USC top 25 of the latest poll published on or before the game date.
  DROP TABLE IF EXISTS _ranked;
  CREATE TEMP TABLE _ranked ON COMMIT DROP AS
    SELECT g.id AS game_id, side.program_id
      FROM college_games g
      CROSS JOIN LATERAL (VALUES (g.home_program_id, g.away_program_id), (g.away_program_id, g.home_program_id)) AS side(program_id, opp_id)
     WHERE g.season = p_season AND g.status = 'final' AND side.program_id IS NOT NULL AND side.opp_id IS NOT NULL
       AND (p_program IS NULL OR side.program_id = p_program)
       AND EXISTS (
         SELECT 1 FROM college_rankings r
          WHERE r.season = p_season AND r.poll = 'usc' AND r.rank <= 25 AND r.program_id = side.opp_id
            AND r.week_of = (SELECT max(r2.week_of) FROM college_rankings r2
                              WHERE r2.season = p_season AND r2.poll = 'usc' AND r2.gender = r.gender AND r2.division = r.division AND r2.week_of <= g.game_date));

  -- Goals by half from the truth-source events.
  DROP TABLE IF EXISTS _goal_events;
  CREATE TEMP TABLE _goal_events ON COMMIT DROP AS
    SELECT ev.game_id, ev.program_id, ev.player_season_id, ev.period, g.home_program_id, g.away_program_id
      FROM college_game_events ev JOIN college_games g ON g.id = ev.game_id
     WHERE g.season = p_season AND g.status = 'final' AND ev.source = g.source_of_truth AND ev.event_type = 'goal'
       AND (p_program IS NULL OR p_program IN (g.home_program_id, g.away_program_id));

  -- ---- player season stats ----
  WITH team_minutes AS (
    SELECT game_id, program_id, greatest(max(minutes), 90) AS team_min,
           coalesce(nullif(count(*) FILTER (WHERE is_goalie AND from_truth AND coalesce(gk_minutes, minutes, 0) > 0), 0),
                    count(*) FILTER (WHERE is_goalie AND coalesce(gk_minutes, minutes, 0) > 0)) AS keepers,
           max(coalesce(gk_minutes, minutes)) FILTER (WHERE is_goalie) AS top_gk_min
      FROM _truth GROUP BY game_id, program_id
  ), halves AS (
    SELECT player_season_id, count(*) FILTER (WHERE period = 1) AS g1, count(*) FILTER (WHERE period = 2) AS g2, count(*) FILTER (WHERE period > 2) AS got
      FROM _goal_events WHERE player_season_id IS NOT NULL GROUP BY player_season_id
  ), summed AS (
    SELECT t.player_season_id,
      count(*) FILTER (WHERE t.participated) AS gp,
      count(*) FILTER (WHERE t.starter) AS gs,
      sum(t.minutes) AS minutes,
      sum(t.goals) AS goals, sum(t.assists) AS assists, sum(coalesce(t.points, coalesce(t.goals,0)*2 + coalesce(t.assists,0))) AS points,
      -- Rates divide by minutes, so their counts come only from games whose minutes are known (a season with minutes
      -- in half its games used to show twice the goals per 90).
      sum(t.goals) FILTER (WHERE t.minutes IS NOT NULL) AS goals_m, sum(t.assists) FILTER (WHERE t.minutes IS NOT NULL) AS assists_m,
      sum(coalesce(t.points, coalesce(t.goals,0)*2 + coalesce(t.assists,0))) FILTER (WHERE t.minutes IS NOT NULL) AS points_m,
      sum(t.shots) FILTER (WHERE t.minutes IS NOT NULL) AS shots_m, sum(t.shots_on_goal) FILTER (WHERE t.minutes IS NOT NULL) AS sog_m,
      sum(t.goals_allowed) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes) IS NOT NULL) AS ga_m,
      sum(t.saves) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes) IS NOT NULL) AS saves_m,
      count(*) FILTER (WHERE t.participated AND t.minutes IS NOT NULL) AS gp_timed,
      sum(t.shots) AS shots, sum(t.shots_on_goal) AS sog, sum(t.pk_goals) AS pk_goals, sum(t.pk_attempts) AS pk_att,
      sum(t.fouls) AS fouls, sum(t.yellow_cards) AS yc, sum(t.red_cards) AS rc, sum(t.corners) AS corners, sum(t.offsides) AS offsides,
      sum(t.gwg) AS gwg, count(*) FILTER (WHERE t.hat_trick) AS hat_tricks,
      sum(t.goals_allowed) FILTER (WHERE t.is_goalie) AS ga,
      sum(t.saves) FILTER (WHERE t.is_goalie) AS saves,
      -- A shutout goes to a keeper who kept goal the whole game; a shared clean sheet is no one's (as the NCAA counts).
      count(*) FILTER (WHERE t.is_goalie AND tm.keepers = 1 AND coalesce(t.gk_minutes, t.minutes, 0) > 0
                        AND CASE WHEN t.program_id = t.home_program_id THEN t.away_score ELSE t.home_score END = 0) AS shutouts,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) >= 45 AND coalesce(t.goals_allowed,0) = 0) AS clean_sheets,
      sum(coalesce(t.gk_minutes, t.minutes)) FILTER (WHERE t.is_goalie) AS gk_minutes,
      -- The decision goes to the keeper with the most minutes in goal.
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) > 0 AND coalesce(t.gk_minutes, t.minutes) = tm.top_gk_min AND
        CASE WHEN t.program_id = t.home_program_id THEN t.home_score > t.away_score ELSE t.away_score > t.home_score END) AS gk_wins,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) > 0 AND coalesce(t.gk_minutes, t.minutes) = tm.top_gk_min AND
        CASE WHEN t.program_id = t.home_program_id THEN t.home_score < t.away_score ELSE t.away_score < t.home_score END) AS gk_losses,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) > 0 AND coalesce(t.gk_minutes, t.minutes) = tm.top_gk_min AND t.home_score = t.away_score) AS gk_ties,
      sum(tm.team_min) FILTER (WHERE t.participated AND t.minutes IS NOT NULL) AS team_minutes
    FROM _truth t JOIN team_minutes tm ON tm.game_id = t.game_id AND tm.program_id = t.program_id
    GROUP BY t.player_season_id
  ), last_final AS (
    SELECT side.program_id, max(g.game_date) AS d, count(*) FILTER (WHERE NOT coalesce(g.forfeit, false)) AS played
      FROM college_games g CROSS JOIN LATERAL (VALUES (g.home_program_id), (g.away_program_id)) AS side(program_id)
     WHERE g.season = p_season AND g.status = 'final' AND side.program_id IS NOT NULL GROUP BY side.program_id
  ), school AS (
    -- The school's own season table (college_site_season_stats), read after the team's last final, is the official
    -- total: the school sends NCAA.com the same numbers. Read before it, it is a floor. Measured 2026-11-24 against
    -- NCAA.com's leaders: the school table agreed 94% on assists, 96% on goals, 89% on saves; the sum of our game
    -- lines 78%, 91% and 73% (a box score missing an assist, or corrected later, is the usual gap).
    SELECT st.player_season_id, st.gp, st.goals, st.assists, st.points, st.gwg, st.saves, st.ga, st.shutouts, st.minutes,
           (st.fetched_at::date > lf.d) AS fresh,
           -- Someone on the team has as many games in the table as the team has played: the table is up to date.
           coalesce(max(st.gp) OVER (PARTITION BY ps.program_id) >= lf.played, false) AS complete
      FROM college_site_season_stats st JOIN college_player_seasons ps ON ps.id = st.player_season_id
      LEFT JOIN last_final lf ON lf.program_id = ps.program_id
     WHERE ps.season = p_season AND (p_program IS NULL OR ps.program_id = p_program)
  ), agg AS (
    SELECT r.player_season_id, r.gp, r.gs, r.minutes,
      CASE WHEN sc.goals IS NULL THEN r.goals WHEN k.fresh THEN sc.goals ELSE greatest(r.goals, sc.goals) END AS goals,
      CASE WHEN sc.assists IS NULL THEN r.assists WHEN k.fresh THEN sc.assists ELSE greatest(r.assists, sc.assists) END AS assists,
      CASE WHEN sc.goals IS NULL OR sc.assists IS NULL THEN CASE WHEN sc.points IS NULL THEN r.points WHEN k.fresh THEN sc.points ELSE greatest(r.points, sc.points) END
           WHEN k.fresh THEN 2 * sc.goals + sc.assists
           ELSE 2 * greatest(coalesce(r.goals, 0), sc.goals) + greatest(coalesce(r.assists, 0), sc.assists) END AS points,
      r.goals_m, r.assists_m, r.points_m, r.shots_m, r.sog_m,
      CASE WHEN k.is_gk AND sc.ga IS NOT NULL THEN CASE WHEN k.fresh THEN sc.ga ELSE greatest(r.ga, sc.ga) END ELSE r.ga_m END AS ga_m,
      CASE WHEN k.is_gk AND sc.saves IS NOT NULL THEN CASE WHEN k.fresh THEN sc.saves ELSE greatest(r.saves, sc.saves) END ELSE r.saves_m END AS saves_m,
      r.gp_timed, r.shots, r.sog, r.pk_goals, r.pk_att, r.fouls, r.yc, r.rc, r.corners, r.offsides,
      CASE WHEN sc.gwg IS NULL THEN r.gwg WHEN k.fresh THEN sc.gwg ELSE greatest(r.gwg, sc.gwg) END AS gwg,
      r.hat_tricks,
      CASE WHEN k.is_gk AND sc.ga IS NOT NULL THEN CASE WHEN k.fresh THEN sc.ga ELSE greatest(r.ga, sc.ga) END ELSE r.ga END AS ga,
      CASE WHEN k.is_gk AND sc.saves IS NOT NULL THEN CASE WHEN k.fresh THEN sc.saves ELSE greatest(r.saves, sc.saves) END ELSE r.saves END AS saves,
      CASE WHEN k.is_gk AND sc.shutouts IS NOT NULL THEN CASE WHEN k.fresh THEN sc.shutouts ELSE greatest(r.shutouts, sc.shutouts) END ELSE r.shutouts END AS shutouts,
      r.clean_sheets,
      -- A keeper's minutes in the school table are his minutes in goal (only for a player we also count as a keeper).
      CASE WHEN k.is_gk AND sc.saves IS NOT NULL AND coalesce(sc.minutes, 0) > 0 THEN CASE WHEN k.fresh THEN sc.minutes ELSE greatest(r.gk_minutes, sc.minutes) END ELSE r.gk_minutes END AS gk_minutes,
      r.gk_wins, r.gk_losses, r.gk_ties, r.team_minutes
    FROM summed r LEFT JOIN school sc ON sc.player_season_id = r.player_season_id
    -- "After the last final" is not enough: the table must also cover every game the team has played (or as many
    -- games for this player as we hold). Some schools never post their last game (48 teams whose season ended on
    -- 2026-10-31 were still a game short on NCAA.com and on their own table weeks later); there the table is a floor
    -- and our game lines, which have that game, give the total.
    CROSS JOIN LATERAL (SELECT coalesce(r.gk_minutes, 0) > 0 AS is_gk,
                               coalesce(sc.fresh AND (sc.complete OR coalesce(sc.gp, 0) >= coalesce(r.gp, 0)), false) AS fresh) k
  )
  INSERT INTO college_player_season_stats AS s (player_season_id, gp, gs, minutes, goals, assists, points, shots, sog, pk_goals, pk_att,
      fouls, yc, rc, corners, offsides, gwg, hat_tricks, ga, saves, shutouts, gk_minutes, gk_wins, gk_losses, gk_ties,
      goals_p90, assists_p90, shots_p90, sog_p90, points_p90, shot_accuracy, conversion_pct, gaa, save_pct, minutes_share,
      goals_1h, goals_2h, goals_ot, minutes_per_goal, shots_per_goal, pk_pct, clean_sheets, saves_p90, computed_at)
  SELECT a.player_season_id, a.gp, a.gs, a.minutes, a.goals, a.assists, a.points, a.shots, a.sog, a.pk_goals, a.pk_att,
      a.fouls, a.yc, a.rc, a.corners, a.offsides, a.gwg, a.hat_tricks, a.ga, a.saves, a.shutouts, a.gk_minutes, a.gk_wins, a.gk_losses, a.gk_ties,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.goals_m::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.assists_m::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.shots_m::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.sog_m::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.points_m::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.shots,0) > 0 THEN round(a.sog::numeric / a.shots, 3) END,
      CASE WHEN coalesce(a.shots,0) > 0 THEN round(a.goals::numeric / a.shots, 3) END,
      CASE WHEN coalesce(a.gk_minutes,0) > 0 THEN round(a.ga_m::numeric * 90 / a.gk_minutes, 3) END,
      CASE WHEN coalesce(a.saves,0) + coalesce(a.ga,0) > 0 THEN round(a.saves::numeric / (a.saves + a.ga), 3) END,
      CASE WHEN coalesce(a.team_minutes,0) > 0 THEN round(a.minutes::numeric / a.team_minutes, 3) END,
      coalesce(h.g1, 0), coalesce(h.g2, 0), coalesce(h.got, 0),
      CASE WHEN coalesce(a.goals_m,0) > 0 AND coalesce(a.minutes,0) > 0 THEN round(a.minutes::numeric / a.goals_m, 1) END,
      CASE WHEN coalesce(a.goals,0) > 0 THEN round(a.shots::numeric / a.goals, 2) END,
      CASE WHEN coalesce(a.pk_att,0) > 0 THEN round(a.pk_goals::numeric / a.pk_att, 3) END,
      a.clean_sheets,
      CASE WHEN coalesce(a.gk_minutes,0) > 0 THEN round(a.saves_m::numeric * 90 / a.gk_minutes, 2) END,
      now()
  FROM agg a LEFT JOIN halves h ON h.player_season_id = a.player_season_id
  ON CONFLICT (player_season_id) DO UPDATE SET
    gp = EXCLUDED.gp, gs = EXCLUDED.gs, minutes = EXCLUDED.minutes, goals = EXCLUDED.goals, assists = EXCLUDED.assists, points = EXCLUDED.points,
    shots = EXCLUDED.shots, sog = EXCLUDED.sog, pk_goals = EXCLUDED.pk_goals, pk_att = EXCLUDED.pk_att, fouls = EXCLUDED.fouls, yc = EXCLUDED.yc, rc = EXCLUDED.rc,
    corners = EXCLUDED.corners, offsides = EXCLUDED.offsides, gwg = EXCLUDED.gwg, hat_tricks = EXCLUDED.hat_tricks, ga = EXCLUDED.ga, saves = EXCLUDED.saves,
    shutouts = EXCLUDED.shutouts, gk_minutes = EXCLUDED.gk_minutes, gk_wins = EXCLUDED.gk_wins, gk_losses = EXCLUDED.gk_losses, gk_ties = EXCLUDED.gk_ties,
    goals_p90 = EXCLUDED.goals_p90, assists_p90 = EXCLUDED.assists_p90, shots_p90 = EXCLUDED.shots_p90, sog_p90 = EXCLUDED.sog_p90, points_p90 = EXCLUDED.points_p90,
    shot_accuracy = EXCLUDED.shot_accuracy, conversion_pct = EXCLUDED.conversion_pct, gaa = EXCLUDED.gaa, save_pct = EXCLUDED.save_pct,
    minutes_share = EXCLUDED.minutes_share, goals_1h = EXCLUDED.goals_1h, goals_2h = EXCLUDED.goals_2h, goals_ot = EXCLUDED.goals_ot,
    minutes_per_goal = EXCLUDED.minutes_per_goal, shots_per_goal = EXCLUDED.shots_per_goal, pk_pct = EXCLUDED.pk_pct, clean_sheets = EXCLUDED.clean_sheets,
    saves_p90 = EXCLUDED.saves_p90, computed_at = now();
  GET DIAGNOSTICS n_players = ROW_COUNT;

  -- ---- player splits ----
  DELETE FROM college_player_season_splits sp USING college_player_seasons ps
   WHERE sp.player_season_id = ps.id AND ps.season = p_season AND (p_program IS NULL OR ps.program_id = p_program);
  -- One team's refresh: a player with a line under this team but a roster row on another (a mislinked line) kept his
  -- old splits and the insert below failed on them.
  IF p_program IS NOT NULL THEN
    DELETE FROM college_player_season_splits sp USING (SELECT DISTINCT player_season_id FROM _truth) t WHERE sp.player_season_id = t.player_season_id;
  END IF;
  INSERT INTO college_player_season_splits (player_season_id, split, gp, gs, minutes, goals, assists, points, shots, sog, saves, ga)
  SELECT t.player_season_id, sp.split,
         count(*) FILTER (WHERE t.participated), count(*) FILTER (WHERE t.starter), sum(t.minutes),
         sum(t.goals), sum(t.assists), sum(coalesce(t.points, coalesce(t.goals,0)*2 + coalesce(t.assists,0))), sum(t.shots), sum(t.shots_on_goal),
         sum(t.saves) FILTER (WHERE t.is_goalie), sum(t.goals_allowed) FILTER (WHERE t.is_goalie)
    FROM _truth t
    CROSS JOIN LATERAL (VALUES
      (CASE WHEN t.neutral_site THEN 'neutral' WHEN t.is_home THEN 'home' ELSE 'away' END),
      (CASE WHEN t.conference_game THEN 'conf' ELSE 'nonconf' END),
      (CASE WHEN EXISTS (SELECT 1 FROM _ranked r WHERE r.game_id = t.game_id AND r.program_id = t.program_id) THEN 'vs_ranked' END)
    ) AS sp(split)
   WHERE sp.split IS NOT NULL
   GROUP BY t.player_season_id, sp.split;
  GET DIAGNOSTICS n_splits = ROW_COUNT;

  -- ---- player ranks / percentiles (whole division, NCAA members only) ----
  -- Season-wide (every player row of the season), so only the full refresh does it; one program's refresh leaves
  -- the ranks to the next full one (hourly in season).
  IF p_program IS NULL THEN
  UPDATE college_player_season_stats s SET div_rank_points = NULL, div_rank_goals = NULL, div_rank_assists = NULL, conf_rank_points = NULL, conf_rank_goals = NULL,
         pct_points_p90 = NULL, pct_goals_p90 = NULL, pct_assists_p90 = NULL, pct_shots_p90 = NULL, pct_save_pct = NULL, pct_gaa = NULL
    FROM college_player_seasons ps WHERE ps.id = s.player_season_id AND ps.season = p_season;
  WITH scope AS (
    SELECT s.player_season_id, s.points, s.goals, s.assists, s.points_p90, s.goals_p90, s.assists_p90, s.shots_p90, s.save_pct, s.gaa,
           coalesce(s.minutes_share, 0) >= 0.3 AS eligible, coalesce(s.gk_minutes, 0) >= 180 AS gk_eligible,
           pr.gender, pse.division, pse.conference_id
      FROM college_player_season_stats s
      JOIN college_player_seasons ps ON ps.id = s.player_season_id
      JOIN college_programs pr ON pr.id = ps.program_id
      JOIN college_program_seasons pse ON pse.program_id = ps.program_id AND pse.season = ps.season
      JOIN college_players p ON p.id = ps.player_id
     WHERE ps.season = p_season AND pse.ncaa_member AND NOT p.suppress
  ), ranked AS (
    SELECT player_season_id,
      rank() OVER (PARTITION BY gender, division ORDER BY points DESC NULLS LAST) AS div_rank_points,
      rank() OVER (PARTITION BY gender, division ORDER BY goals DESC NULLS LAST) AS div_rank_goals,
      rank() OVER (PARTITION BY gender, division ORDER BY assists DESC NULLS LAST) AS div_rank_assists,
      rank() OVER (PARTITION BY gender, division, conference_id ORDER BY points DESC NULLS LAST) AS conf_rank_points,
      rank() OVER (PARTITION BY gender, division, conference_id ORDER BY goals DESC NULLS LAST) AS conf_rank_goals,
      CASE WHEN eligible THEN percent_rank() OVER (PARTITION BY gender, division, eligible ORDER BY points_p90 NULLS FIRST) END AS pct_points_p90,
      CASE WHEN eligible THEN percent_rank() OVER (PARTITION BY gender, division, eligible ORDER BY goals_p90 NULLS FIRST) END AS pct_goals_p90,
      CASE WHEN eligible THEN percent_rank() OVER (PARTITION BY gender, division, eligible ORDER BY assists_p90 NULLS FIRST) END AS pct_assists_p90,
      CASE WHEN eligible THEN percent_rank() OVER (PARTITION BY gender, division, eligible ORDER BY shots_p90 NULLS FIRST) END AS pct_shots_p90,
      CASE WHEN gk_eligible THEN percent_rank() OVER (PARTITION BY gender, division, gk_eligible ORDER BY save_pct NULLS FIRST) END AS pct_save_pct,
      CASE WHEN gk_eligible THEN percent_rank() OVER (PARTITION BY gender, division, gk_eligible ORDER BY gaa DESC NULLS FIRST) END AS pct_gaa
    FROM scope
  )
  UPDATE college_player_season_stats s SET
    div_rank_points = r.div_rank_points, div_rank_goals = r.div_rank_goals, div_rank_assists = r.div_rank_assists,
    conf_rank_points = r.conf_rank_points, conf_rank_goals = r.conf_rank_goals,
    pct_points_p90 = round(r.pct_points_p90::numeric, 3), pct_goals_p90 = round(r.pct_goals_p90::numeric, 3), pct_assists_p90 = round(r.pct_assists_p90::numeric, 3),
    pct_shots_p90 = round(r.pct_shots_p90::numeric, 3), pct_save_pct = round(r.pct_save_pct::numeric, 3), pct_gaa = round(r.pct_gaa::numeric, 3)
  FROM ranked r WHERE r.player_season_id = s.player_season_id;
  END IF;

  -- ---- team season stats ----
  -- Records (W-L-T, goals, splits, form) come from every final game with both programs and a score; box-score
  -- totals (shots, corners, cards…) come from the truth-source team row when one exists. A missing box score
  -- therefore never removes a game from a team's record.
  WITH tg AS (
    SELECT g.id AS game_id, side.program_id, g.season, g.game_date, side.is_home, g.neutral_site, g.conference_game, g.attendance,
           CASE WHEN side.is_home THEN g.home_score ELSE g.away_score END AS gf,
           CASE WHEN side.is_home THEN g.away_score ELSE g.home_score END AS ga, g.forfeit,
           ts.shots, ts.shots_on_goal, ts.corners, ts.fouls, ts.offsides, ts.saves, ts.yellow_cards, ts.red_cards, ts.pk_goals, ts.pk_attempts,
           EXISTS (SELECT 1 FROM _ranked r WHERE r.game_id = g.id AND r.program_id = side.program_id) AS vs_ranked
      FROM college_games g
      CROSS JOIN LATERAL (VALUES (g.home_program_id, true), (g.away_program_id, false)) AS side(program_id, is_home)
      LEFT JOIN college_game_team_stats ts ON ts.game_id = g.id AND ts.program_id = side.program_id AND ts.source = g.source_of_truth
     WHERE g.season = p_season AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
       AND g.home_program_id IS NOT NULL AND g.away_program_id IS NOT NULL
       AND (p_program IS NULL OR side.program_id = p_program)
  ), res AS (
    SELECT *, CASE WHEN gf > ga THEN 'W' WHEN gf < ga THEN 'L' ELSE 'T' END AS r FROM tg
  ), ordered AS (
    SELECT program_id, string_agg(r, '' ORDER BY game_date DESC) AS seq FROM res WHERE NOT forfeit GROUP BY program_id
  ), last5 AS (
    SELECT program_id, sum(gf) AS gf, sum(ga) AS ga FROM (SELECT program_id, gf, ga, row_number() OVER (PARTITION BY program_id ORDER BY game_date DESC) AS rn FROM res WHERE NOT forfeit) x WHERE rn <= 5 GROUP BY program_id
  ), halves AS (
    SELECT side.program_id,
           count(*) FILTER (WHERE e.program_id = side.program_id AND e.period = 1) AS gf1,
           count(*) FILTER (WHERE e.program_id = side.program_id AND e.period = 2) AS gf2,
           count(*) FILTER (WHERE e.program_id <> side.program_id AND e.period = 1) AS ga1,
           count(*) FILTER (WHERE e.program_id <> side.program_id AND e.period = 2) AS ga2
      FROM _goal_events e
      CROSS JOIN LATERAL (VALUES (e.home_program_id), (e.away_program_id)) AS side(program_id)
     WHERE e.program_id IS NOT NULL AND side.program_id IS NOT NULL
     GROUP BY side.program_id
  ), agg AS (
    SELECT program_id, count(*) FILTER (WHERE NOT forfeit) AS gp, count(*) FILTER (WHERE shots IS NOT NULL) AS box_gp,
      count(*) FILTER (WHERE r='W' AND NOT forfeit) AS w, count(*) FILTER (WHERE r='L' AND NOT forfeit) AS l, count(*) FILTER (WHERE r='T' AND NOT forfeit) AS t,
      count(*) FILTER (WHERE r='W' AND conference_game) AS conf_w, count(*) FILTER (WHERE r='L' AND conference_game) AS conf_l, count(*) FILTER (WHERE r='T' AND conference_game) AS conf_t,
      count(*) FILTER (WHERE r='W' AND is_home AND NOT neutral_site AND NOT forfeit) AS home_w, count(*) FILTER (WHERE r='L' AND is_home AND NOT neutral_site AND NOT forfeit) AS home_l, count(*) FILTER (WHERE r='T' AND is_home AND NOT neutral_site AND NOT forfeit) AS home_t,
      count(*) FILTER (WHERE r='W' AND NOT is_home AND NOT neutral_site AND NOT forfeit) AS away_w, count(*) FILTER (WHERE r='L' AND NOT is_home AND NOT neutral_site AND NOT forfeit) AS away_l, count(*) FILTER (WHERE r='T' AND NOT is_home AND NOT neutral_site AND NOT forfeit) AS away_t,
      count(*) FILTER (WHERE r='W' AND neutral_site AND NOT forfeit) AS neutral_w, count(*) FILTER (WHERE r='L' AND neutral_site AND NOT forfeit) AS neutral_l, count(*) FILTER (WHERE r='T' AND neutral_site AND NOT forfeit) AS neutral_t,
      count(*) FILTER (WHERE r='W' AND vs_ranked AND NOT forfeit) AS vs_ranked_w, count(*) FILTER (WHERE r='L' AND vs_ranked AND NOT forfeit) AS vs_ranked_l, count(*) FILTER (WHERE r='T' AND vs_ranked AND NOT forfeit) AS vs_ranked_t,
      sum(gf) FILTER (WHERE NOT forfeit) AS gf, sum(ga) FILTER (WHERE NOT forfeit) AS ga, sum(shots) AS shots, sum(shots_on_goal) AS sog, sum(corners) AS corners, sum(fouls) AS fouls,
      sum(offsides) AS offsides, sum(saves) AS saves, sum(yellow_cards) AS yc, sum(red_cards) AS rc, sum(pk_goals) AS pk_goals, sum(pk_attempts) AS pk_att,
      sum(gf) FILTER (WHERE is_home AND NOT neutral_site AND NOT forfeit) AS gf_home, sum(gf) FILTER (WHERE NOT is_home AND NOT neutral_site AND NOT forfeit) AS gf_away,
      sum(ga) FILTER (WHERE is_home AND NOT neutral_site AND NOT forfeit) AS ga_home, sum(ga) FILTER (WHERE NOT is_home AND NOT neutral_site AND NOT forfeit) AS ga_away,
      count(*) FILTER (WHERE ga = 0 AND NOT forfeit) AS clean_sheets, avg(attendance) FILTER (WHERE is_home AND NOT neutral_site) AS avg_attendance,
      -- Shots per goal and corners per game over the games that have them (shots exist only with a box score).
      sum(gf) FILTER (WHERE shots IS NOT NULL AND NOT forfeit) AS gf_box, count(*) FILTER (WHERE corners IS NOT NULL) AS corners_gp
    FROM res GROUP BY program_id
  )
  INSERT INTO college_team_season_stats AS s (program_id, season, gp, w, l, t, conf_w, conf_l, conf_t, home_w, home_l, home_t, away_w, away_l, away_t,
      neutral_w, neutral_l, neutral_t, gf, ga, gd, shots, sog, corners, fouls, offsides, saves, yc, rc, clean_sheets, avg_attendance, form_last5, streak,
      gf_pg, ga_pg, shots_pg, sog_pg, corners_pg,
      gf_home, gf_away, ga_home, ga_away, gf_1h, gf_2h, ga_1h, ga_2h, shots_per_goal, sog_pct, pk_goals, pk_att,
      vs_ranked_w, vs_ranked_l, vs_ranked_t, ppg, last5_gf, last5_ga, computed_at)
  SELECT a.program_id, p_season, a.gp, a.w, a.l, a.t, a.conf_w, a.conf_l, a.conf_t, a.home_w, a.home_l, a.home_t, a.away_w, a.away_l, a.away_t,
      a.neutral_w, a.neutral_l, a.neutral_t, a.gf, a.ga, a.gf - a.ga, a.shots, a.sog, a.corners, a.fouls, a.offsides, a.saves, a.yc, a.rc, a.clean_sheets,
      round(a.avg_attendance::numeric, 1), left(o.seq, 5),
      (SELECT left(o.seq,1) || length(substring(o.seq from '^(' || left(o.seq,1) || '+)'))),
      round(a.gf::numeric / nullif(a.gp, 0), 2), round(a.ga::numeric / nullif(a.gp, 0), 2), round(a.shots::numeric / nullif(a.box_gp, 0), 2), round(a.sog::numeric / nullif(a.box_gp, 0), 2), round(a.corners::numeric / nullif(a.corners_gp, 0), 2),
      a.gf_home, a.gf_away, a.ga_home, a.ga_away, h.gf1, h.gf2, h.ga1, h.ga2,
      CASE WHEN coalesce(a.gf_box,0) > 0 THEN round(a.shots::numeric / a.gf_box, 2) END,
      CASE WHEN coalesce(a.shots,0) > 0 THEN round(a.sog::numeric / a.shots, 3) END,
      a.pk_goals, a.pk_att,
      a.vs_ranked_w, a.vs_ranked_l, a.vs_ranked_t,
      round((3 * a.w + a.t)::numeric / nullif(a.gp, 0), 2), l5.gf, l5.ga, now()
  FROM agg a LEFT JOIN ordered o ON o.program_id = a.program_id
  LEFT JOIN last5 l5 ON l5.program_id = a.program_id
  LEFT JOIN halves h ON h.program_id = a.program_id
  ON CONFLICT (program_id, season) DO UPDATE SET
    gp = EXCLUDED.gp, w = EXCLUDED.w, l = EXCLUDED.l, t = EXCLUDED.t, conf_w = EXCLUDED.conf_w, conf_l = EXCLUDED.conf_l, conf_t = EXCLUDED.conf_t,
    home_w = EXCLUDED.home_w, home_l = EXCLUDED.home_l, home_t = EXCLUDED.home_t, away_w = EXCLUDED.away_w, away_l = EXCLUDED.away_l, away_t = EXCLUDED.away_t,
    neutral_w = EXCLUDED.neutral_w, neutral_l = EXCLUDED.neutral_l, neutral_t = EXCLUDED.neutral_t, gf = EXCLUDED.gf, ga = EXCLUDED.ga, gd = EXCLUDED.gd,
    shots = EXCLUDED.shots, sog = EXCLUDED.sog, corners = EXCLUDED.corners, fouls = EXCLUDED.fouls, offsides = EXCLUDED.offsides, saves = EXCLUDED.saves,
    yc = EXCLUDED.yc, rc = EXCLUDED.rc, clean_sheets = EXCLUDED.clean_sheets, avg_attendance = EXCLUDED.avg_attendance, form_last5 = EXCLUDED.form_last5,
    streak = EXCLUDED.streak, gf_pg = EXCLUDED.gf_pg, ga_pg = EXCLUDED.ga_pg, shots_pg = EXCLUDED.shots_pg, sog_pg = EXCLUDED.sog_pg, corners_pg = EXCLUDED.corners_pg,
    gf_home = EXCLUDED.gf_home, gf_away = EXCLUDED.gf_away, ga_home = EXCLUDED.ga_home, ga_away = EXCLUDED.ga_away,
    gf_1h = EXCLUDED.gf_1h, gf_2h = EXCLUDED.gf_2h, ga_1h = EXCLUDED.ga_1h, ga_2h = EXCLUDED.ga_2h,
    shots_per_goal = EXCLUDED.shots_per_goal, sog_pct = EXCLUDED.sog_pct, pk_goals = EXCLUDED.pk_goals, pk_att = EXCLUDED.pk_att,
    vs_ranked_w = EXCLUDED.vs_ranked_w, vs_ranked_l = EXCLUDED.vs_ranked_l, vs_ranked_t = EXCLUDED.vs_ranked_t,
    ppg = EXCLUDED.ppg, last5_gf = EXCLUDED.last5_gf, last5_ga = EXCLUDED.last5_ga, computed_at = now();
  GET DIAGNOSTICS n_teams = ROW_COUNT;

  -- ---- team ranks / percentiles (members only, whole division) ----
  IF p_program IS NULL THEN
  UPDATE college_team_season_stats SET div_rank_ppg = NULL, conf_rank_ppg = NULL, conf_rank_gf_pg = NULL, conf_rank_ga_pg = NULL, conf_rank_shots_pg = NULL,
         div_pct_gf_pg = NULL, div_pct_ga_pg = NULL, div_pct_shots_pg = NULL WHERE season = p_season;
  WITH scope AS (
    SELECT ts.program_id, ts.ppg, ts.gf_pg, ts.ga_pg, ts.shots_pg, pr.gender, pse.division, pse.conference_id
      FROM college_team_season_stats ts
      JOIN college_programs pr ON pr.id = ts.program_id
      JOIN college_program_seasons pse ON pse.program_id = ts.program_id AND pse.season = ts.season
     WHERE ts.season = p_season AND pse.ncaa_member AND ts.gp > 0
  ), ranked AS (
    SELECT program_id,
      rank() OVER (PARTITION BY gender, division ORDER BY ppg DESC NULLS LAST) AS div_rank_ppg,
      rank() OVER (PARTITION BY gender, division, conference_id ORDER BY ppg DESC NULLS LAST) AS conf_rank_ppg,
      rank() OVER (PARTITION BY gender, division, conference_id ORDER BY gf_pg DESC NULLS LAST) AS conf_rank_gf_pg,
      rank() OVER (PARTITION BY gender, division, conference_id ORDER BY ga_pg ASC NULLS LAST) AS conf_rank_ga_pg,
      rank() OVER (PARTITION BY gender, division, conference_id ORDER BY shots_pg DESC NULLS LAST) AS conf_rank_shots_pg,
      percent_rank() OVER (PARTITION BY gender, division ORDER BY gf_pg NULLS FIRST) AS div_pct_gf_pg,
      percent_rank() OVER (PARTITION BY gender, division ORDER BY ga_pg DESC NULLS FIRST) AS div_pct_ga_pg,
      percent_rank() OVER (PARTITION BY gender, division ORDER BY shots_pg NULLS FIRST) AS div_pct_shots_pg
    FROM scope
  )
  UPDATE college_team_season_stats s SET
    div_rank_ppg = r.div_rank_ppg, conf_rank_ppg = r.conf_rank_ppg, conf_rank_gf_pg = r.conf_rank_gf_pg, conf_rank_ga_pg = r.conf_rank_ga_pg, conf_rank_shots_pg = r.conf_rank_shots_pg,
    div_pct_gf_pg = round(r.div_pct_gf_pg::numeric, 3), div_pct_ga_pg = round(r.div_pct_ga_pg::numeric, 3), div_pct_shots_pg = round(r.div_pct_shots_pg::numeric, 3)
  FROM ranked r WHERE r.program_id = s.program_id AND s.season = p_season;
  END IF;

  RETURN jsonb_build_object('season', p_season, 'program', p_program, 'players', n_players, 'teams', n_teams, 'splits', n_splits);
END $function$
;

-- ---- duplicate players on one team ----
-- Every player who is twice on the same team in a season (same name key), with the row to keep and a verdict:
--   distinct  the school gives the two different player ids: two people with one name (never merged)
--   unsure    different shirt numbers and both in the same game's lineup (left alone, shown in the quality check)
--   merge     everything else: same number, or a number that changed with no game in common
CREATE OR REPLACE FUNCTION public.college_duplicate_player_seasons(p_season integer)
 RETURNS TABLE (program_id uuid, name_key text, keep_id uuid, drop_id uuid, shared_games integer, verdict text)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH dup AS (
    SELECT s.program_id, p.name_key
      FROM college_player_seasons s JOIN college_players p ON p.id = s.player_id
     WHERE s.season = p_season AND btrim(coalesce(p.name_key, ''), '| ') <> ''
     GROUP BY s.program_id, p.name_key HAVING count(*) > 1
  ), ps AS (
    SELECT s.id, s.program_id, p.name_key, s.jersey, s.source, s.created_at, coalesce(p.site_player_ids, '{}'::jsonb) AS ids,
           (SELECT count(*) FROM college_game_player_stats x WHERE x.player_season_id = s.id) AS lines
      FROM college_player_seasons s JOIN college_players p ON p.id = s.player_id
      JOIN dup d ON d.program_id = s.program_id AND d.name_key = p.name_key
     WHERE s.season = p_season
  ), ranked AS (
    SELECT ps.*, first_value(ps.id) OVER w AS keep_id, first_value(ps.jersey) OVER w AS keep_jersey, first_value(ps.ids) OVER w AS keep_ids
      FROM ps WINDOW w AS (PARTITION BY ps.program_id, ps.name_key ORDER BY (ps.source <> 'boxscore_only') DESC, (ps.ids <> '{}'::jsonb) DESC, ps.lines DESC, ps.created_at, ps.id)
  ), pairs AS (
    SELECT r.program_id, r.name_key, r.keep_id, r.id AS drop_id, r.jersey, r.keep_jersey,
           (SELECT count(DISTINCT a.game_id)::int FROM college_game_player_stats a JOIN college_game_player_stats b
               ON b.game_id = a.game_id AND b.program_id = a.program_id AND b.source = a.source
             WHERE a.player_season_id = r.keep_id AND b.player_season_id = r.id) AS shared_games,
           EXISTS (SELECT 1 FROM jsonb_each_text(r.ids) x JOIN jsonb_each_text(r.keep_ids) y ON y.key = x.key WHERE y.value <> x.value) AS other_person
      FROM ranked r WHERE r.id <> r.keep_id
  )
  SELECT program_id, name_key, keep_id, drop_id, shared_games,
         CASE WHEN other_person THEN 'distinct'
              WHEN jersey IS NOT NULL AND keep_jersey IS NOT NULL AND jersey <> keep_jersey AND shared_games > 0 THEN 'unsure'
              ELSE 'merge' END
    FROM pairs;
$function$;

-- Fold one player season into another of the same team and season: game lines, events, ratings, leaderboard rows,
-- honors and the school's season line move to the kept row; the dropped player goes when no season is left.
CREATE OR REPLACE FUNCTION public.college_merge_player_season(p_from uuid, p_to uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE f college_player_seasons%ROWTYPE; t college_player_seasons%ROWTYPE;
BEGIN
  SELECT * INTO f FROM college_player_seasons WHERE id = p_from FOR UPDATE;
  SELECT * INTO t FROM college_player_seasons WHERE id = p_to FOR UPDATE;
  IF f.id IS NULL OR t.id IS NULL OR f.id = t.id THEN RAISE EXCEPTION 'merge player season: unknown or identical rows'; END IF;
  IF f.program_id <> t.program_id OR f.season <> t.season THEN RAISE EXCEPTION 'merge player season: different team or season'; END IF;

  -- A game both rows have a line for (the same line read twice under two keys): the kept row's line stays.
  DELETE FROM college_game_player_stats a USING college_game_player_stats b
   WHERE a.player_season_id = p_from AND b.player_season_id = p_to AND b.game_id = a.game_id AND b.program_id = a.program_id AND b.source = a.source;
  UPDATE college_game_player_stats SET player_season_id = p_to WHERE player_season_id = p_from;
  UPDATE college_game_events SET player_season_id = p_to WHERE player_season_id = p_from;
  UPDATE college_game_events SET assist_player_season_id = p_to WHERE assist_player_season_id = p_from;
  UPDATE college_player_ratings SET player_season_id = p_to, player_id = t.player_id WHERE player_season_id = p_from;
  UPDATE college_rankings SET player_season_id = p_to WHERE player_season_id = p_from;
  UPDATE college_identity_overrides SET player_season_id = p_to WHERE player_season_id = p_from;
  UPDATE college_player_honors h SET player_season_id = p_to
   WHERE h.player_season_id = p_from AND NOT EXISTS (SELECT 1 FROM college_player_honors k WHERE k.player_season_id = p_to AND k.text = h.text);
  -- The school's season line: the one read last.
  IF EXISTS (SELECT 1 FROM college_site_season_stats a JOIN college_site_season_stats b ON b.player_season_id = p_to
              WHERE a.player_season_id = p_from AND a.fetched_at > b.fetched_at) THEN
    DELETE FROM college_site_season_stats WHERE player_season_id = p_to;
  END IF;
  UPDATE college_site_season_stats SET player_season_id = p_to
   WHERE player_season_id = p_from AND NOT EXISTS (SELECT 1 FROM college_site_season_stats b WHERE b.player_season_id = p_to);

  UPDATE college_player_seasons SET
    jersey = coalesce(t.jersey, f.jersey), position = coalesce(t.position, f.position), position_raw = coalesce(t.position_raw, f.position_raw),
    class_year = coalesce(t.class_year, f.class_year), class_raw = coalesce(t.class_raw, f.class_raw), height_cm = coalesce(t.height_cm, f.height_cm),
    hometown_raw = coalesce(t.hometown_raw, f.hometown_raw), high_school = coalesce(t.high_school, f.high_school),
    previous_school = coalesce(t.previous_school, f.previous_school), headshot_url = coalesce(t.headshot_url, f.headshot_url),
    bio_url = coalesce(t.bio_url, f.bio_url), updated_at = now()
   WHERE id = p_to;
  DELETE FROM college_player_seasons WHERE id = p_from;   -- its season stats, splits and leftovers go with it

  IF f.player_id <> t.player_id AND NOT EXISTS (SELECT 1 FROM college_player_seasons WHERE player_id = f.player_id) THEN
    UPDATE college_players k SET site_player_ids = coalesce(d.site_player_ids, '{}'::jsonb) || coalesce(k.site_player_ids, '{}'::jsonb),
           headshot_url = coalesce(k.headshot_url, d.headshot_url), bio_url = coalesce(k.bio_url, d.bio_url),
           photo_url = coalesce(k.photo_url, d.photo_url), updated_at = now()
      FROM college_players d WHERE k.id = t.player_id AND d.id = f.player_id;
    UPDATE pro_college_links SET college_player_id = t.player_id WHERE college_player_id = f.player_id;
    UPDATE player_photo_submissions SET college_player_id = t.player_id WHERE college_player_id = f.player_id;
    UPDATE college_transfers SET player_id = t.player_id WHERE player_id = f.player_id;
    DELETE FROM college_players WHERE id = f.player_id;
  END IF;
END $function$;

-- Roster rows without a name (a roster page that did not parse) that never played: removed, with their player row.
CREATE OR REPLACE FUNCTION public.college_remove_blank_players(p_season integer)
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  CREATE TEMP TABLE _blank ON COMMIT DROP AS
    SELECT s.id, s.player_id FROM college_player_seasons s JOIN college_players p ON p.id = s.player_id
     WHERE s.season = p_season AND btrim(coalesce(p.name_key, ''), '| ') = ''
       AND NOT EXISTS (SELECT 1 FROM college_game_player_stats x WHERE x.player_season_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM college_game_events e WHERE e.player_season_id = s.id OR e.assist_player_season_id = s.id);
  DELETE FROM college_player_seasons s USING _blank b WHERE s.id = b.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM college_players p USING _blank b
   WHERE p.id = b.player_id AND NOT EXISTS (SELECT 1 FROM college_player_seasons s WHERE s.player_id = p.id);
  DROP TABLE _blank;
  RETURN n;
END $function$;

REVOKE ALL ON FUNCTION public.college_duplicate_player_seasons(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.college_merge_player_season(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.college_remove_blank_players(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_duplicate_player_seasons(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.college_merge_player_season(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.college_remove_blank_players(integer) TO service_role;

-- The season refresh takes under 3 minutes on a quiet database and over 5 beside the quality checks; at the old
-- 300 s limit it was cancelled and rolled back (2026-11-24, twice in one evening). The gateway still answers at ~125 s;
-- this is how long the database may go on working.
ALTER ROLE service_role SET statement_timeout = '600s';
notify pgrst, 'reload config';

notify pgrst, 'reload schema';
