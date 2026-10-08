# Schema of the scraper's database

These files are the schema of the scraper's own Supabase project (`college-stats-demo`, the one `supabase/.temp`
links to and Render's `SUPABASE_URL` points at). They used to sit in `plaibook/supabase/migrations/`, where they could
only do harm: Plaibook's project must never have them applied (its own `college_*` tables are closed by its
migration 127 and it reads through this service's `/v1` API), and `124_college_forfeits.sql` shared version 124 with
Plaibook's tracked `124_owner_console_v5.sql`. `120_college_soccer.sql` is a copy; Plaibook keeps its own because 120
is part of that project's applied history.

**How they are applied.** By hand, as SQL, in order: the Supabase SQL editor, or the management endpoint
`POST https://api.supabase.com/v1/projects/nogtyfqgmpfslbrlcacl/database/query`, or psql through the pooler (`aws-0-us-west-2.pooler.supabase.com`, user `postgres.nogtyfqgmpfslbrlcacl`, password `DEMO_DB_PASSWORD` in `.env`). This project has no
`supabase_migrations.schema_migrations` table, so the numbers are only an order, and `supabase db push` is not used.
Every file is written to be re-runnable (`IF NOT EXISTS`, `CREATE OR REPLACE`).

| file | what | applied to production |
|---|---|---|
| 120_college_soccer.sql | tables, views, RPCs | yes |
| 122_college_standings_v2.sql | richer aggregates, standings v2, checks | yes |
| 123_college_wmt_platform.sql | `wmt` site platform | yes |
| 124_college_forfeits.sql | forfeits | yes |
| 125_search_players_best_first.sql | player search ranks by similarity | yes (2026-09-20) |
| 126_college_live_matches.sql | live period/clock, schedule view with kickoff + conferences, worker lanes | yes (2026-09-20) |
| 127_college_console_live.sql | `live_stats_at` (provisional live box scores), quality snapshots, API keys + usage, per-host fetch stats | yes (2026-09-21) |
| 128_college_weather.sql | `weather` / `weather_at` on games (NWS forecast at kickoff), schedule view carries them | yes (2026-09-24) |
| 129_college_seo_slugs.sql | `college_players.slug` / `noindex`, `college_games.slug` (backfilled, kept by triggers), `college_slug_redirects` for renamed slugs | yes (2026-09-27) |
| 130_college_search_aliases.sql | team search: filler words stripped, school name/long name/aliases (initials, St./State), exact first, indexed player match | yes (2026-10-05) |
| 131_college_twins_and_final_timing.sql | `college_games.final_at` / `ncaa_box_first_at` (set once by trigger, final_at backfilled), `college_merge_program()` to fold synthetic x- twins into the real program (job merge-twins) | yes (2026-10-05) |
| 132_college_schedule_names.sql | schedule view falls back to the schedule line's opponent name when no program matched (no nameless sides) | yes (2026-10-05) |
| 133_college_aggregates_queue.sql | season-total refreshes take a per-season advisory lock and their own 240 s lock_timeout, so they queue instead of being cancelled at PostgREST's 8 s (nightly failed at its last step 09-30 to 10-04) | yes (2026-10-05) |
| 134_pro_soccer.sql | Plaibook Stats Pro: `pro_*` tables keyed by API-Football ids (leagues, seasons, teams, players, fixtures, events, lineups, player lines, team stats, standings, season totals, college links, slug redirects), slug triggers, `pro_refresh_season_aggregates()`, `pro_search()` | **no** (local only; needs Evan's OK) |

After a change: `npm test`, then from the Plaibook repo `node scripts/qa/college-contract.mjs` (read-only, live).
