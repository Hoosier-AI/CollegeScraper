-- Match stats from scraped sources (football-data.co.uk: shots, shots on target, fouls, corners, cards, referee), one
-- row per source game (pro_src_games). football-data-fill copies them onto matched pro matches that have no team
-- stats yet (pro_fixture_team_stats, extra.source = 'football-data'), so club pages get shots and corners without
-- spending API-Football requests. Rollback: drop the table.

CREATE TABLE IF NOT EXISTS public.pro_src_game_stats (
  source text NOT NULL,
  ext_id text NOT NULL,
  league_id integer NOT NULL,
  season integer NOT NULL,
  referee text,
  home_shots smallint, away_shots smallint,
  home_shots_on smallint, away_shots_on smallint,
  home_fouls smallint, away_fouls smallint,
  home_corners smallint, away_corners smallint,
  home_yellow smallint, away_yellow smallint,
  home_red smallint, away_red smallint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, ext_id)
);
CREATE INDEX IF NOT EXISTS pro_src_game_stats_league_idx ON public.pro_src_game_stats (source, league_id, season);
ALTER TABLE public.pro_src_game_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pro_src_game_stats FROM anon, authenticated;

-- Wikidata and Wikipedia people (wikidata-sync): club articles (found from the Wikipedia tables' club links) list
-- their squads; each player's article gives the career (senior, youth, college, international: years, club, apps,
-- goals) and the Wikidata item; the item gives birth date, height, nationality and position. wikidata-fill matches
-- them to pro players (birth date, name, club) and fills what API-Football left empty.
ALTER TABLE public.pro_src_teams ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE public.pro_src_players ADD COLUMN IF NOT EXISTS birth_place text;
ALTER TABLE public.pro_src_players ADD COLUMN IF NOT EXISTS wiki_title text;
ALTER TABLE public.pro_src_players ADD COLUMN IF NOT EXISTS club_title text;
ALTER TABLE public.pro_src_players ADD COLUMN IF NOT EXISTS number smallint;

-- Club articles to read (one row per Wikipedia title), and when they were.
CREATE TABLE IF NOT EXISTS public.pro_wiki_clubs (
  title text PRIMARY KEY,
  league_id integer,
  team_ext text,
  pro_team_id integer,
  qid text,
  players integer,
  read_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Player articles to read (from the squads), and when they were.
CREATE TABLE IF NOT EXISTS public.pro_wiki_players (
  title text PRIMARY KEY,
  club_title text,
  qid text,
  read_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pro_wiki_players_todo_idx ON public.pro_wiki_players (read_at NULLS FIRST);
-- Career rows from a player's article infobox (CC BY-SA, credited), by Wikidata item.
CREATE TABLE IF NOT EXISTS public.pro_src_spells (
  qid text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('senior', 'youth', 'college', 'international')),
  seq smallint NOT NULL,
  years text,
  start_year smallint,
  end_year smallint,
  team text NOT NULL,
  team_title text,
  apps smallint,
  goals smallint,
  loan boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (qid, kind, seq)
);
-- Names of Wikidata items (countries, positions) so a player's nationality reads as a word.
CREATE TABLE IF NOT EXISTS public.pro_wikidata_labels (
  qid text PRIMARY KEY,
  label text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pro_wiki_clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_wiki_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_src_spells ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_wikidata_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pro_wiki_clubs, public.pro_wiki_players, public.pro_src_spells, public.pro_wikidata_labels FROM anon, authenticated;

-- Matched Wikidata people fill what API-Football left empty on their pro player (and record the Wikidata item).
CREATE OR REPLACE FUNCTION public.pro_fill_from_wikidata() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '120s' AS $$
DECLARE n integer;
BEGIN
  UPDATE pro_players p SET
    wikidata_qid = coalesce(p.wikidata_qid, s.ext_id),
    birth_date = coalesce(p.birth_date, s.birth_date),
    birth_place = coalesce(nullif(p.birth_place, ''), s.birth_place),
    height_cm = coalesce(p.height_cm, s.height_cm),
    nationality = coalesce(nullif(p.nationality, ''), s.nationality),
    updated_at = now()
  FROM pro_source_ids i
  JOIN pro_src_players s ON s.source = 'wikidata' AND s.ext_id = i.ext_id
  WHERE i.source = 'wikidata' AND i.kind = 'player' AND i.pro_id = p.id AND NOT i.rejected
    AND (p.wikidata_qid IS NULL OR (p.birth_date IS NULL AND s.birth_date IS NOT NULL) OR (coalesce(p.birth_place, '') = '' AND s.birth_place IS NOT NULL)
         OR (p.height_cm IS NULL AND s.height_cm IS NOT NULL) OR (coalesce(p.nationality, '') = '' AND s.nationality IS NOT NULL));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pro_fill_from_wikidata() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_fill_from_wikidata() TO service_role;
