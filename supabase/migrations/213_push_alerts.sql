-- App alerts (the iOS app, no user accounts): devices, what each one follows, the last state seen of every match,
-- the alerts derived from a change of that state, and which device was sent which alert. Functions are in 214.
-- Everything is written and read by the service role only (src/push): RLS on with no policies.
--   push_devices          one row per install. token_hash = sha256 (hex) of the 256-bit install token the device makes
--                         and sends as `Authorization: Device <token>`; the token itself is never stored. apns_token is
--                         cleared when Apple says it is gone. prefs: which alerts, and quiet hours ("HH:MM" in `tz`).
--   push_device_follows   kind is one of the site's follow kinds (team, player, pro-team, pro-player, conference,
--                         pro-league); ref is the id as text; events is a bitmask (1 kick-off, 2 goal, 4 half-time,
--                         8 full time).
--   push_match_state      match_key 'c:<college game uuid>' or 'p:<pro fixture id>'; status is 'scheduled', 'live' or
--                         'final' (anything else is stored as 'scheduled'); gen goes up when a score goes down, a final
--                         is corrected or a final goes back to live, so the same scoreline can alert again.
--   push_events           one alert to send. dedupe_key is unique: two servers seeing the same change make one row.
--                         status: pending -> sending (claimed) -> sent | expired | failed.
--   push_sent             inserted BEFORE the send; only rows actually inserted are sent (at most once per device).
-- Rollback: DROP TABLE push_sent, push_events, push_match_state, push_device_follows, push_devices;

CREATE TABLE IF NOT EXISTS public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  apns_token text,
  apns_env text CHECK (apns_env IN ('sandbox', 'production')),
  tz text,
  prefs jsonb NOT NULL DEFAULT '{"kickoff": true, "goal": true, "halftime": true, "final": true, "quiet_start": null, "quiet_end": null}'::jsonb,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_devices_last_seen_idx ON public.push_devices (last_seen);
CREATE INDEX IF NOT EXISTS push_devices_apns_token_idx ON public.push_devices (apns_token) WHERE apns_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.push_device_follows (
  device_id uuid NOT NULL REFERENCES public.push_devices(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('team', 'player', 'pro-team', 'pro-player', 'conference', 'pro-league')),
  ref text NOT NULL,
  events smallint NOT NULL DEFAULT 15 CHECK (events BETWEEN 0 AND 15),
  PRIMARY KEY (device_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS push_device_follows_kind_ref_idx ON public.push_device_follows (kind, ref);

CREATE TABLE IF NOT EXISTS public.push_match_state (
  match_key text PRIMARY KEY,
  status text NOT NULL,
  home int,
  away int,
  gen int NOT NULL DEFAULT 0,
  period text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_match_state_updated_idx ON public.push_match_state (updated_at);

CREATE TABLE IF NOT EXISTS public.push_events (
  id bigserial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  match_key text NOT NULL,
  type text NOT NULL CHECK (type IN ('kickoff', 'goal', 'halftime', 'final')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'expired', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz                -- when a sender took it; one left 'sending' for 3 minutes is taken again (214)
);
CREATE INDEX IF NOT EXISTS push_events_waiting_idx ON public.push_events (id) WHERE status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS push_events_created_idx ON public.push_events (created_at);

CREATE TABLE IF NOT EXISTS public.push_sent (
  event_id bigint NOT NULL REFERENCES public.push_events(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.push_devices(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, device_id)
);
CREATE INDEX IF NOT EXISTS push_sent_device_idx ON public.push_sent (device_id);
CREATE INDEX IF NOT EXISTS push_sent_at_idx ON public.push_sent (sent_at);

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_device_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_match_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.push_device_follows FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.push_match_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.push_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.push_sent FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_device_follows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_match_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_sent TO service_role;
REVOKE ALL ON SEQUENCE public.push_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.push_events_id_seq TO service_role;
