-- Synthetic twins out, post-game timing in.
--
-- 1. college_games.final_at / ncaa_box_first_at, each set once, so the time from full time to the NCAA box score (and
--    on to Plaibook, which logs its own lag) can be measured. ncaa_fetched_at is rewritten on every refetch and
--    live_updated_at on every live tick, so neither can answer it. final_at is backfilled from live_updated_at where
--    the live job closed the game (live_period 'FINAL' is its last write).
--
-- 2. college_merge_program(from, to): folds a synthetic `x-` program into the real NCAA.com program of the same school.
--    Twins appeared when a real program briefly lost its conference (discover-teams wrote a null) and a conference
--    table, schedule or scoreboard then created `x-<name>` beside it: duplicate standings rows (Notre Dame, California
--    twice in the ACC women's table) and unmatched poll rows ("University of Notre Dame"). The jobs no longer create
--    twins (realProgramFor); this repairs the existing ones (job merge-twins).
--      * a twin game that duplicates a real fixture (same opponent, within a day) is dropped, after handing its score
--        and contest id to the real one; other twin games are repointed;
--      * every other row that references the twin is repointed; where the real program already has the row (a unique
--        key collides) the twin's copy is dropped, except player seasons, whose game lines and events move first;
--      * standings, standings checks and season totals of the twin are dropped (recomputed by their jobs);
--      * the real program inherits the twin's conference when it has none (Cal women back in the ACC);
--      * then the twin program goes, and its `x-` school when no program is left on it.
--    Service role only. Rollback: restore from the backup_twins_20261005 tables written before the run.

ALTER TABLE public.college_games ADD COLUMN IF NOT EXISTS final_at timestamptz;
ALTER TABLE public.college_games ADD COLUMN IF NOT EXISTS ncaa_box_first_at timestamptz;

CREATE OR REPLACE FUNCTION public.college_games_stamp_final()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Only a transition seen live counts: a game inserted already final has no known full-time moment.
  IF TG_OP = 'UPDATE' AND NEW.status = 'final' AND OLD.status IS DISTINCT FROM 'final' AND NEW.final_at IS NULL THEN
    NEW.final_at := now();
  END IF;
  IF NEW.status = 'final' AND NEW.ncaa_fetched_at IS NOT NULL AND NEW.ncaa_box_first_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.ncaa_fetched_at IS DISTINCT FROM NEW.ncaa_fetched_at OR OLD.status IS DISTINCT FROM 'final') THEN
    NEW.ncaa_box_first_at := NEW.ncaa_fetched_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS college_games_stamp_final ON public.college_games;
CREATE TRIGGER college_games_stamp_final BEFORE INSERT OR UPDATE ON public.college_games
  FOR EACH ROW EXECUTE FUNCTION public.college_games_stamp_final();
REVOKE EXECUTE ON FUNCTION public.college_games_stamp_final() FROM public, anon, authenticated;

