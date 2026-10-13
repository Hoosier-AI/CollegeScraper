-- News for college, pro and international (2026-10-13): stories from school athletics feeds, publisher RSS feeds,
-- GDELT, the Guardian and club/federation feeds, linked to our teams, players, leagues and conferences by rules (no
-- AI). We keep the headline, the link, the publisher and our own tags; the feed's lede is kept only to re-run the
-- rules (match_text) and is never shown. Rollback: DROP FUNCTION news_feed(...); DROP TABLE news_links,
-- news_articles, news_sources.

CREATE TABLE IF NOT EXISTS public.news_sources (
  id text PRIMARY KEY,                       -- 'school:<program uuid>', 'feed:bbc-football', 'gdelt:<query id>', 'club:<team id>' ...
  kind text NOT NULL CHECK (kind IN ('school', 'publisher', 'gdelt', 'guardian', 'club', 'federation')),
  name text NOT NULL,
  url text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('college', 'pro', 'international')),
  gender text CHECK (gender IN ('m', 'w')),
  program_id uuid,
  pro_team_id integer,
  enabled boolean NOT NULL DEFAULT true,
  terms_url text,
  last_fetched_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  fails integer NOT NULL DEFAULT 0,
  items integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The source's own team (a school or club feed): every story from it links that team.
ALTER TABLE public.news_sources ADD COLUMN IF NOT EXISTS link_label text;
ALTER TABLE public.news_sources ADD COLUMN IF NOT EXISTS link_href text;
CREATE INDEX IF NOT EXISTS news_sources_due_idx ON public.news_sources (kind, last_fetched_at NULLS FIRST) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.news_articles (
  id bigserial PRIMARY KEY,
  url_hash text NOT NULL UNIQUE,             -- md5 of the normalised url
  url text NOT NULL,
  source_id text NOT NULL REFERENCES public.news_sources(id) ON DELETE CASCADE,
  publisher text NOT NULL,
  title text NOT NULL,
  published_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  kinds text[] NOT NULL DEFAULT '{}',
  scope text[] NOT NULL DEFAULT '{}',
  gender text CHECK (gender IN ('m', 'w')),
  cluster_id bigint,
  importance smallint NOT NULL DEFAULT 0,
  match_text text                            -- title + the feed's lede (600 chars), for re-tagging only; never shown
);
CREATE INDEX IF NOT EXISTS news_articles_published_idx ON public.news_articles (published_at DESC);
CREATE INDEX IF NOT EXISTS news_articles_scope_idx ON public.news_articles USING gin (scope);
CREATE INDEX IF NOT EXISTS news_articles_kinds_idx ON public.news_articles USING gin (kinds);
CREATE INDEX IF NOT EXISTS news_articles_cluster_idx ON public.news_articles (cluster_id);

CREATE TABLE IF NOT EXISTS public.news_links (
  article_id bigint NOT NULL REFERENCES public.news_articles(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('program', 'college_player', 'conference', 'pro_team', 'pro_player', 'pro_league')),
  entity_id text NOT NULL,
  label text NOT NULL,
  href text,                                 -- our page for the entity (the viewer's path)
  method text NOT NULL CHECK (method IN ('scope', 'exact', 'context', 'tag')),
  is_primary boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL,         -- copied from the article: an entity's feed is one index scan
  PRIMARY KEY (article_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS news_links_entity_idx ON public.news_links (entity_type, entity_id, published_at DESC);

ALTER TABLE public.news_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_links ENABLE ROW LEVEL SECURITY;

-- A page of stories, newest first, for one entity (p_type + p_ids, any of them) or a whole scope, optionally only some
-- kinds and one gender. Each story carries its links and how many outlets ran the same story (its cluster).
-- Only the lead story of a cluster is listed (the oldest one we hold), so a big story shows once.
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
    'outlets', greatest(1, (SELECT count(DISTINCT c.publisher) FROM news_articles c WHERE c.cluster_id = p.id)),
    'also', (SELECT coalesce(jsonb_agg(jsonb_build_object('publisher', c.publisher, 'url', c.url) ORDER BY c.published_at), '[]') FROM (SELECT DISTINCT ON (c.publisher) c.publisher, c.url, c.published_at FROM news_articles c WHERE c.cluster_id = p.id AND c.id <> p.id ORDER BY c.publisher, c.published_at) c),
    'links', (SELECT coalesce(jsonb_agg(jsonb_build_object('type', l.entity_type, 'id', l.entity_id, 'label', l.label, 'href', l.href, 'primary', l.is_primary) ORDER BY l.is_primary DESC, l.entity_type), '[]') FROM news_links l WHERE l.article_id = p.id)
  ) ORDER BY p.published_at DESC), '[]')
  FROM picked p;
$$;

REVOKE ALL ON FUNCTION public.news_feed(text, text, text[], text[], text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.news_feed(text, text, text[], text[], text, timestamptz, integer) TO service_role;

-- Every senior club and national team with the priority of the best league it plays in this season (lower = more
-- important), for the news linker: when two clubs share a name ("Liverpool"), the one in the bigger league wins.
-- Youth and reserve sides are left out (a story about "Chelsea" is not about Chelsea U21).
CREATE OR REPLACE FUNCTION public.news_team_index()
RETURNS TABLE(id integer, name text, display_name text, gender text, is_national boolean, slug text, country text, priority integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '60s' AS $$
  SELECT t.id, t.name, t.display_name, t.gender, t.national, t.slug, t.country,
         coalesce(min(l.priority), 999)::int AS priority
  FROM pro_teams t
  LEFT JOIN pro_league_teams lt ON lt.team_id = t.id
  LEFT JOIN pro_leagues l ON l.id = lt.league_id AND lt.season = l.current_season AND l.enabled
  WHERE t.id > 0 AND t.slug IS NOT NULL
    AND t.name !~* '(\mU-?\d{2}\M|\mII\M|\mIII\M| B$| C$|\mreserves?\M|\macademy\M|\myouth\M|\mjuniors?\M)'
  GROUP BY t.id
  HAVING t.national OR min(l.priority) IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.news_team_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.news_team_index() TO service_role;
