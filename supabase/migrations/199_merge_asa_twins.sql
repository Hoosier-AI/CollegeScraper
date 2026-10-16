-- 199: one person, one player. asa-fill created a player (negative id) for every ASA profile its name map could not
-- place, including people API-Football already has under a longer legal name ("Pep Biel" vs "Josep Biel Mas Jaume").
-- 2026-10-16: 792 such twins played for the same club as their real record, and club squads showed the twin (Charlotte's
-- top scorer among them) while the real player's page missed the season. These functions fold a twin into the real
-- player; asa-fill now matches by club, season, birth date and surname before it creates anyone, and calls
-- pro_merge_asa_twins() first on every run.
-- Rollback: drop both functions (merged rows stay merged; the slug redirects keep old links working).

CREATE OR REPLACE FUNCTION public.pro_merge_player(p_from integer, p_to integer) RETURNS void
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_slug text;
BEGIN
  IF p_from = p_to OR p_from IS NULL OR p_to IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pro_players WHERE id = p_to) THEN RETURN; END IF;
  -- The id map: the source now names the real player.
  UPDATE pro_source_ids SET pro_id = p_to, method = 'merged', updated_at = now() WHERE kind = 'player' AND pro_id = p_from;
  -- Season lines: the real player's own line wins where both have one (API-Football's totals carry starts, cards
  -- and ratings); the twin's lines for anything else move over.
  DELETE FROM pro_player_season_stats s WHERE s.player_id = p_from
    AND EXISTS (SELECT 1 FROM pro_player_season_stats t WHERE t.player_id = p_to AND t.league_id = s.league_id AND t.season = s.season AND t.team_id = s.team_id);
  UPDATE pro_player_season_stats SET player_id = p_to WHERE player_id = p_from;
  DELETE FROM pro_squads s WHERE s.player_id = p_from AND EXISTS (SELECT 1 FROM pro_squads t WHERE t.player_id = p_to AND t.team_id = s.team_id);
  UPDATE pro_squads SET player_id = p_to WHERE player_id = p_from;
  UPDATE pro_fixture_players SET player_id = p_to WHERE player_id = p_from;
  UPDATE pro_fixture_events SET player_id = p_to WHERE player_id = p_from;
  DELETE FROM pro_transfers s WHERE s.player_id = p_from
    AND EXISTS (SELECT 1 FROM pro_transfers t WHERE t.player_id = p_to AND t.date = s.date AND t.from_team_id = s.from_team_id AND t.to_team_id = s.to_team_id);
  UPDATE pro_transfers SET player_id = p_to WHERE player_id = p_from;
  DELETE FROM pro_injuries s WHERE s.player_id = p_from
    AND EXISTS (SELECT 1 FROM pro_injuries t WHERE t.player_id = p_to AND t.league_id = s.league_id AND t.season = s.season AND t.fixture_id = s.fixture_id);
  UPDATE pro_injuries SET player_id = p_to WHERE player_id = p_from;
  DELETE FROM pro_sidelined s WHERE s.player_id = p_from
    AND EXISTS (SELECT 1 FROM pro_sidelined t WHERE t.player_id = p_to AND t.start = s.start AND t.type = s.type);
  UPDATE pro_sidelined SET player_id = p_to WHERE player_id = p_from;
  UPDATE pro_salaries SET player_id = p_to WHERE player_id = p_from;
  DELETE FROM pro_college_links s WHERE s.pro_player_id = p_from
    AND EXISTS (SELECT 1 FROM pro_college_links t WHERE t.pro_player_id = p_to);
  UPDATE pro_college_links SET pro_player_id = p_to WHERE pro_player_id = p_from;
  DELETE FROM pro_player_refresh WHERE player_id = p_from;
  -- Old links to the twin's page land on the real one.
  SELECT slug INTO v_slug FROM pro_players WHERE id = p_from;
  IF v_slug IS NOT NULL THEN
    INSERT INTO pro_slug_redirects (kind, slug, target_id) VALUES ('player', v_slug, p_to) ON CONFLICT (kind, slug) DO UPDATE SET target_id = excluded.target_id;
  END IF;
  UPDATE pro_slug_redirects SET target_id = p_to WHERE kind = 'player' AND target_id = p_from;
  DELETE FROM pro_players WHERE id = p_from;
END $$;

