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

After a change: `npm test`, then from the Plaibook repo `node scripts/qa/college-contract.mjs` (read-only, live).
