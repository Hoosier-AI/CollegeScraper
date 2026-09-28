-- Readable, stable addresses for the public pages (search engines index these instead of UUIDs).
--   teams        /teams/<college_schools.seo>/<men|women>   (existing columns, nothing to add)
--   conferences  /conferences/<college_conferences.ncaa_seo> (existing column)
--   players      /players/<college_players.slug>             e.g. jane-doe-3f2a9c
--   matches      /matches/<college_games.slug>               e.g. 2026-09-12-duke-at-wake-forest-men
-- Slugs are set by triggers on insert and when the name (players) or the date/sides (games) change; the old
-- slug is kept in college_slug_redirects so an address that was indexed keeps answering with a 301.
-- college_players.noindex keeps a profile out of search engines and sitemaps (removal requests) without
-- hiding it the way `suppress` does.
-- Re-runnable: IF NOT EXISTS / CREATE OR REPLACE, and the backfills only touch rows without a slug.

BEGIN;

SET LOCAL statement_timeout = '15min';
-- Fail fast rather than queue behind a crawler transaction (the ALTERs below block reads while waiting).
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.college_players ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.college_players ADD COLUMN IF NOT EXISTS noindex boolean NOT NULL DEFAULT false;
ALTER TABLE public.college_games ADD COLUMN IF NOT EXISTS slug text;

CREATE TABLE IF NOT EXISTS public.college_slug_redirects (
  kind text NOT NULL CHECK (kind IN ('player','game')),
  slug text NOT NULL,
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, slug)
);
ALTER TABLE public.college_slug_redirects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.college_slug_redirects FROM anon, authenticated;
GRANT ALL ON public.college_slug_redirects TO service_role;

