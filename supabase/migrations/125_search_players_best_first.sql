-- Player search returns the best matches, best first.
--
-- college_search_players (120) ended with `ORDER BY pl.id, ps.season DESC LIMIT n`: the ORDER BY that DISTINCT ON
-- needs was also the final order, so the limit kept the n LOWEST UUIDS among the matches and the rows came back in no
-- useful order. Live, q=garcia&limit=5 returned similarities 0.54 0.35 0.50 0.50 0.50 while a 0.70 match existed
-- and was cut. docs/API.md promises "best first"; college_search_programs already did it.
--
-- Same signature, same columns, same filters (suppressed players stay out). The DISTINCT ON moves into a subquery and
-- the outer query ranks by similarity. No extra work: every match had to be sorted before the limit already.
-- Rollback: re-run the college_search_players definition from 120_college_soccer.sql.
CREATE OR REPLACE FUNCTION public.college_search_players(q text, p_gender text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(player_id uuid, display_name text, gender text, program_id uuid, program_name text, season integer, pos text, class_raw text, headshot_url text, similarity real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT x.id, x.display_name, x.gender, x.program_id, x.program_name, x.season, x.pos, x.class_raw, x.headshot_url, x.sim
    FROM (
      SELECT DISTINCT ON (pl.id) pl.id, pl.display_name, pr.gender, pr.id AS program_id, pr.name AS program_name, ps.season,
             ps.position AS pos, ps.class_raw, coalesce(ps.headshot_url, pl.headshot_url) AS headshot_url, similarity(pl.display_name, q) AS sim
        FROM college_players pl
        JOIN college_player_seasons ps ON ps.player_id = pl.id
        JOIN college_programs pr ON pr.id = ps.program_id
       WHERE NOT pl.suppress AND (p_gender IS NULL OR pr.gender = p_gender)
         AND (pl.display_name ILIKE '%' || q || '%' OR similarity(pl.display_name, q) > 0.3)
       ORDER BY pl.id, ps.season DESC            -- one row per player: their latest season
    ) x
   ORDER BY x.sim DESC, x.season DESC, x.display_name, x.id
   LIMIT least(greatest(p_limit, 1), 50);
$function$;
