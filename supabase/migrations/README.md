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
| 134_pro_soccer.sql | Plaibook Stats Pro: `pro_*` tables keyed by API-Football ids (leagues, seasons, teams, players, fixtures, events, lineups, player lines, team stats, standings, season totals, college links, slug redirects), slug triggers, `pro_refresh_season_aggregates()`, `pro_search()` | yes (2026-10-09) |
| 135_pro_crawl_and_people.sql | Pro v2: `pro_crawl_tasks` (the crawl queue), countries, league membership, squads, transfers, coaches and careers, trophies, injuries; provider season totals in `pro_player_season_stats` (`source`), current club / number / `indexable` on players; `pro_leaders`, `pro_player_percentiles`, `pro_refresh_player_rank`; id-0 clean-up | yes (2026-10-09) |
| 136_console_progress.sql | `pro_crawl_tasks.tier` (backfilled), `pro_crawl_progress()` and `college_sync_progress(season)` for the console and the hub's Stats progress views | yes (2026-10-09) |
| 137_pro_more_stats.sql | Every stat API-Football has: `pro_team_season_detail` (club season stats), `pro_venues` + `pro_teams.venue_id`, `pro_sidelined` (injury history), dribbled past / penalties won and committed on match lines, `pro_fixture_team_stats.extra`; `pro_reschedule_tasks()` for the US-first planner (tiers renumbered: 1 = US scene) | yes (2026-10-09) |
| 138_pro_sources.sql | Other sources mapped onto API-Football and checked against it: `pro_source_seasons`, `pro_src_*` (games, teams, players, venues, officials keyed by the source's ids), `pro_adv_player_seasons` / `pro_adv_team_seasons` / `pro_adv_shots` (xG, xA, passing, goals added, shots), `pro_source_ids`, `pro_source_checks`, `pro_source_agreement()`; index on `pro_players.birth_date` | yes (2026-10-09) |
| 139_pro_history.sql | History from other sources: `pro_src_games` gains round, half-time, extra-time and penalty scores; `pro_fixtures.source` / `pro_teams.source` ('api-football' or the source of a negative-id history row) | yes (2026-10-09) |
| 140_pro_src_standings.sql | `pro_src_standings`: league tables from other sources (Wikipedia), keyed by the source's club names; checked against API-Football's tables and used for seasons it does not have | yes (2026-10-09) |
| 141_pro_standings_source.sql | `pro_standings.source`: 'api-football', 'wikipedia' or 'results' (worked out from results, one table per group of clubs that played each other); league pages credit it | yes (2026-10-09) |
| 142_pro_common_names.sql | `pro_common_name()` ("L. Messi" -> "Lionel Messi"); player slugs no longer change with a name (pages keep their address). Display names rewritten in batches by script (80,756 players, 2026-10-09) | yes (2026-10-09) |
| 143_pro_asa_season_rows.sql | `pro_player_season_stats.source` gains 'asa' (season totals where API-Football has none; starts and cards nullable); `pro_players.source`; `pro_adv_player_seasons.games` | yes (2026-10-09) |
| 144_pro_player_refresh.sql | `pro_player_refresh`: players fetched on demand when someone opens their page (transfers, honours, this and last season in every competition), at most every 14 days | yes (2026-10-09) |
| 145_pro_team_refresh.sql | `pro_team_refresh`: clubs fetched on demand when someone opens their page or a player's (match detail for this season's finals, transfers, squad, coaches, season stats), at most every 14 days | yes (2026-10-09) |
| 146_college_aggregates_fast.sql | `college_refresh_season_aggregates`: the other-source player line through a hash join of the season's lines, a goal-events index, and one program's refresh skips the season-wide ranks (full ~31 s instead of ~53 s, one program ~1 s instead of 7-17 s). Indexes are CONCURRENTLY: apply statement by statement | yes (2026-10-10) |
| 147_pro_crawl_sites.sql | `pro_source_requests` (requests per day, source and host, added every 30 s by `pro_source_requests_add`) and `pro_crawl_matrix()` (per league season: fixtures, tables and player rows by source, detail, club stats, each scraped source's sync) for the hub's Crawling page | yes (2026-10-10) |

After a change: `npm test`, then from the Plaibook repo `node scripts/qa/college-contract.mjs` (read-only, live).
