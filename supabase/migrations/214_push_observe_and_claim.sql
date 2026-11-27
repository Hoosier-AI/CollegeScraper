-- App alerts, part 2 (tables in 213): the two functions the service calls.
--
-- push_observe_many(snapshots jsonb) -> the push_events rows it inserted.
--   `snapshots` is a JSON array; each item is what a crawl job just stored for one match (src/push/observe.ts,
--   MatchSnapshot): { key, status, home, away, period?, kickoff?, elapsed?, prev?, teams, league?, refs?, to, scorer? }.
--   Per snapshot the state row is locked, compared with the snapshot, written, and the alerts that follow from the
--   change are inserted (the snapshot itself, less `prev`, is the alert's payload, with `gen` and `corrected` added).
--
--   THE RULES BELOW MUST STAY THE SAME AS diffMatch() IN src/push/observe.ts (tests/push/observe.test.ts is the
--   matrix; the TypeScript is the reference, this is the copy that runs). Change both or neither.
--     phase   = 'live' | 'final' | 'scheduled' (every other status counts as scheduled)
--     score   = a missing score compares as 0
--     minutes = snapshot.elapsed when given, else minutes since snapshot.kickoff, else unknown
--     fresh   = kickoff unknown, or no more than 8 hours ago
--     base    = the stored state; when there is none, snapshot.prev (what the job's own row said before this
--               write) with gen 0; when there is neither, this is the first sight of the match
--     first sight:        live with minutes known and <= 5 -> kickoff. Anything else (live for longer, live with
--                         minutes unknown, final, scheduled) -> nothing.
--     scheduled -> live:  kickoff
--     final -> live:      gen + 1, nothing (the final was taken back)
--     live -> live:       a side's score lower -> gen + 1, nothing (goal disallowed);
--                         else a side's score higher -> ONE goal, carrying the new score
--     live now, 'p:' key, period 'HT', and the base was not already live at 'HT' -> halftime (as well as the above)
--     not final -> final: final, when fresh
--     final -> final:     score differs -> gen + 1, and final again (corrected), when fresh
--     -> scheduled:       nothing (a revert resets silently; gen is kept, so a flapping feed cannot alert twice)
--     keys (gen AFTER any bump): <key>:kickoff:<gen>, <key>:goal:<gen>:<home>-<away>, <key>:halftime:<gen>,
--                         <key>:final:<gen>. The key is unique in push_events, so two servers seeing the same
--                         change insert one row and only one of them gets it back.
--
-- push_claim_events(n) -> up to n waiting alerts, marked 'sending'. FOR UPDATE SKIP LOCKED: two senders never take
--   the same row. One left 'sending' for 3 minutes (its sender died) is taken again; push_sent still stops a second
--   delivery to a device that already got it.
-- Rollback: DROP FUNCTION public.push_observe_many(jsonb); DROP FUNCTION public.push_claim_events(integer);

CREATE OR REPLACE FUNCTION public.push_observe_many(snapshots jsonb)
RETURNS SETOF public.push_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb;
  k text;
  st text;               -- the snapshot's phase
  sh int; sa int;        -- the snapshot's score as given (may be null)
  nh int; na int;        -- the same, null as 0
  np text;               -- the snapshot's period
  ko timestamptz;
  mins numeric;
  fresh boolean;
  p public.push_match_state%ROWTYPE;
  seen boolean;          -- a state row exists
  has_base boolean;      -- there is something to compare with (the row, or snapshot.prev)
  pst text; ph int; pa int; pp text;
  g int;
  corrected boolean;
  types text[];
  t text;
  dk text;
BEGIN
  IF snapshots IS NULL OR jsonb_typeof(snapshots) <> 'array' THEN RETURN; END IF;
  -- In key order, so two calls holding several of the same rows never wait on each other in a circle.
  FOR s IN SELECT e.value FROM jsonb_array_elements(snapshots) WITH ORDINALITY AS e(value, n) ORDER BY e.value->>'key', e.n LOOP
    k := s->>'key';
    IF k IS NULL OR k = '' THEN CONTINUE; END IF;
    st := CASE s->>'status' WHEN 'live' THEN 'live' WHEN 'final' THEN 'final' ELSE 'scheduled' END;
    sh := (s->>'home')::int;
    sa := (s->>'away')::int;
    nh := COALESCE(sh, 0);
    na := COALESCE(sa, 0);
    np := s->>'period';
    ko := (s->>'kickoff')::timestamptz;
    mins := CASE WHEN s->>'elapsed' IS NOT NULL THEN (s->>'elapsed')::numeric
                 WHEN ko IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - ko)) / 60.0
                 ELSE NULL END;
    fresh := ko IS NULL OR now() - ko <= interval '8 hours';
    types := ARRAY[]::text[];
    corrected := false;
    g := 0;
    pst := NULL; ph := 0; pa := 0; pp := NULL;

    SELECT * INTO p FROM public.push_match_state WHERE match_key = k FOR UPDATE;
    seen := FOUND;
    has_base := seen;
    IF seen THEN
      pst := p.status; ph := COALESCE(p.home, 0); pa := COALESCE(p.away, 0); pp := p.period; g := p.gen;
    ELSIF jsonb_typeof(s->'prev') = 'object' THEN
      has_base := true;
      pst := CASE s->'prev'->>'status' WHEN 'live' THEN 'live' WHEN 'final' THEN 'final' ELSE 'scheduled' END;
      ph := COALESCE((s->'prev'->>'home')::int, 0);
      pa := COALESCE((s->'prev'->>'away')::int, 0);
    END IF;

    IF NOT has_base THEN
      IF st = 'live' AND mins IS NOT NULL AND mins <= 5 THEN types := array_append(types, 'kickoff'); END IF;
    ELSIF st = 'live' THEN
      IF pst = 'scheduled' THEN
        types := array_append(types, 'kickoff');
      ELSIF pst = 'final' THEN
        g := g + 1;
      ELSIF nh < ph OR na < pa THEN
        g := g + 1;
      ELSIF nh > ph OR na > pa THEN
        types := array_append(types, 'goal');
      END IF;
      IF k LIKE 'p:%' AND upper(COALESCE(np, '')) = 'HT' AND NOT (pst = 'live' AND upper(COALESCE(pp, '')) = 'HT') THEN
        types := array_append(types, 'halftime');
      END IF;
    ELSIF st = 'final' THEN
      IF pst <> 'final' THEN
        IF fresh THEN types := array_append(types, 'final'); END IF;
      ELSIF nh <> ph OR na <> pa THEN
        g := g + 1;
        corrected := true;
        IF fresh THEN types := array_append(types, 'final'); END IF;
      END IF;
    END IF;

    IF NOT seen THEN
      -- Two servers on a first sight: the second waits here for the first, then writes the same values.
      INSERT INTO public.push_match_state (match_key, status, home, away, gen, period, updated_at)
      VALUES (k, st, sh, sa, g, np, now())
      ON CONFLICT (match_key) DO UPDATE SET status = EXCLUDED.status, home = EXCLUDED.home, away = EXCLUDED.away,
        gen = GREATEST(public.push_match_state.gen, EXCLUDED.gen), period = EXCLUDED.period, updated_at = now();
    ELSIF p.status IS DISTINCT FROM st OR p.home IS DISTINCT FROM sh OR p.away IS DISTINCT FROM sa
       OR p.gen IS DISTINCT FROM g OR p.period IS DISTINCT FROM np THEN
      UPDATE public.push_match_state SET status = st, home = sh, away = sa, gen = g, period = np, updated_at = now()
      WHERE match_key = k;
    END IF;

    FOREACH t IN ARRAY types LOOP
      dk := k || ':' || t || ':' || g::text || CASE WHEN t = 'goal' THEN ':' || nh::text || '-' || na::text ELSE '' END;
      RETURN QUERY
        INSERT INTO public.push_events (dedupe_key, match_key, type, payload)
        VALUES (dk, k, t, (s - 'prev') || jsonb_build_object('gen', g, 'corrected', corrected AND t = 'final'))
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING *;
    END LOOP;
  END LOOP;
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.push_observe_many(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_observe_many(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.push_claim_events(n integer DEFAULT 50)
RETURNS SETOF public.push_events
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.push_events e
     SET status = 'sending', claimed_at = now()
   WHERE e.id IN (
     SELECT w.id FROM public.push_events w
      WHERE w.status = 'pending' OR (w.status = 'sending' AND w.claimed_at < now() - interval '3 minutes')
      ORDER BY w.id
      LIMIT GREATEST(1, LEAST(COALESCE(n, 50), 500))
      FOR UPDATE SKIP LOCKED)
  RETURNING e.*;
$$;
REVOKE ALL ON FUNCTION public.push_claim_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_claim_events(integer) TO service_role;