-- Twins: a created player (negative id) and exactly one real player who played for the same club in the same season,
-- born the same day, with the same surname (last word of the shown name, accents and case ignored). Set-based: the
-- twin map is built once and each table is rewritten in one statement (a per-player loop scanned the 2M-row event
-- table thousands of times).
CREATE OR REPLACE FUNCTION public.pro_merge_asa_twins() RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public' SET statement_timeout TO '900s' AS $$
DECLARE n integer;
BEGIN
  DROP TABLE IF EXISTS pg_temp.twin_map;
  CREATE TEMP TABLE twin_map (nid integer PRIMARY KEY, pid integer NOT NULL) ON COMMIT DROP;
  INSERT INTO twin_map (nid, pid)
    WITH neg AS (
      SELECT DISTINCT s.player_id nid, s.team_id, s.season, p.birth_date,
             lower(unaccent(regexp_replace(trim(p.display_name), '^.*\s', ''))) sur
        FROM pro_player_season_stats s JOIN pro_players p ON p.id = s.player_id
       WHERE s.player_id < 0 AND p.birth_date IS NOT NULL
    ), pos AS (
      SELECT DISTINCT fp.team_id, f.season, fp.player_id pid FROM pro_fixture_players fp JOIN pro_fixtures f ON f.id = fp.fixture_id WHERE fp.player_id > 0
      UNION
      SELECT DISTINCT s.team_id, s.season, s.player_id FROM pro_player_season_stats s WHERE s.player_id > 0
    ), cand AS (
      SELECT DISTINCT neg.nid, pp.id pid
        FROM neg JOIN pos ON pos.team_id = neg.team_id AND pos.season = neg.season
        JOIN pro_players pp ON pp.id = pos.pid
       WHERE pp.birth_date = neg.birth_date
         AND (lower(unaccent(regexp_replace(trim(pp.display_name), '^.*\s', ''))) = neg.sur
              OR lower(unaccent(coalesce(pp.last_name, ''))) LIKE '%' || neg.sur || '%'
              OR lower(unaccent(coalesce(pp.name, ''))) LIKE '%' || neg.sur || '%')
    )
    SELECT nid, min(pid) FROM cand GROUP BY nid HAVING count(DISTINCT pid) = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN 0; END IF;

  UPDATE pro_source_ids s SET pro_id = m.pid, method = 'merged', updated_at = now() FROM twin_map m WHERE s.kind = 'player' AND s.pro_id = m.nid;

  -- Season lines: the real player's own line wins; of two twins with the same line, the one with more minutes.
  DELETE FROM pro_player_season_stats s USING twin_map m
   WHERE s.player_id = m.nid
     AND EXISTS (SELECT 1 FROM pro_player_season_stats t WHERE t.player_id = m.pid AND t.league_id = s.league_id AND t.season = s.season AND t.team_id = s.team_id);
  DELETE FROM pro_player_season_stats s USING (
    SELECT s2.ctid c, row_number() OVER (PARTITION BY m.pid, s2.league_id, s2.season, s2.team_id ORDER BY s2.minutes DESC NULLS LAST) rn
      FROM pro_player_season_stats s2 JOIN twin_map m ON m.nid = s2.player_id) d
   WHERE s.ctid = d.c AND d.rn > 1;
  UPDATE pro_player_season_stats s SET player_id = m.pid FROM twin_map m WHERE s.player_id = m.nid;

  DELETE FROM pro_squads s USING twin_map m WHERE s.player_id = m.nid AND EXISTS (SELECT 1 FROM pro_squads t WHERE t.player_id = m.pid AND t.team_id = s.team_id);
  UPDATE pro_squads s SET player_id = m.pid FROM twin_map m WHERE s.player_id = m.nid;
  UPDATE pro_fixture_players s SET player_id = m.pid FROM twin_map m WHERE s.player_id = m.nid;
  UPDATE pro_fixture_events s SET player_id = m.pid FROM twin_map m WHERE s.player_id = m.nid;
  DELETE FROM pro_transfers s USING twin_map m WHERE s.player_id = m.nid
     AND EXISTS (SELECT 1 FROM pro_transfers t WHERE t.player_id = m.pid AND t.date = s.date AND t.from_team_id = s.from_team_id AND t.to_team_id = s.to_team_id);
  UPDATE pro_transfers s SET player_id = m.pid FROM twin_map m WHERE s.player_id = m.nid;
  DELETE FROM pro_injuries s USING twin_map m WHERE s.player_id = m.nid
     AND EXISTS (SELECT 1 FROM pro_injuries t WHERE t.player_id = m.pid AND t.league_id = s.league_id AND t.season = s.season AND t.fixture_id = s.fixture_id);
  UPDATE pro_injuries s SET player_id = m.pid FROM twin_map m WHERE s.player_id = m.nid;
  DELETE FROM pro_sidelined s USING twin_map m WHERE s.player_id = m.nid
     AND EXISTS (SELECT 1 FROM pro_sidelined t WHERE t.player_id = m.pid AND t.start = s.start AND t.type = s.type);
  UPDATE pro_sidelined s SET player_id = m.pid FROM twin_map m WHERE s.player_id = m.nid;
  UPDATE pro_salaries s SET player_id = m.pid FROM twin_map m WHERE s.player_id = m.nid;
  -- College links: the real player's own link wins; of two twins' links, one.
  DELETE FROM pro_college_links s USING twin_map m WHERE s.pro_player_id = m.nid AND EXISTS (SELECT 1 FROM pro_college_links t WHERE t.pro_player_id = m.pid);
  DELETE FROM pro_college_links s USING (
    SELECT s2.ctid c, row_number() OVER (PARTITION BY m.pid ORDER BY s2.ctid) rn FROM pro_college_links s2 JOIN twin_map m ON m.nid = s2.pro_player_id) d
   WHERE s.ctid = d.c AND d.rn > 1;
  UPDATE pro_college_links s SET pro_player_id = m.pid FROM twin_map m WHERE s.pro_player_id = m.nid;
  DELETE FROM pro_player_refresh s USING twin_map m WHERE s.player_id = m.nid;

  -- Old links to a twin's page land on the real one.
  INSERT INTO pro_slug_redirects (kind, slug, target_id)
    SELECT 'player', p.slug, m.pid FROM pro_players p JOIN twin_map m ON m.nid = p.id WHERE p.slug IS NOT NULL
  ON CONFLICT (kind, slug) DO UPDATE SET target_id = excluded.target_id;
  UPDATE pro_slug_redirects r SET target_id = m.pid FROM twin_map m WHERE r.kind = 'player' AND r.target_id = m.nid;
  DELETE FROM pro_players p USING twin_map m WHERE p.id = m.nid;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.pro_merge_player(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pro_merge_asa_twins() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_merge_player(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pro_merge_asa_twins() TO service_role;
