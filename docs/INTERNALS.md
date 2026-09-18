# Internals

How the data is actually collected. Read `../README.md` first for what the service is, and `API.md` for the
public interface.

## Where the data comes from

1. **Each program's own athletics site** (Sidearm Sports ≈ 85 % of programs, PrestoSports ≈ 10 %, WMT Digital
   for about 20 schools): rosters with bios and headshots, coaches, schedules with attendance and venue,
   cumulative season stats (including per-player minutes), and full per-game box scores with play-by-play.
2. **NCAA.com** JSON/GraphQL (the same feeds the open-source `henrygd/ncaa-api` proxies): every game in every
   division with box scores and play-by-play, plus stat leaderboards, standings and the United Soccer Coaches
   poll. Used as the complete-coverage cross-check and as the fallback when a school's site cannot be parsed.

Both box scores are stored per game; `college_games.source_of_truth` (`site` | `ncaa`) selects which one the
aggregates read. `stats.ncaa.org` is never crawled (robots.txt disallows all crawlers and it sits behind Akamai).

Conference standings come from each conference's own website (`data/conference-sites.json`), and the United
Soccer Coaches polls from unitedsoccercoaches.org.

## Source layout

```
src/config.ts            env (zod) + crawler User-Agent
src/model.ts             canonical types every adapter maps into
src/http/                polite HTTP client (1 req/s per host, ETag cache, retries, robots.txt)
src/sources/ncaa/        NCAA.com scoreboard, GraphQL game docs, schools index, leaderboards, polls
src/sources/sites/       athletics-site adapters: sidearm/, presto/, detect.ts
src/normalize/           names, class years, positions, heights, hometowns, clocks, team identity
src/identity/            player identity resolution, transfers, game matching
src/db/                  supabase client, repos (upserts), fetch cache
src/jobs/                durable jobs (runner + each crawl step), schedules
src/server.ts            Render web service: /health, /jobs/enqueue, /jobs/runs, worker loop
src/cli.ts               same jobs from the command line + `smoke`
fixtures/                recorded real payloads used by the tests
scripts/sanity.sql       post-crawl data checks
src/api/                 public read API (/v1): routes, auth + rate limits, OpenAPI document
src/ui/                  the site's own JSON API (/api) and the shared query layer both APIs call
ui/                      Vite + React + Tailwind front end, built into ui/dist
```

## Source notes

- NCAA.com's `data.ncaa.com` scoreboard feed for the 2025 D1 men's season stopped carrying games after
  early November (conference and NCAA tournament dates return 404). School sites cover those games, which
  is why the site box score is the truth source whenever it validates; NCAA.com fills in games the site
  cannot parse. Tournament brackets via the NCAA GraphQL bracket endpoint are a Phase 2 item.
- NCAA.com "shots" differ systematically from the school stat crew's shot totals (NCAA counts fewer);
  goals, cards and saves agree. Disagreement counters therefore ignore shots.
- Sidearm box scores embed the whole game in `__NUXT_DATA__` (devalue format); PrestoSports box scores
  need `?view=plays` and sometimes answer HTTP 202 with an empty body on first request (the HTTP client retries).
- PrestoSports hosts return 403 to any User-Agent containing "bot". The crawler therefore sends a browser-compatible
  UA with a `PlaibookCollege/1.0 (+https://plaibook.soccer)` suffix and the contact email in a `From:` header on every request.
- PrestoSports box scores publish minutes only for goalkeepers and do not mark starters; the aggregate RPC
  borrows minutes / starter flags per player from the NCAA.com line for the same game when the truth source
  lacks them. NCAA.com prints full legal names in capitals ("JARAN LILLEHOLT KLEVBERG"), so player matching
  also accepts same jersey + same first name, and `mergeBoxscoreOnly` folds placeholder identities into the
  roster identity after every roster sync.
- About half of D1 Sidearm tenants still run the older Sidearm template: box scores are captioned HTML tables
  (`boxScoreHtml.ts`) and the roster JSON API returns 404/204 while the page embeds the roster object in its
  script (`rosterEmbedded.ts`); both are automatic fallbacks in the Sidearm adapter.
- Some Presto rosters print the class as a bare digit (1-5); `parseClassYear` maps those.
- Team-name matching keeps "College" and "State" significant (Boston College vs Boston U., NC State vs
  North Carolina, San Diego State vs San Diego); ambiguous aliases resolve to nothing rather than to a guess.
  Curated spellings live in `data/team-aliases.json`; initialisms (UNCG, HCU, CCSU) and NCAA six-letter codes
  are weak keys that only win when nothing else matches (`src/normalize/aliasIndex.ts`).
