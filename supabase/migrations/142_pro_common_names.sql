-- People by the names they are known by. API-Football's full names read "Lionel Messi Cuccittini"; its short name
-- ("L. Messi") carries the surname people use. pro_common_name():
--   "L. Messi" + first "Lionel Andrés"      -> "Lionel Messi"
--   "V. van Dijk" + first "Virgil"           -> "Virgil van Dijk"
--   "Neymar" / "Virgil Deen" (no initials, one or two words) -> as written
--   anything else                            -> the name we had
-- Slugs stay put when a name changes (pages keep their address; only new people get a slug from the new name).
-- Re-runnable. The display names themselves are rewritten in batches by a script, not here (662k rows).

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.pro_common_name(p_short text, p_first text, p_last text, p_display text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_short ~ '^([[:upper:]][[:alpha:]]?\.\s*)+\S' AND nullif(trim(p_first), '') IS NOT NULL
      AND position(lower(regexp_replace(p_short, '^([[:upper:]][[:alpha:]]?\.\s*)+', '')) IN lower(coalesce(p_last, '') || ' ' || coalesce(p_display, ''))) > 0
      THEN split_part(trim(p_first), ' ', 1) || ' ' || regexp_replace(p_short, '^([[:upper:]][[:alpha:]]?\.\s*)+', '')
    WHEN p_short !~ '\.' AND length(trim(p_short)) > 1 AND array_length(regexp_split_to_array(trim(p_short), '\s+'), 1) <= 2
      THEN trim(p_short)
    ELSE p_display
  END
$$;

CREATE OR REPLACE FUNCTION public.pro_players_set_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cand text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug AND NEW.slug IS NOT NULL THEN
    PERFORM public.pro_remember_slug('player', OLD.slug, NEW.slug, NEW.id); RETURN NEW;
  END IF;
  -- A new name keeps the address the page already has.
  IF TG_OP = 'UPDATE' AND OLD.slug IS NOT NULL THEN NEW.slug := OLD.slug; RETURN NEW; END IF;
  cand := coalesce(public.college_slugify(NEW.display_name), 'player') || '-' || NEW.id;
  NEW.slug := cand;
  RETURN NEW;
END $$;

COMMIT;