UPDATE public.college_games SET final_at = live_updated_at
 WHERE status = 'final' AND final_at IS NULL AND live_period = 'FINAL' AND live_updated_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.college_merge_program(p_from uuid, p_to uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  f record; t record; g record; r record; fk record;
  opp uuid; dup record; real_ps uuid;
  games_dropped int := 0; games_moved int := 0; rows_moved int := 0; rows_dropped int := 0;
BEGIN
  IF p_from = p_to THEN RAISE EXCEPTION 'same program'; END IF;
  SELECT * INTO f FROM college_programs WHERE id = p_from;
  SELECT * INTO t FROM college_programs WHERE id = p_to;
  IF f.id IS NULL OR t.id IS NULL THEN RAISE EXCEPTION 'program not found'; END IF;
  IF f.gender <> t.gender THEN RAISE EXCEPTION 'genders differ'; END IF;
  IF f.school_seo NOT LIKE 'x-%' OR t.school_seo LIKE 'x-%' THEN RAISE EXCEPTION 'only a synthetic x- program merges into a real one'; END IF;

  -- Games.
  FOR g IN SELECT * FROM college_games WHERE home_program_id = p_from OR away_program_id = p_from LOOP
    opp := CASE WHEN g.home_program_id = p_from THEN g.away_program_id ELSE g.home_program_id END;
    dup := NULL;
    IF opp IS NOT NULL THEN
      SELECT * INTO dup FROM college_games h
       WHERE h.id <> g.id AND abs(h.game_date - g.game_date) <= 1
         AND ((h.home_program_id = p_to AND h.away_program_id = opp) OR (h.away_program_id = p_to AND h.home_program_id = opp))
       ORDER BY (h.ncaa_contest_id IS NOT NULL) DESC, abs(h.game_date - g.game_date) LIMIT 1;
    END IF;
    IF dup.id IS NOT NULL THEN
      IF dup.ncaa_contest_id IS NULL AND g.ncaa_contest_id IS NOT NULL THEN
        UPDATE college_games SET ncaa_contest_id = NULL WHERE id = g.id;
        UPDATE college_games SET ncaa_contest_id = g.ncaa_contest_id WHERE id = dup.id;
      END IF;
      IF dup.home_score IS NULL AND g.home_score IS NOT NULL THEN
        UPDATE college_games SET
          home_score = CASE WHEN (dup.home_program_id = p_to) = (g.home_program_id = p_from) THEN g.home_score ELSE g.away_score END,
          away_score = CASE WHEN (dup.home_program_id = p_to) = (g.home_program_id = p_from) THEN g.away_score ELSE g.home_score END
         WHERE id = dup.id;
      END IF;
      DELETE FROM college_games WHERE id = g.id;
      games_dropped := games_dropped + 1;
    ELSE
      UPDATE college_games SET
        home_program_id = CASE WHEN home_program_id = p_from THEN p_to ELSE home_program_id END,
        away_program_id = CASE WHEN away_program_id = p_from THEN p_to ELSE away_program_id END
       WHERE id = g.id;
      games_moved := games_moved + 1;
    END IF;
  END LOOP;

  -- Derived rows: recomputed by compute-standings / compute-aggregates.
  DELETE FROM college_standings WHERE program_id = p_from;
  DELETE FROM college_standings_checks WHERE program_id = p_from;
  DELETE FROM college_team_season_stats WHERE program_id = p_from;

  -- Membership: the real program keeps its own, inheriting the twin's conference where it has none.
  UPDATE college_program_seasons rs SET conference_id = xs.conference_id
    FROM college_program_seasons xs
   WHERE rs.program_id = p_to AND xs.program_id = p_from AND xs.season = rs.season
     AND rs.conference_id IS NULL AND xs.conference_id IS NOT NULL;

  -- Player seasons: a player on both rosters keeps the real row; the twin row's lines and events move to it first.
  FOR r IN SELECT * FROM college_player_seasons WHERE program_id = p_from LOOP
    SELECT id INTO real_ps FROM college_player_seasons WHERE player_id = r.player_id AND season = r.season AND program_id = p_to;
    IF real_ps IS NULL THEN
      UPDATE college_player_seasons SET program_id = p_to WHERE id = r.id;
      rows_moved := rows_moved + 1;
    ELSE
      BEGIN
        UPDATE college_game_player_stats SET player_season_id = real_ps WHERE player_season_id = r.id;
      EXCEPTION WHEN unique_violation THEN NULL; END;
      UPDATE college_game_events SET player_season_id = real_ps WHERE player_season_id = r.id;
      UPDATE college_game_events SET assist_player_season_id = real_ps WHERE assist_player_season_id = r.id;
      DELETE FROM college_player_seasons WHERE id = r.id;
      rows_dropped := rows_dropped + 1;
    END IF;
  END LOOP;

  -- Everything else that references a program, found from the catalog so no table is missed.
  FOR fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'public.college_programs'::regclass
       AND c.conrelid::regclass::text NOT IN ('college_games', 'college_player_seasons', 'college_standings', 'college_standings_checks', 'college_team_season_stats')
  LOOP
    FOR r IN EXECUTE format('SELECT ctid AS rid FROM %s WHERE %I = $1', fk.tbl, fk.col) USING p_from LOOP
      BEGIN
        EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2', fk.tbl, fk.col) USING p_to, r.rid;
        rows_moved := rows_moved + 1;
      EXCEPTION WHEN unique_violation THEN
        EXECUTE format('DELETE FROM %s WHERE ctid = $1', fk.tbl) USING r.rid;
        rows_dropped := rows_dropped + 1;
      END;
    END LOOP;
  END LOOP;

  DELETE FROM college_programs WHERE id = p_from;
  BEGIN
    DELETE FROM college_schools s WHERE s.seo = f.school_seo AND NOT EXISTS (SELECT 1 FROM college_programs p WHERE p.school_seo = f.school_seo);
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  RETURN jsonb_build_object('from', f.school_seo, 'to', t.school_seo, 'gender', f.gender,
    'games_dropped', games_dropped, 'games_moved', games_moved, 'rows_moved', rows_moved, 'rows_dropped', rows_dropped);
END $$;

REVOKE EXECUTE ON FUNCTION public.college_merge_program(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.college_merge_program(uuid, uuid) TO service_role;
