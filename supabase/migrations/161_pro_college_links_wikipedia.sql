-- College-to-pro links from Wikipedia "College career" rows (method 'wikipedia', 2026-10-12). Rollback: the 134 check.
ALTER TABLE public.pro_college_links DROP CONSTRAINT IF EXISTS pro_college_links_method_check;
ALTER TABLE public.pro_college_links ADD CONSTRAINT pro_college_links_method_check CHECK (method = ANY (ARRAY['wikidata'::text, 'name_age'::text, 'manual'::text, 'wikipedia'::text]));
