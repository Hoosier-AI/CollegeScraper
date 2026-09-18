# Plaibook Stats API (v1)

Read-only HTTP API over the NCAA soccer catalog this service maintains: every D1, D2 and D3 program (men and
women), rosters, players, games with box scores, season stats, official conference standings and the United
Soccer Coaches polls. It is the surface Plaibook (or any other consumer) integrates against; nothing needs
direct database access.

Base URL (hosted): `https://plaibook-college-scraper.onrender.com`  
Browsable docs: `/docs` on the same host. Machine description: `GET /v1/openapi.json`.  
Season = fall calendar year (`2026`). Gender = `m` | `w`. Division = `d1` | `d2` | `d3`.

## Authentication — none needed

Every route answers anonymous requests:

```bash
curl "https://plaibook-college-scraper.onrender.com/v1/search?q=duke&gender=m"
```

Anonymous callers get `API_ANON_RATE_LIMIT_PER_MIN` requests a minute (default 60), counted per client IP,
and keyless responses may be read from any origin — browser code can call them directly.

A **named key** raises the limit to `API_RATE_LIMIT_PER_MIN` (default 600) and is accepted only from the
origins in `CORS_ORIGINS`. Send it either way:

```
Authorization: Bearer <key>
X-Api-Key: <key>
```

Keys are configured on the service as `COLLEGE_API_KEYS="plaibook:<key>,other:<key>"`; ask for one at the
address in `GET /v1/meta`. The admin trigger secret also authenticates, but it is meant for the admin
console and the job routes. A key that is *wrong* is rejected with `401` — send no key at all to fall back
to the free tier.

Every response carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`; over the limit you get `429` with
`Retry-After`. Errors are JSON:
`{ "error": "unauthorized" | "bad_request" | "rate_limited" | "not_found", "message": "…" }`.
Successful keyless reads carry `Cache-Control: public, max-age=60` (keyed reads: `private`); the data changes
at most every 30 minutes in season (hourly job) and nightly.

## Endpoints

| Route | What it returns |
|---|---|
| `GET /v1/meta` | `seasons[]`, `currentSeason`, `genders`, `divisions`, `conferences[]` (id, ncaa_seo, name, division), `last_completed_runs` (job → finished_at), `player_stats[]` / `team_stats[]` (the stat dictionary below), `limits` (requests per minute, anonymous and keyed), `contact` |
| `GET /v1/status?season=` | Recent crawl runs with counters and errors, `record_checks` (counts per verification field), member programs, games and finals stored |
| `GET /v1/search?q=&gender=&limit=` | `programs[]` and `players[]` matching a name (trigram similarity), best first |
| `GET /v1/programs?season=&gender=&division=&conference=&q=&members=all` | One row per program: school (logo, host, platform), conference, `member` (NCAA membership), `record` (computed W-L-T, GF, GA), `official` (NCAA.com W-L-T), sync timestamps, game/box-score counts. NCAA members only unless `members=all` |
| `GET /v1/programs/{id}?season=&include=roster,games` | The team page in one call: `program`, `season` row (division, conference, `ncaa_member`, `official_w/l/t`), `coaches`, `teamStats`, `standing`, `standingsChecks`, `conferenceTable`, `usc` (latest poll entry) + `uscHistory`, `categories` (NCAA.com national ranks), `roster[]`, `games[]` |
| `GET /v1/programs/{id}/roster?season=` | Players with `stats` (computed season stats), `site` (the school's own cumulative table), `splits` (home/away/neutral/conf/nonconf/vs_ranked), `honors[]` |
| `GET /v1/programs/{id}/games?season=` | Games in date order with both sides' team-stat rows and `source_of_truth` |
| `GET /v1/players/{id}` | `player`, `seasons[]` (each with `stats`, `site`, `splits[]`, `ranks[]`), `career`, `honors[]`, `transfers[]`, `gameLog[]`. Suppressed players return 404 |
| `GET /v1/games/{id}?include=raw` | `game` header, `team[]` (both sources), `players[]`, `events[]`; `raw` adds the source payloads |
| `GET /v1/leaders?season=&gender=&division=&conference=&kind=player|team&stat=&min_minutes=&q=&limit=&offset=` | One page: `stats` (allowed names), `stat`, `rows[]` sorted by the stat, `total`, `limit` (≤ 500, default 100), `offset`. Every player/team with a value for the stat is reachable by paging `offset` until `offset + rows.length >= total`; `q` filters by player or program name. Player rows carry program, position, class and every season stat; team rows carry the team season stats |
| `GET /v1/standings?season=&gender=&division=&conference=` | `conferences[]`, each `{ conference, source: 'conference'|'computed', source_url, rows[] }`. Rows: rank, pod, conf W-L-T and points, overall W-L-T, GF-GA, streak, home/away records, `checks[]` |
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

## Plaibook integration

Plaibook already has an op-style college service (`api/_lib/college.mjs`, ops `college_search`, `college_team`,
`college_player`, `college_leaders`, `college_standings`, `college_rankings`, `college_game`). The routes above
map onto those ops one to one, with the same argument names. `docs/plaibook-client.mjs` is a drop-in fetch
wrapper that keeps Plaibook's `{ unavailable: true, note }` contract:

```js
import { createCollegeApi } from './plaibook-client.mjs';
const college = createCollegeApi({ baseUrl: process.env.COLLEGE_API_URL, apiKey: process.env.COLLEGE_API_KEY });
const team = await college.run('college_team', { program_id, season: 2026 });
```

Plaibook needs two environment variables: `COLLEGE_API_URL` (the base URL) and `COLLEGE_API_KEY` (the key named
`plaibook`). Calls are server-side (a Vercel function), so no browser origin is involved; add
`https://www.plaibook.soccer` to `CORS_ORIGINS` only if a page ever calls the API directly.

## Examples

```bash
H=https://plaibook-college-scraper.onrender.com
curl "$H/v1/search?q=duke&gender=m"
curl "$H/v1/standings?season=2026&gender=m&division=d1"
curl "$H/v1/leaders?season=2026&gender=w&division=d1&stat=goals&limit=10"
curl "$H/v1/rankings?season=2026&gender=m&division=d1"

# With a key, for a higher limit:
curl -H "X-Api-Key: $K" "$H/v1/programs?season=2026&gender=m&division=d1"
```

## Versioning

`/v1` is stable: fields are added, never renamed or removed. Breaking changes would ship as `/v2`.
