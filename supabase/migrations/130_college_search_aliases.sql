-- Team search finds a school the way people (and Tekki) say it, first time.
--
-- college_search_programs (120) matched only `p.name ILIKE %q%`, `long_name ILIKE %q%` or name similarity > 0.3, so
-- "UNC", "USC", "SMU", "Duke men's soccer" and "University of North Carolina men" missed, and "Penn State" ranked ten
-- branch campuses beside the university. This version:
--   * strips the words that name the sport or the side ("men's", "soccer", "university of", "the", "ncaa") from q;
--   * matches the school's short name, long name and slug too, and `aliases`: the initials of the long name
--     ("University of North Carolina" -> UNC, "Virginia Commonwealth University" -> VCU) and the St./State form of the
--     name ("Michigan St." <-> "Michigan State"), kept by a trigger;
--   * ranks an exact name or alias first, then by similarity;
--   * uses the trigram indexes (`%`, not `similarity() > x`, which cannot use them).
-- Player search keeps its result shape and best-first order (125) but its match uses the index too, so a team search
-- no longer waits on a scan of every player-season.
-- Same signatures and columns. Rollback: re-run the definitions from 120 (programs) and 125 (players).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.college_schools ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.college_school_aliases(p_name text, p_long text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT a) FILTER (WHERE a IS NOT NULL AND length(a) >= 2), '{}')
    FROM (
      -- initials of the long name, skipping small words: "University of North Carolina" -> "UNC"
      SELECT upper(string_agg(left(w, 1), '' ORDER BY i)) AS a
        FROM regexp_split_to_table(regexp_replace(coalesce(p_long, ''), '[^A-Za-z ]', ' ', 'g'), '\s+') WITH ORDINALITY AS t(w, i)
       WHERE w <> '' AND lower(w) NOT IN ('of', 'the', 'at', 'and', 'in')
      HAVING count(*) >= 2
      UNION ALL
      -- "Michigan St." <-> "Michigan State"
      SELECT upper(regexp_replace(p_name, '\mSt\.?(?=$|\s|-)', 'State', 'g'))
      UNION ALL
      SELECT upper(regexp_replace(p_name, '\mState\M', 'St', 'g'))
      UNION ALL
      SELECT upper(regexp_replace(p_name, '\.', '', 'g'))
    ) x;
$$;

CREATE OR REPLACE FUNCTION public.college_schools_set_aliases()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.aliases := public.college_school_aliases(NEW.name, NEW.long_name);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS college_schools_aliases ON public.college_schools;
CREATE TRIGGER college_schools_aliases BEFORE INSERT OR UPDATE OF name, long_name ON public.college_schools
  FOR EACH ROW EXECUTE FUNCTION public.college_schools_set_aliases();
UPDATE public.college_schools SET aliases = public.college_school_aliases(name, long_name);

CREATE INDEX IF NOT EXISTS idx_college_schools_name_trgm ON public.college_schools USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_college_schools_long_name_trgm ON public.college_schools USING gin (long_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_college_schools_aliases ON public.college_schools USING gin (aliases);

/** The part of a search that names the school or player: sport, side and filler words removed (never emptied). */
CREATE OR REPLACE FUNCTION public.college_search_key(q text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN length(k) >= 2 THEN k ELSE lower(trim(q)) END
    FROM (SELECT trim(regexp_replace(regexp_replace(
      regexp_replace(lower(coalesce(q, '')), '[''’.]', '', 'g'),
      '\m(mens|men|womens|women|soccer|football|college|university|univ|team|program|the|of|ncaa|d1|d2|d3)\M', ' ', 'g'),
      '\s+', ' ', 'g')) AS k) t;
$$;

CREATE OR REPLACE FUNCTION public.college_search_programs(q text, p_gender text DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS TABLE (program_id uuid, name text, gender text, school_seo text, logo_svg_url text, athletics_host text, similarity real)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH k AS (SELECT public.college_search_key(q) AS k)
  SELECT p.id, p.name, p.gender, s.seo, s.logo_svg_url, s.athletics_host,
         (CASE WHEN lower(s.name) = k.k OR lower(regexp_replace(p.name, '\.', '', 'g')) = k.k OR upper(k.k) = ANY (s.aliases) THEN 1
               ELSE greatest(similarity(p.name, k.k), similarity(s.name, k.k), similarity(coalesce(s.long_name, ''), k.k)) END)::real AS sim
    FROM k, college_programs p JOIN college_schools s ON s.seo = p.school_seo
   WHERE (p_gender IS NULL OR p.gender = p_gender)
     AND (p.name ILIKE '%' || k.k || '%' OR s.name ILIKE '%' || k.k || '%' OR s.long_name ILIKE '%' || k.k || '%'
          OR upper(k.k) = ANY (s.aliases) OR p.name % k.k OR s.name % k.k OR s.long_name % k.k)
   ORDER BY sim DESC, length(s.name), p.name
   LIMIT least(greatest(p_limit, 1), 50);
$$;

CREATE OR REPLACE FUNCTION public.college_search_players(q text, p_gender text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(player_id uuid, display_name text, gender text, program_id uuid, program_name text, season integer, pos text, class_raw text, headshot_url text, similarity real)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT x.id, x.display_name, x.gender, x.program_id, x.program_name, x.season, x.pos, x.class_raw, x.headshot_url, x.sim
    FROM (
      SELECT DISTINCT ON (pl.id) pl.id, pl.display_name, pr.gender, pr.id AS program_id, pr.name AS program_name, ps.season,
             ps.position AS pos, ps.class_raw, coalesce(ps.headshot_url, pl.headshot_url) AS headshot_url, similarity(pl.display_name, q) AS sim
        FROM college_players pl
        JOIN college_player_seasons ps ON ps.player_id = pl.id
        JOIN college_programs pr ON pr.id = ps.program_id
       WHERE NOT pl.suppress AND (p_gender IS NULL OR pr.gender = p_gender)
         AND (pl.display_name ILIKE '%' || q || '%' OR pl.display_name % q)
       ORDER BY pl.id, ps.season DESC
    ) x
   ORDER BY x.sim DESC, x.season DESC, x.display_name, x.id
   LIMIT least(greatest(p_limit, 1), 50);
$function$;

GRANT EXECUTE ON FUNCTION public.college_search_programs(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.college_search_players(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.college_search_key(text) TO authenticated, service_role;
