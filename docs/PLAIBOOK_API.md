# Plaibook Stats API: Plaibook's private contract

Read-only HTTP API over everything this service holds, for **Plaibook only** (the app, plus the hub's status read).
It has not been public since 2026-10-16: there is no keyless tier, no browser access and no keys for anyone else.

- `/v1/...` (17 routes below): the NCAA college catalog the app's sync, opponent briefs and Tekki tools read.
- `/v1/site/<path>`: any read the Plaibook Stats site itself makes (college, pro, international, news). See
  "Everything the site shows" below.

Base URL: `https://www.plaibook.live` (also `https://plaibook-college-scraper.onrender.com`).
Machine description: `GET /v1/openapi.json` (needs a key).
Season = fall calendar year (`2026`). Gender = `m` | `w`. Division = `d1` | `d2` | `d3`.

## Authentication

Every request needs a named key from `COLLEGE_API_KEYS="plaibook:<key>,hub:<key>"` on the service (the admin trigger
secret also works, for the console and scripts). Send it either way:

```
X-Api-Key: <key>
Authorization: Bearer <key>
```

No key or a wrong key is `401`. A browser preflight is `405` and no CORS headers are sent: call from a server.
The limit is `API_RATE_LIMIT_PER_MIN` per key (2400; the app's syncs, Tekki and every coach's page reads share the
`plaibook` key). Responses carry `X-RateLimit-Limit` / `X-RateLimit-Remaining`; over the limit you get `429` with
`Retry-After`. Errors are JSON: `{ "error": "unauthorized" | "bad_request" | "rate_limited" | "not_found", "message"? }`;
an unexpected failure is `{ "error": "Something went wrong on our side. Please try again." }` with status 500.
Successful reads carry `Cache-Control: private, max-age=60` (15 s for a live game or day); the data changes at most
every few minutes in season.

Players under a takedown request (`college_players.suppress`) are withheld everywhere: 404 on their profile, absent
from rosters, rankings, leaders, records and team of the week, and nameless (numbers kept) in box scores, play-by-play
and previews. Source payloads (`raw`) are never served.

## Endpoints

| Route | What it returns |
|---|---|
| `GET /v1/meta` | `seasons[]`, `currentSeason`, `genders`, `divisions`, `conferences[]` (id, ncaa_seo, name, division), `last_completed_runs` (each job → its last finished_at), `player_stats[]` / `team_stats[]` (the stat dictionary below), `limits` (`key_per_min`) |
| `GET /v1/status?season=` | Recent crawl runs (minute-ly live jobs left out) with counters and errors, `last_completed_runs`, `record_checks` (counts per verification field), member programs, games and finals stored |
| `GET /v1/search?q=&gender=&limit=` | `programs[]` and `players[]` matching a name (trigram similarity), best first. Program rows carry `school_name` ("Duke"), `school_long_name` ("Duke University"), `division` and `conference { id, name }` (latest season) |
| `GET /v1/programs?season=&gender=&division=&conference=&q=&members=all` | One row per program: school (logo, host, platform), conference, `member` (NCAA membership), `record` (computed W-L-T, GF, GA), `official` (NCAA.com W-L-T), sync timestamps, game/box-score counts. NCAA members only unless `members=all` |
| `GET /v1/programs/{id}?season=&include=roster,games` | The team page in one call: `program`, `season` row (division, conference, `ncaa_member`, `official_w/l/t`), `coaches`, `teamStats`, `standing`, `standingsChecks`, `conferenceTable`, `usc` (latest poll entry) + `uscHistory`, `categories` (NCAA.com national ranks), `roster[]`, `games[]` |
| `GET /v1/programs/{id}/roster?season=` | Players with `stats` (computed season stats), `site` (the school's own cumulative table), `splits` (home/away/neutral/conf/nonconf/vs_ranked), `honors[]` |
| `GET /v1/programs/{id}/games?season=` | Games in date order with both sides' team-stat rows and `source_of_truth` |
| `GET /v1/players/{id}` | `player`, `seasons[]` (each with `stats`, `site`, `splits[]`, `ranks[]`), `career`, `honors[]`, `transfers[]`, `gameLog[]`. Suppressed players return 404 |
| `GET /v1/games/{id}` | `game` header, `team[]` (both sources), `players[]` (with `rating`), `events[]`, `stats { provisional, live_stats_at }`. **Live matches:** while `game.status` is `live`, the `ncaa` rows are a snapshot of NCAA.com's in-game feed (`stats.provisional: true`, refreshed about every two minutes, `Cache-Control: max-age=15`); the final box score replaces them minutes after full time. Season totals never include provisional rows |
| `GET /v1/leaders?season=&gender=&division=&conference=&kind=player|team&stat=&min_minutes=&q=&limit=&offset=` | One page: `stats` (allowed names), `stat`, `rows[]` sorted by the stat, `total`, `limit` (≤ 500, default 100), `offset`. Every player/team with a value for the stat is reachable by paging `offset` until `offset + rows.length >= total`; `q` filters by player or program name. Player rows carry program, position, class and every season stat; team rows carry the team season stats |
| `GET /v1/standings?season=&gender=&division=&conference=` | `conferences[]`, each `{ conference, source: 'conference'|'computed', source_url, rows[] }`. Rows: rank, pod, conf W-L-T and points, overall W-L-T, GF-GA, streak, home/away records, `checks[]` |
| `GET /v1/matches?date=&days=&gender=&division=&conference=&status=&only=` | Matches for a day (or up to 7 days from `date`, Eastern): `{ from, to, season, live, games[] }` ordered live first, then by kickoff. Each game carries both sides with logo, conference, latest poll rank and score, `live { period, clock, updated_at }` while in play, and `start_epoch` (unix seconds). Scores refresh every minute during games. Also per game: `broadcast { network, url }`, `venue { name, city }` (ground and "City, ST" from the schools' schedules or the box score; the home side is `home`, `neutral_site` marks a neutral ground), `weather` (National Weather Service hourly forecast for the ground at kickoff — `temp_f`, `wind_mph`, `wind_gust_mph`, `wind_dir`, `precip_pct`, `humidity`, `short`, `place`, `read_at`, `time_assumed` when no kickoff time is published — refreshed every 3 hours and hourly in the last 6, kept after kickoff; null beyond the ~6-day forecast or when the ground is unknown), `result_pending` and `kickoff_tbd` |
| `GET /v1/matches/{id}/preview` | Everything around one match: head-to-head record and every previous meeting (date, score, W/L/T for the current home team, scorers with minutes), plus clean sheets, goals per game, home/away record, biggest wins and the current run, each side's season stats and form, standing (`rank` of `of`), poll rank, key players (scorers, assists, keeper) and the lineup (starters, subs, did-not-play, each with `headshot_url` when the school publishes a hotlinkable photo). `lineup` is only ever this match's own box score; `lineup_status` says what you got: `match` (starters named), `no_starters` (the box score only lists who played), `past` (no box score yet — `last_lineup` holds the side's latest lineup with starters, with `game_date` and `opponent`) or `none`. Also `elo` (pre-match chances, scheduled games) and `rpi { home, away }` (live RPI rank). Never queues work |
| `GET /v1/conferences?season=&gender=&division=` | Conferences with member counts and the top five of each table |
| `GET /v1/conferences/{id}?season=&gender=` | One conference: standings, members with form and poll rank, this week's matches, leaders (points, goals, assists, save %), ranked members |
| `GET /v1/rankings?season=&gender=&division=&poll=&week_of=` | `polls[]` (`usc` plus `ncaa:<categoryId>` with labels), `weeks[]` for the chosen poll, `rows[]` with `rank`, `previous_rank`, `first_place_votes`, `value` (points), `record`, `label` (`Poll 3`, `Pre-season Poll`, `… (RV)` = also receiving votes) |

### Stat names

Players: `goals assists points shots sog minutes gp gs gwg hat_tricks goals_p90 assists_p90 points_p90 shots_p90
sog_p90 shot_accuracy conversion_pct saves save_pct gaa shutouts clean_sheets saves_p90 ga gk_minutes yc rc fouls
corners offsides pk_goals pk_att pk_pct minutes_share goals_1h goals_2h goals_ot minutes_per_goal shots_per_goal
pct_points_p90 pct_goals_p90 pct_assists_p90 pct_shots_p90 pct_save_pct pct_gaa div_rank_points div_rank_goals
div_rank_assists conf_rank_points conf_rank_goals`.

Teams: `w l t gp ppg gf ga gd gf_pg ga_pg gf_home gf_away ga_home ga_away gf_1h gf_2h ga_1h ga_2h shots sog shots_pg
sog_pg sog_pct shots_per_goal corners corners_pg fouls offsides saves yc rc pk_goals pk_att clean_sheets
avg_attendance conf_w conf_l conf_t vs_ranked_w vs_ranked_l vs_ranked_t last5_gf last5_ga div_rank_ppg conf_rank_ppg
conf_rank_gf_pg conf_rank_ga_pg div_pct_gf_pg div_pct_ga_pg div_pct_shots_pg`.

`pct_*` and `div_pct_*` are percentiles (0–1) within the division; `div_rank_*` / `conf_rank_*` are 1 = best.
Player percentiles need ≥ 30 % of team minutes (keepers ≥ 180 minutes).

## How records are verified

Each standings row carries `checks[]`: rows are compared with the conference's official table and with NCAA.com's
own record. `field` is one of `conf_record`, `overall_record`, `ncaa_record` (a real difference, ours vs
theirs), `*_lag` (the source lists fewer games than we hold and every result it lists is in our record: it
simply has not posted the latest games), `ncaa_record_ncaa_duplicate` (NCAA.com lists the same game twice).
Records come from every final game with both programs and a score; games against non-NCAA opponents count,
preseason exhibitions do not.

## Everything the site shows: `/v1/site/<path>`

`GET /v1/site/<path>?<query>` runs the site's own `GET /api/<path>?<query>` in the same process (src/api/siteMirror.ts)
and returns its status, content type and body unchanged, so the answer is exactly what the page renders from: same
validation, caching, takedown redaction and under-18 rule (a minor's pro page is `{ minor: true }`). Admin routes
(`/api/console`, `/api/runs`, `/api/quality`, `/api/jobs`) and the legal text answer 404.

- `x-plaibook-view: 1` marks a coach opening a page: pro pages may then fetch fresh detail from the provider, as they
  do for a site visitor. Without it (Tekki, syncs) the read counts as a bot and never spends that budget or queues work.
- The routes Plaibook may call are `SITE_ROUTES` in `docs/plaibook-client.mjs`, each with its `area`
  (college, pro, intl, news) and gender rule. `tests/api/site-parity.test.ts` fails when the site gains a GET /api
  route that is in neither `SITE_ROUTES` nor `SITE_EXCLUDED`, so nothing the site shows is ever missing for Plaibook.
- A renamed pro or international slug answers 404 with `{ moved: <new slug> }`.
- Pro and international data comes partly from API-Football under Plaibook's own plan: shown on Plaibook's and this
  site's pages only, never passed on. Advanced pro stats (xG, xA, g+, shots) are American Soccer Analysis's and are
  credited where shown.

## Plaibook integration

`docs/plaibook-client.mjs` is copied byte for byte (below two header lines) to Plaibook's `api/_lib/collegeApi.mjs`
(Plaibook's `tests/college-client-sync.test.mjs` enforces it). It keeps Plaibook's `{ unavailable: true, note }`
contract:

```js
import { createCollegeApi } from './collegeApi.mjs';
const api = createCollegeApi({ baseUrl: process.env.COLLEGE_API_URL, apiKey: process.env.COLLEGE_API_KEY });
const team = await api.run('college_team', { program_id, season: 2026 });        // a /v1 college route
const elo = await api.site('/api/programs/<id>/elo', {}, { view: true });          // any site read
```

Plaibook needs `COLLEGE_API_URL` and `COLLEGE_API_KEY` (the key named `plaibook`). Its `api/_lib/stats.mjs` adds the
club's side (college hard-locked), a per-instance cache and the `stats_get` / `stats_batch` ops on `/api/league`.

Post-game: the `final-detail` job POSTs `{ games: [{ game_id, home_program_id, away_program_id, final_at }] }` to
`PLAIBOOK_FINAL_WEBHOOK_URL` with `x-college-signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">` (and the static
`x-college-secret` for now), retried three times; what does not go through waits in `college_kv`
`plaibook:final_outbox` and is sent with the next run.

## Examples

```bash
H=https://www.plaibook.live
curl -H "X-Api-Key: $K" "$H/v1/search?q=duke&gender=m"
curl -H "X-Api-Key: $K" "$H/v1/standings?season=2026&gender=m&division=d1"
curl -H "X-Api-Key: $K" "$H/v1/site/pro/rankings"
curl -H "X-Api-Key: $K" "$H/v1/site/intl/teams/usa/elo"

# Every SITE_ROUTES read against a running service:
STATS_URL=$H STATS_KEY=$K node scripts/site-contract.mjs
```

## Versioning

`/v1` is stable for Plaibook: fields are added, never renamed or removed. `/v1/site` follows the site's own routes.