-- "Zoë O'Neil-Brønn" -> "zoe-oneil-bronn". Lower case ASCII letters, digits and single hyphens; NULL when empty.
CREATE OR REPLACE FUNCTION public.college_slugify(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT nullif(trim(both '-' from left(trim(both '-' from regexp_replace(
    translate(
      replace(replace(replace(regexp_replace(lower(coalesce(p, '')), '[''`’‘]', '', 'g'), 'æ', 'ae'), 'œ', 'oe'), 'ß', 'ss'),
      'áàâäãåāăąçćčďđéèêëēėęěğíìîïīįıłľĺñńňóòôöõøōőŕřśšşťţúùûüūůűųýÿžźż',
      'aaaaaaaaacccddeeeeeeeegiiiiiiilllnnnoooooooorrsssttuuuuuuuuyyzzz'),
    '[^a-z0-9]+', '-', 'g')), 80)), '')
$$;

-- Player: <name>-<first 6 hex of the id>; on the rare clash, more of the id.
CREATE OR REPLACE FUNCTION public.college_players_set_slug() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  base text := coalesce(public.college_slugify(NEW.display_name), 'player');
  hex text := replace(NEW.id::text, '-', '');
  n integer := 6;
  cand text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.slug IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.slug IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    -- Set by hand: keep it, and let the old address redirect.
    IF OLD.slug IS NOT NULL THEN
      INSERT INTO public.college_slug_redirects (kind, slug, target_id) VALUES ('player', OLD.slug, NEW.id)
      ON CONFLICT (kind, slug) DO UPDATE SET target_id = EXCLUDED.target_id, created_at = now();
    END IF;
    RETURN NEW;
  END IF;
  -- Still derived from the current name: nothing to do.
  IF NEW.slug IS NOT NULL AND NEW.slug ~ ('^' || base || '-[0-9a-f]{6,32}$') THEN RETURN NEW; END IF;
  LOOP
    cand := base || '-' || left(hex, n);
    EXIT WHEN n >= 32 OR NOT EXISTS (SELECT 1 FROM public.college_players WHERE slug = cand AND id <> NEW.id);
    n := n + 2;
  END LOOP;
  IF TG_OP = 'UPDATE' AND OLD.slug IS NOT NULL AND OLD.slug <> cand THEN
    INSERT INTO public.college_slug_redirects (kind, slug, target_id) VALUES ('player', OLD.slug, NEW.id)
    ON CONFLICT (kind, slug) DO UPDATE SET target_id = EXCLUDED.target_id, created_at = now();
  END IF;
  NEW.slug := cand;
  RETURN NEW;
END $$;

-- Game: yyyy-mm-dd-<away>-at-<home>-<men|women>, sides by school slug (the name when the side is unresolved).
-- The gender is part of the base because both programs of two schools often meet on the same day.
CREATE OR REPLACE FUNCTION public.college_game_slug_base(p_date date, p_gender text, p_home uuid, p_away uuid, p_home_name text, p_away_name text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT to_char(p_date, 'YYYY-MM-DD')
    || '-' || coalesce((SELECT public.college_slugify(school_seo) FROM public.college_programs WHERE id = p_away), public.college_slugify(p_away_name), 'tbd')
    || '-at-' || coalesce((SELECT public.college_slugify(school_seo) FROM public.college_programs WHERE id = p_home), public.college_slugify(p_home_name), 'tbd')
    || '-' || CASE WHEN p_gender = 'w' THEN 'women' ELSE 'men' END
$$;

CREATE OR REPLACE FUNCTION public.college_games_set_slug() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  base text;
  hex text := replace(NEW.id::text, '-', '');
  n integer := 8;
  cand text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.slug IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.slug IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    IF OLD.slug IS NOT NULL THEN
      INSERT INTO public.college_slug_redirects (kind, slug, target_id) VALUES ('game', OLD.slug, NEW.id)
      ON CONFLICT (kind, slug) DO UPDATE SET target_id = EXCLUDED.target_id, created_at = now();
    END IF;
    RETURN NEW;
  END IF;
  base := public.college_game_slug_base(NEW.game_date, NEW.gender, NEW.home_program_id, NEW.away_program_id, NEW.home_name, NEW.away_name);
  IF NEW.slug IS NOT NULL AND (NEW.slug = base OR NEW.slug ~ ('^' || base || '-[0-9a-f]{8,32}$')) THEN RETURN NEW; END IF;
  cand := base;
  WHILE EXISTS (SELECT 1 FROM public.college_games WHERE slug = cand AND id <> NEW.id) AND n <= 32 LOOP
    cand := base || '-' || left(hex, n);
    n := n + 4;
  END LOOP;
  IF TG_OP = 'UPDATE' AND OLD.slug IS NOT NULL AND OLD.slug <> cand THEN
    INSERT INTO public.college_slug_redirects (kind, slug, target_id) VALUES ('game', OLD.slug, NEW.id)
    ON CONFLICT (kind, slug) DO UPDATE SET target_id = EXCLUDED.target_id, created_at = now();
  END IF;
  NEW.slug := cand;
  RETURN NEW;
END $$;

-- Plain indexes first so the backfill's clash checks are index lookups, not a scan per row.
CREATE INDEX IF NOT EXISTS college_players_slug_backfill_idx ON public.college_players(slug);
CREATE INDEX IF NOT EXISTS college_games_slug_backfill_idx ON public.college_games(slug);

-- ---------- backfill (updated_at triggers off, so sitemap lastmod keeps meaning "data changed") ----------
ALTER TABLE public.college_players DISABLE TRIGGER trg_college_players_updated_at;
ALTER TABLE public.college_games DISABLE TRIGGER trg_college_games_updated_at;
DROP TRIGGER IF EXISTS trg_college_players_slug ON public.college_players;
DROP TRIGGER IF EXISTS trg_college_games_slug ON public.college_games;

WITH c AS (
  SELECT id, coalesce(public.college_slugify(display_name), 'player') AS base, replace(id::text, '-', '') AS hex
  FROM public.college_players WHERE slug IS NULL
), r AS (
  SELECT id, base, hex, row_number() OVER (PARTITION BY base || '-' || left(hex, 6) ORDER BY id) AS rn FROM c
)
UPDATE public.college_players p
SET slug = CASE WHEN r.rn = 1 AND NOT EXISTS (SELECT 1 FROM public.college_players x WHERE x.slug = r.base || '-' || left(r.hex, 6))
                THEN r.base || '-' || left(r.hex, 6) ELSE r.base || '-' || r.hex END
FROM r WHERE r.id = p.id;

WITH c AS (
  SELECT g.id, replace(g.id::text, '-', '') AS hex, g.created_at,
         to_char(g.game_date, 'YYYY-MM-DD')
           || '-' || coalesce(public.college_slugify(ap.school_seo), public.college_slugify(g.away_name), 'tbd')
           || '-at-' || coalesce(public.college_slugify(hp.school_seo), public.college_slugify(g.home_name), 'tbd')
           || '-' || CASE WHEN g.gender = 'w' THEN 'women' ELSE 'men' END AS base
  FROM public.college_games g
  LEFT JOIN public.college_programs hp ON hp.id = g.home_program_id
  LEFT JOIN public.college_programs ap ON ap.id = g.away_program_id
  WHERE g.slug IS NULL
), r AS (
  SELECT id, hex, base, row_number() OVER (PARTITION BY base ORDER BY created_at, id) AS rn FROM c
)
UPDATE public.college_games g
SET slug = CASE WHEN r.rn = 1 AND NOT EXISTS (SELECT 1 FROM public.college_games x WHERE x.slug = r.base)
                THEN r.base ELSE r.base || '-' || left(r.hex, 8) END
FROM r WHERE r.id = g.id;

ALTER TABLE public.college_players ENABLE TRIGGER trg_college_players_updated_at;
ALTER TABLE public.college_games ENABLE TRIGGER trg_college_games_updated_at;

CREATE UNIQUE INDEX IF NOT EXISTS college_players_slug_key ON public.college_players(slug);
CREATE UNIQUE INDEX IF NOT EXISTS college_games_slug_key ON public.college_games(slug);
DROP INDEX IF EXISTS public.college_players_slug_backfill_idx;
DROP INDEX IF EXISTS public.college_games_slug_backfill_idx;

CREATE TRIGGER trg_college_players_slug BEFORE INSERT OR UPDATE OF display_name, slug ON public.college_players
  FOR EACH ROW EXECUTE FUNCTION public.college_players_set_slug();
CREATE TRIGGER trg_college_games_slug BEFORE INSERT OR UPDATE OF game_date, gender, home_program_id, away_program_id, home_name, away_name, slug ON public.college_games
  FOR EACH ROW EXECUTE FUNCTION public.college_games_set_slug();

COMMIT;

NOTIFY pgrst, 'reload schema';