- **Home/away orientation**: school schedules are the weakest signal (older Sidearm tenants mark away games with a
  separate `<span class="sidearm-schedule-game-away">at</span>`). NCAA.com's scoreboard is authoritative when a
  contest exists (`sweep-scoreboard` flips reversed fixtures and takes NCAA's final score); otherwise the box score's
  own home/visitor names decide (`sync-site`). A flipped game loses all stored lines and is refetched from both
  sources (`reorientGame`), because lines written under the wrong orientation belong to the other program.
- **Conference games** are derived, not scraped: both programs in the same conference for the season and not a
  postseason/tournament game (`reconcile-games`). Site "conference" markers were wrong often enough to break standings.
- **Membership** (`verify-membership`): NCAA.com's "Won-Lost-Tied Percentage" team leaderboard lists every
  member of a division with its official overall record (D1 men = 210 teams in 2026). Programs that appear on
  scoreboards without a conference and are absent from the leaderboard (NAIA, Canadian, club sides) are kept
  as opponents but flagged `ncaa_member = false` and hidden from team lists, leaders and standings. The
  official record is stored on `college_program_seasons.official_w/l/t` and compared with our computed record.
- **Standings** (`compute-standings`): NCAA.com's standings page is empty for soccer in 2026, so the official
  source is each conference's own website. Sidearm conference sites serve `standings.aspx?path=msoc|wsoc` as a
  server-rendered `sidearm-standings-table` (rank order, conference W-L-T, points, pct, overall, GF-GA, home/away,
  streak; pods such as "East Division" are kept). The registry `data/conference-sites.json` (verified with
  `scripts/find-conference-sites.mjs`) covers ~75% of conferences; the rest (Big Ten, Big 12, SEC, SoCon,
  PrestoSports conference sites…) fall back to standings computed from our stored results (3-1-0 points).
  Every official row is compared with our computed conference and overall records
  (`college_standings_checks`); an empty check table means the stored games are complete.
- **Rankings** (`refresh-rankings`): unitedsoccercoaches.org publishes every poll of the season on one page
  per list (D1/D2/D3 × men/women) — pre-season and weekly polls with previous rank, first-place votes, points,
  record and "also receiving votes" — all of which are stored per `week_of`. The D1 lists are cross-checked
  rank-by-rank against ncaa.com's copy. NCAA.com stat-category leaderboards (team and individual, ids differ
  per gender and are discovered from the landing page) provide national ranks per stat, linked to
  `player_season_id` where the name matches the roster.
- **Richer aggregates** (migration 122): per-player splits (home/away/neutral, conference/non-conference,
  vs USC-ranked opponents), goals by half, minutes and shots per goal, PK %, individual clean sheets, division
  ranks and percentiles (players with ≥30% of team minutes; keepers with ≥180 minutes); per-team home/away and
  first/second-half goals, shots per goal, points per game with division/conference ranks, record vs ranked
  teams, last-5 goals.

## Jobs and scheduling

Jobs are durable rows in `college_crawl_runs`; a restart resumes from the queue and every fetch is cached in
`college_source_fetches`. With `SCHEDULER_ENABLED=1` the process enqueues its own work (`src/jobs/scheduler.ts`):
the hourly job every 30 minutes from August to December, nightly at 08:15 UTC, weekly on Tuesdays at 15:00 UTC.
There are no Render cron services.

The hourly job is deliberately narrow — sweep recent scoreboards, fetch NCAA box scores, pull school box scores
only for programs whose new finals lack one, reconcile, recompute aggregates. Re-fetching schedules and
conference standings pages for ~1,300 programs turned it into a multi-hour crawl, so those run nightly.

For a new season, run `discover-teams` and `detect-sites` once (Jobs page or CLI), then sync teams on demand.
Seasons from 2025 use the NCAA GraphQL scoreboard; the old casablanca JSON feed ended with 2024 data.

## Database

The schema lives in the Plaibook repo: `plaibook/supabase/migrations/120_college_soccer.sql` plus 122 (richer
aggregates, standings v2), 123 (WMT) — apply with `npm run db:push` there. Writes to a non-local Supabase are
refused unless `COLLEGE_ALLOW_PROD=1` (`assertWritable` in `src/config.ts`).

`scripts/sanity.sql` holds post-crawl data checks; the admin console's Quality page runs the same checks live.
