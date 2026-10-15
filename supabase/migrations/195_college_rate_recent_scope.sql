-- college-ratings re-rated every final every half hour (2026-10-15): college_rate_recent picked games by
-- greatest(final_at, site_fetched_at, ncaa_fetched_at, updated_at) in the last 3 days, and updated_at is touched on
-- nearly every final (27,964 of 27,969), so each run re-rated ~420k lines in one 2-minute statement. That held the
-- database, the site's reads queued behind it and Render answered 502; the job itself hit the 2-minute upstream
-- timeout. Now: games that went final in the last 3 days, games of the last 14 days whose box score was fetched again
-- in the last 3 days, and any game of the last 30 days with no ratings yet (about 840 games in season).
-- A correction to an older box score is re-rated with college_rate_season (the job's `season` param).
-- Rollback: re-run 189's college_rate_recent.

CREATE OR REPLACE FUNCTION public.college_rate_recent() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public SET statement_timeout TO '10min' AS $$
  SELECT college_rate_games(coalesce((SELECT array_agg(g.id) FROM college_games g
    WHERE g.status = 'final' AND g.source_of_truth IS NOT NULL
      AND (g.final_at > now() - interval '3 days'
        OR (g.game_date >= current_date - 14 AND greatest(g.site_fetched_at, g.ncaa_fetched_at) > now() - interval '3 days')
        OR (g.game_date >= current_date - 30 AND NOT EXISTS (SELECT 1 FROM college_player_ratings r WHERE r.game_id = g.id)))), '{}'))
$$;
