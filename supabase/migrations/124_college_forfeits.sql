-- Forfeits: a result a school lists without a score ("W, - Forfeit in conference standings only"). Stored as a
-- final with a nominal 1-0 and forfeit = true; counted in the conference table (conf_w/l/t) but not in overall
-- records, form, goals or NCAA.com comparisons, which is how the conference sites and NCAA.com treat them.
ALTER TABLE public.college_games ADD COLUMN IF NOT EXISTS forfeit boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.college_refresh_season_aggregates(p_season integer, p_program uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_players integer; n_teams integer; n_splits integer;
BEGIN
  -- Truth-source player lines, with minutes / starter / goalkeeper minutes borrowed from the other source for
  -- the same player when the truth source does not publish them (PrestoSports lists minutes only for keepers
  -- and does not mark starters; NCAA.com does).
  DROP TABLE IF EXISTS _truth;
  CREATE TEMP TABLE _truth ON COMMIT DROP AS
    SELECT gps.game_id, gps.program_id, gps.source, gps.source_key, gps.player_season_id,
           coalesce(gps.minutes, alt.minutes) AS minutes,
           (gps.starter OR coalesce(alt.starter, false)) AS starter,
           gps.participated,
           gps.goals, gps.assists, gps.points, gps.shots, gps.shots_on_goal, gps.pk_goals, gps.pk_attempts,
           gps.fouls, gps.yellow_cards, gps.red_cards, gps.corners, gps.offsides, gps.gwg, gps.hat_trick,
           gps.is_goalie, gps.goals_allowed, gps.saves, coalesce(gps.gk_minutes, alt.gk_minutes) AS gk_minutes,
           g.home_program_id, g.away_program_id, g.home_score, g.away_score, g.overtime, g.game_date,
           (gps.program_id = g.home_program_id) AS is_home, g.neutral_site, g.conference_game,
           CASE WHEN gps.program_id = g.home_program_id THEN g.away_program_id ELSE g.home_program_id END AS opp_program_id
      FROM college_game_player_stats gps
      JOIN college_games g ON g.id = gps.game_id
      LEFT JOIN college_game_player_stats alt
             ON alt.game_id = gps.game_id AND alt.program_id = gps.program_id AND alt.player_season_id = gps.player_season_id
            AND alt.source <> gps.source
     WHERE g.season = p_season AND g.status = 'final' AND g.source_of_truth IS NOT NULL AND gps.source = g.source_of_truth
       AND gps.player_season_id IS NOT NULL
       AND (p_program IS NULL OR gps.program_id = p_program);

  -- Games where the opponent was in the USC top 25 of the latest poll published on or before the game date.
  DROP TABLE IF EXISTS _ranked;
  CREATE TEMP TABLE _ranked ON COMMIT DROP AS
    SELECT g.id AS game_id, side.program_id
      FROM college_games g
      CROSS JOIN LATERAL (VALUES (g.home_program_id, g.away_program_id), (g.away_program_id, g.home_program_id)) AS side(program_id, opp_id)
     WHERE g.season = p_season AND g.status = 'final' AND side.program_id IS NOT NULL AND side.opp_id IS NOT NULL
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
     WHERE g.season = p_season AND g.status = 'final' AND ev.source = g.source_of_truth AND ev.event_type = 'goal';

  -- ---- player season stats ----
  WITH team_minutes AS (
    SELECT game_id, program_id, greatest(max(minutes), 90) AS team_min FROM _truth GROUP BY game_id, program_id
  ), halves AS (
    SELECT player_season_id, count(*) FILTER (WHERE period = 1) AS g1, count(*) FILTER (WHERE period = 2) AS g2, count(*) FILTER (WHERE period > 2) AS got
      FROM _goal_events WHERE player_season_id IS NOT NULL GROUP BY player_season_id
  ), agg AS (
    SELECT t.player_season_id,
      count(*) FILTER (WHERE t.participated) AS gp,
      count(*) FILTER (WHERE t.starter) AS gs,
      sum(t.minutes) AS minutes,
      sum(t.goals) AS goals, sum(t.assists) AS assists, sum(coalesce(t.points, coalesce(t.goals,0)*2 + coalesce(t.assists,0))) AS points,
      sum(t.shots) AS shots, sum(t.shots_on_goal) AS sog, sum(t.pk_goals) AS pk_goals, sum(t.pk_attempts) AS pk_att,
      sum(t.fouls) AS fouls, sum(t.yellow_cards) AS yc, sum(t.red_cards) AS rc, sum(t.corners) AS corners, sum(t.offsides) AS offsides,
      sum(t.gwg) AS gwg, count(*) FILTER (WHERE t.hat_trick) AS hat_tricks,
      sum(t.goals_allowed) FILTER (WHERE t.is_goalie) AS ga,
      sum(t.saves) FILTER (WHERE t.is_goalie) AS saves,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) >= 45 AND coalesce(t.goals_allowed,0) = 0
                        AND CASE WHEN t.program_id = t.home_program_id THEN t.away_score ELSE t.home_score END = 0) AS shutouts,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) >= 45 AND coalesce(t.goals_allowed,0) = 0) AS clean_sheets,
      sum(coalesce(t.gk_minutes, t.minutes)) FILTER (WHERE t.is_goalie) AS gk_minutes,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) >= 45 AND
        CASE WHEN t.program_id = t.home_program_id THEN t.home_score > t.away_score ELSE t.away_score > t.home_score END) AS gk_wins,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) >= 45 AND
        CASE WHEN t.program_id = t.home_program_id THEN t.home_score < t.away_score ELSE t.away_score < t.home_score END) AS gk_losses,
      count(*) FILTER (WHERE t.is_goalie AND coalesce(t.gk_minutes, t.minutes, 0) >= 45 AND t.home_score = t.away_score) AS gk_ties,
      sum(tm.team_min) FILTER (WHERE t.participated) AS team_minutes
    FROM _truth t JOIN team_minutes tm ON tm.game_id = t.game_id AND tm.program_id = t.program_id
    GROUP BY t.player_season_id
  )
  INSERT INTO college_player_season_stats AS s (player_season_id, gp, gs, minutes, goals, assists, points, shots, sog, pk_goals, pk_att,
      fouls, yc, rc, corners, offsides, gwg, hat_tricks, ga, saves, shutouts, gk_minutes, gk_wins, gk_losses, gk_ties,
      goals_p90, assists_p90, shots_p90, sog_p90, points_p90, shot_accuracy, conversion_pct, gaa, save_pct, minutes_share,
      goals_1h, goals_2h, goals_ot, minutes_per_goal, shots_per_goal, pk_pct, clean_sheets, saves_p90, computed_at)
  SELECT a.player_season_id, a.gp, a.gs, a.minutes, a.goals, a.assists, a.points, a.shots, a.sog, a.pk_goals, a.pk_att,
      a.fouls, a.yc, a.rc, a.corners, a.offsides, a.gwg, a.hat_tricks, a.ga, a.saves, a.shutouts, a.gk_minutes, a.gk_wins, a.gk_losses, a.gk_ties,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.goals::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.assists::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.shots::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.sog::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.minutes,0) > 0 THEN round(a.points::numeric * 90 / a.minutes, 2) END,
      CASE WHEN coalesce(a.shots,0) > 0 THEN round(a.sog::numeric / a.shots, 3) END,
      CASE WHEN coalesce(a.shots,0) > 0 THEN round(a.goals::numeric / a.shots, 3) END,
      CASE WHEN coalesce(a.gk_minutes,0) > 0 THEN round(a.ga::numeric * 90 / a.gk_minutes, 3) END,
      CASE WHEN coalesce(a.saves,0) + coalesce(a.ga,0) > 0 THEN round(a.saves::numeric / (a.saves + a.ga), 3) END,
      CASE WHEN coalesce(a.team_minutes,0) > 0 THEN round(a.minutes::numeric / a.team_minutes, 3) END,
      coalesce(h.g1, 0), coalesce(h.g2, 0), coalesce(h.got, 0),
      CASE WHEN coalesce(a.goals,0) > 0 AND coalesce(a.minutes,0) > 0 THEN round(a.minutes::numeric / a.goals, 1) END,
      CASE WHEN coalesce(a.goals,0) > 0 THEN round(a.shots::numeric / a.goals, 2) END,
      CASE WHEN coalesce(a.pk_att,0) > 0 THEN round(a.pk_goals::numeric / a.pk_att, 3) END,
      a.clean_sheets,
      CASE WHEN coalesce(a.gk_minutes,0) > 0 THEN round(a.saves::numeric * 90 / a.gk_minutes, 2) END,
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
      count(*) FILTER (WHERE ga = 0) AS clean_sheets, avg(attendance) AS avg_attendance
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
      round(a.gf::numeric / nullif(a.gp, 0), 2), round(a.ga::numeric / nullif(a.gp, 0), 2), round(a.shots::numeric / nullif(a.box_gp, 0), 2), round(a.sog::numeric / nullif(a.box_gp, 0), 2), round(a.corners::numeric / nullif(a.box_gp, 0), 2),
      a.gf_home, a.gf_away, a.ga_home, a.ga_away, h.gf1, h.gf2, h.ga1, h.ga2,
      CASE WHEN coalesce(a.gf,0) > 0 THEN round(a.shots::numeric / a.gf, 2) END,
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

  RETURN jsonb_build_object('season', p_season, 'program', p_program, 'players', n_players, 'teams', n_teams, 'splits', n_splits);
END $$;

-- The schedule view carries the flag (appended so CREATE OR REPLACE is allowed).
CREATE OR REPLACE VIEW public.college_v_schedule WITH (security_invoker = true) AS
SELECT g.id, g.season, g.game_date, g.gender, g.division, g.status,
       g.home_program_id, hp.name AS home_name, hs.seo AS home_seo, hs.logo_svg_url AS home_logo,
       g.away_program_id, ap.name AS away_name, aws.seo AS away_seo, aws.logo_svg_url AS away_logo,
       g.home_score, g.away_score, g.overtime, g.shootout, g.neutral_site, g.conference_game, g.postseason,
       g.tournament, g.attendance, g.venue_name, g.venue_city, g.source_of_truth, g.ncaa_contest_id, g.forfeit
FROM public.college_games g
LEFT JOIN public.college_programs hp ON hp.id = g.home_program_id
LEFT JOIN public.college_schools hs ON hs.seo = hp.school_seo
LEFT JOIN public.college_programs ap ON ap.id = g.away_program_id
LEFT JOIN public.college_schools aws ON aws.seo = ap.school_seo;
