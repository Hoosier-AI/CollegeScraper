-- Player photos sent in on /photo (2026-10-27): a college player, a parent or guardian, or school staff sends a
-- photo with consent to show it on plaibook.live and in Plaibook's social posts, credited. A founder approves it
-- in the hub (Stats > Requests > Photos), which copies it to the public bucket and sets the player's photo_url.
--   player_photo_submissions: who sent it, the three consents, the IP only as a salted hash (5 an hour per IP).
--     The file sits in the private bucket until approved; declined and removed rows (and files) are deleted after
--     30 days (ops-retention job).
--   college_players.photo_url / photo_credit: the approved photo, kept apart from headshot_url (the crawlers
--     rewrite that one).
-- Rollback: DROP TABLE player_photo_submissions; ALTER TABLE college_players DROP COLUMN photo_url, DROP COLUMN
-- photo_credit; delete the two storage buckets.

CREATE TABLE IF NOT EXISTS public.player_photo_submissions (
  id bigserial PRIMARY KEY,
  college_player_id uuid NOT NULL REFERENCES public.college_players(id) ON DELETE CASCADE,
  storage_path text NOT NULL,          -- in the private bucket player-photo-submissions
  width int,
  height int,
  name text NOT NULL,
  email text NOT NULL,
  relation text NOT NULL CHECK (relation IN ('player', 'parent or guardian', 'school staff')),
  photographer_credit text NOT NULL,   -- how to credit the photo ("Jane Smith", "Rutgers Athletics")
  consent_owner boolean NOT NULL,      -- took it, or the person who took it agreed
  consent_age boolean NOT NULL,        -- the player is 18 or older, or the sender is their parent or guardian
  consent_use boolean NOT NULL,        -- may be shown on plaibook.live and Plaibook's posts until removal is asked
  consented_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'removed')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK (consent_owner AND consent_age AND consent_use)
);
CREATE INDEX IF NOT EXISTS player_photo_submissions_status_idx ON public.player_photo_submissions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS player_photo_submissions_ip_idx ON public.player_photo_submissions (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS player_photo_submissions_player_idx ON public.player_photo_submissions (college_player_id);
ALTER TABLE public.player_photo_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_photo_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_photo_submissions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.player_photo_submissions_id_seq TO service_role;

ALTER TABLE public.college_players ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE public.college_players ADD COLUMN IF NOT EXISTS photo_credit text;

-- Private until approved; the approved copy is public (the site and Plaibook's posts link it).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('player-photo-submissions', 'player-photo-submissions', false, 10485760, ARRAY['image/jpeg']),
       ('player-photos', 'player-photos', true, 10485760, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;
