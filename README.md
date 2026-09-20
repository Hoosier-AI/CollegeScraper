# Plaibook Stats

Every NCAA soccer program — Division I, II and III, men's and women's — with rosters, box scores, season
stats, official conference standings and the United Soccer Coaches polls. It is a public website and a
read API over the same data.

**Site:** https://plaibook-college-scraper.onrender.com  ·  **API docs:** `/docs`  ·  **Spec:** `/v1/openapi.json`

## Use the API

No key, no signup:

```bash
curl "https://plaibook-college-scraper.onrender.com/v1/search?q=duke&gender=m"
curl "https://plaibook-college-scraper.onrender.com/v1/standings?season=2026&gender=m&division=d1"
curl "https://plaibook-college-scraper.onrender.com/v1/leaders?season=2026&gender=w&stat=goals&limit=10"
```

Anonymous callers get 60 requests a minute per IP and may call from any origin. A named key raises that to
600 — ask for one at the address in `GET /v1/meta`. Full reference: [docs/API.md](docs/API.md), or `/docs`
in the browser, which renders the routes from the live spec and lets you run them.

| Route | What it returns |
|---|---|
| `/v1/search` | Programs and players by name |
| `/v1/programs`, `/v1/programs/{id}` | The team list, and one team with roster, games, standing and rankings |
| `/v1/players/{id}` | Career, per-season stats, splits, ranks, honors, game log |
| `/v1/games/{id}` | Box score from both sources, player lines, events |
| `/v1/leaders` | Player or team leaderboards over ~50 stats |
| `/v1/standings`, `/v1/rankings` | Official conference tables with verification, and every poll of the season |
| `/v1/meta`, `/v1/status` | Seasons, conferences, the stat dictionary, limits; crawl health and counts |

`/v1` is stable: fields get added, never renamed or removed.

## Where the data comes from

Each program's own athletics site is the primary source — rosters with bios, schedules, cumulative season
stats and full box scores. NCAA.com is stored alongside it as the complete-coverage cross-check, so every
game has a second opinion, and `source_of_truth` says which one the aggregates were built from. Conference
standings come from each conference's official table and are compared row by row with the record computed
from our stored results; where they disagree, `checks[]` says so. `stats.ncaa.org` is never crawled.

Details, and every source quirk worth knowing: [docs/INTERNALS.md](docs/INTERNALS.md).

## Run it yourself

```bash
cp .env.example .env            # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm test                        # offline, fixture-based
npm run build                   # server + site
npm run dev                     # server, worker and site on :8080
```

The database schema lives in `supabase/migrations/` (see its README for how it is applied); writes to a non-local Supabase are refused unless `COLLEGE_ALLOW_PROD=1`. To collect data:

```bash
npm run cli -- --help
npm run smoke -- --program duke --gender m --season 2025
npm run cli -- backfill --season 2026
npm run dev:ui                  # vite on :5174 with hot reload, proxying /api to :8080
```

## The site

A Vite + React + Tailwind app (`ui/`) served by the same Fastify process. Public pages: **Teams** (click a
program for its roster, results and season stats), **Team**, **Game** (school box score against NCAA.com side
by side, plus events), **Player**, **Leaders**, **Standings** (official conference tables with a ✓ when they
equal our computed records), **Rankings** (every USC poll of the season with movement, plus NCAA.com category
ranks), and **API** (the docs).

`/admin` takes `COLLEGE_TRIGGER_SECRET` and adds the operator surfaces: **Jobs** (enqueue and watch crawl
runs), **Quality** (sanity checks), per-team **Sync**, and the crawl columns — which site platform a school
runs, box-score counts, last-synced times, raw source payloads. Nothing on the public pages depends on it.

## Deployment

`render.yaml` defines one always-on Docker web service that serves the site and the API and runs the crawl
worker; with `SCHEDULER_ENABLED=1` it enqueues its own hourly, nightly and weekly jobs. Environment variables
are listed in [.env.example](.env.example); `scripts/render-deploy.mjs` creates or updates the service through
the Render API.

## Integrating from Plaibook

Plaibook calls this service over HTTP rather than reading the database.
[docs/plaibook-client.mjs](docs/plaibook-client.mjs) is a drop-in for `api/_lib/college.mjs` with the same op
names, and [docs/PLAIBOOK_HANDOFF.md](docs/PLAIBOOK_HANDOFF.md) has the wiring steps.
