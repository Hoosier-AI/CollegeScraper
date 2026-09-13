-- Sanity checks for the college soccer data layer. Run against the Plaibook database
-- (psql "$DATABASE_URL" -v season=2025 -f scripts/sanity.sql). Every query should return 0 rows
-- or the documented tolerance.

\set season :season

-- 1. Final games with a truth source must have exactly two team-stat rows for that source.
SELECT g.id, g.game_date, g.home_name, g.away_name, count(ts.*) AS team_rows
FROM college_games g LEFT JOIN college_game_team_stats ts ON ts.game_id = g.id AND ts.source = g.source_of_truth
WHERE g.season = :season AND g.status = 'final' AND g.source_of_truth IS NOT NULL
GROUP BY g.id HAVING count(ts.*) <> 2;

-- 2. Team goals must equal the game score.
SELECT g.id, g.game_date, ts.program_id, ts.is_home, ts.goals, CASE WHEN ts.is_home THEN g.home_score ELSE g.away_score END AS score
FROM college_games g JOIN college_game_team_stats ts ON ts.game_id = g.id AND ts.source = g.source_of_truth
WHERE g.season = :season AND g.status = 'final' AND ts.goals IS DISTINCT FROM CASE WHEN ts.is_home THEN g.home_score ELSE g.away_score END;

-- 3. Player goals per (game, program) must sum to the team goals.
SELECT ps.game_id, ps.program_id, sum(ps.goals) AS player_goals, ts.goals AS team_goals
FROM college_game_player_stats ps
JOIN college_games g ON g.id = ps.game_id AND ps.source = g.source_of_truth
JOIN college_game_team_stats ts ON ts.game_id = ps.game_id AND ts.program_id = ps.program_id AND ts.source = ps.source
WHERE g.season = :season AND g.status = 'final'
GROUP BY ps.game_id, ps.program_id, ts.goals HAVING sum(ps.goals) IS DISTINCT FROM ts.goals;

-- 4. Site minutes per side should be roughly 11 x (90 + OT). Tolerance ±20.
SELECT ps.game_id, ps.program_id, sum(ps.minutes) AS minutes, g.overtime
FROM college_game_player_stats ps JOIN college_games g ON g.id = ps.game_id
WHERE g.season = :season AND g.status = 'final' AND ps.source = 'site' AND ps.participated
GROUP BY ps.game_id, ps.program_id, g.overtime
HAVING abs(sum(ps.minutes) - (CASE WHEN g.overtime THEN 1100 ELSE 990 END)) > 20;

-- 5. Aggregates vs the school's own cumulative table (goals/assists exact, minutes ±10, GP ±1).
SELECT s.player_season_id, pr.name AS program, a.goals, s.goals AS site_goals, a.assists, s.assists AS site_assists, a.minutes, s.minutes AS site_minutes, a.gp, s.gp AS site_gp
FROM college_site_season_stats s
JOIN college_player_season_stats a ON a.player_season_id = s.player_season_id
JOIN college_player_seasons ps ON ps.id = s.player_season_id JOIN college_programs pr ON pr.id = ps.program_id
WHERE ps.season = :season AND (
  a.goals IS DISTINCT FROM s.goals OR a.assists IS DISTINCT FROM s.assists
  OR abs(coalesce(a.minutes,0) - coalesce(s.minutes,0)) > 10 OR abs(coalesce(a.gp,0) - coalesce(s.gp,0)) > 1)
ORDER BY pr.name;

-- 6. Site vs NCAA disagreement rate per program (team-stat rows present from both sources). Expect < 3%.
WITH both_src AS (
  SELECT s.game_id, s.program_id,
         (s.goals IS DISTINCT FROM n.goals OR s.shots IS DISTINCT FROM n.shots OR s.yellow_cards IS DISTINCT FROM n.yellow_cards) AS differs
  FROM college_game_team_stats s JOIN college_game_team_stats n ON n.game_id = s.game_id AND n.program_id = s.program_id AND n.source = 'ncaa'
  JOIN college_games g ON g.id = s.game_id
  WHERE s.source = 'site' AND g.season = :season)
SELECT pr.name, count(*) AS games, count(*) FILTER (WHERE differs) AS differing, round(100.0 * count(*) FILTER (WHERE differs) / count(*), 1) AS pct
FROM both_src b JOIN college_programs pr ON pr.id = b.program_id GROUP BY pr.name HAVING count(*) FILTER (WHERE differs) > 0 ORDER BY pct DESC;

-- 7. Program-seasons without a site roster (expect ≤ 5%).
SELECT pr.name, pse.division, s.site_platform
FROM college_program_seasons pse JOIN college_programs pr ON pr.id = pse.program_id JOIN college_schools s ON s.seo = pr.school_seo
WHERE pse.season = :season AND NOT EXISTS (SELECT 1 FROM college_player_seasons x WHERE x.program_id = pse.program_id AND x.season = pse.season AND x.source <> 'boxscore_only');

-- 8. Duplicate roster identities within a program-season.
SELECT ps.program_id, ps.season, ps.jersey, p.name_key, count(*)
FROM college_player_seasons ps JOIN college_players p ON p.id = ps.player_id
WHERE ps.season = :season GROUP BY 1,2,3,4 HAVING count(*) > 1;

-- 9. Standings conference record vs computed record.
SELECT pr.name, st.conf_w, st.conf_l, st.conf_t, ts.conf_w AS calc_w, ts.conf_l AS calc_l, ts.conf_t AS calc_t
FROM college_standings st JOIN college_team_season_stats ts ON ts.program_id = st.program_id AND ts.season = st.season
JOIN college_programs pr ON pr.id = st.program_id
WHERE st.season = :season AND (st.conf_w IS DISTINCT FROM ts.conf_w OR st.conf_l IS DISTINCT FROM ts.conf_l OR st.conf_t IS DISTINCT FROM ts.conf_t);

-- 10. Fetch error rate per host in the last 7 days (expect < 2%).
SELECT host, count(*) AS fetches, count(*) FILTER (WHERE error IS NOT NULL) AS errors, round(100.0 * count(*) FILTER (WHERE error IS NOT NULL) / count(*), 1) AS pct
FROM college_source_fetches WHERE fetched_at > now() - interval '7 days'
GROUP BY host HAVING count(*) FILTER (WHERE error IS NOT NULL) > 0 ORDER BY pct DESC LIMIT 50;
