-- News pictures (2026-10-15): the picture a feed supplies with a story (media:thumbnail, media:content, an image
-- enclosure, the first <img>, GDELT's socialimage, the Guardian's thumbnail). Only its url is kept; the page loads it
-- from the publisher's own server and never copies it. Each source can be switched to headline only in the hub
-- (show_images), which hides its pictures at once, stored ones included. Supersedes the headline-and-link-only rule
-- in 170. Rollback: re-run news_feed from 170; ALTER TABLE news_articles DROP COLUMN image_url; ALTER TABLE
-- news_sources DROP COLUMN show_images.

ALTER TABLE public.news_articles ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.news_sources ADD COLUMN IF NOT EXISTS show_images boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.news_feed(p_scope text, p_type text, p_ids text[], p_kinds text[], p_gender text, p_before timestamptz, p_limit integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '15s' AS $$
  WITH picked AS (
    SELECT a.* FROM news_articles a
    WHERE (p_type IS NULL OR EXISTS (SELECT 1 FROM news_links l WHERE l.article_id = a.id AND l.entity_type = p_type AND l.entity_id = ANY(p_ids)))
      AND (p_scope IS NULL OR p_scope = ANY(a.scope))
      AND (p_kinds IS NULL OR a.kinds && p_kinds)
      AND (p_gender IS NULL OR a.gender IS NULL OR a.gender = p_gender)
      AND a.published_at < coalesce(p_before, now() + interval '1 day')
      AND (a.cluster_id IS NULL OR a.cluster_id = a.id)
    ORDER BY a.published_at DESC
    LIMIT greatest(1, least(p_limit, 60))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'url', p.url, 'title', p.title, 'publisher', p.publisher, 'published_at', p.published_at,
    'kinds', p.kinds, 'scope', p.scope, 'gender', p.gender, 'importance', p.importance,
    'image_url', CASE WHEN p.image_url IS NOT NULL AND coalesce((SELECT s.show_images FROM news_sources s WHERE s.id = p.source_id), true) THEN p.image_url END,
    'outlets', greatest(1, (SELECT count(DISTINCT c.publisher) FROM news_articles c WHERE c.cluster_id = p.id)),
    'also', (SELECT coalesce(jsonb_agg(jsonb_build_object('publisher', c.publisher, 'url', c.url) ORDER BY c.published_at), '[]') FROM (SELECT DISTINCT ON (c.publisher) c.publisher, c.url, c.published_at FROM news_articles c WHERE c.cluster_id = p.id AND c.id <> p.id ORDER BY c.publisher, c.published_at) c),
    'links', (SELECT coalesce(jsonb_agg(jsonb_build_object('type', l.entity_type, 'id', l.entity_id, 'label', l.label, 'href', l.href, 'primary', l.is_primary) ORDER BY l.is_primary DESC, l.entity_type), '[]') FROM news_links l WHERE l.article_id = p.id)
  ) ORDER BY p.published_at DESC), '[]')
  FROM picked p;
$$;

REVOKE ALL ON FUNCTION public.news_feed(text, text, text[], text[], text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.news_feed(text, text, text[], text[], text, timestamptz, integer) TO service_role;
