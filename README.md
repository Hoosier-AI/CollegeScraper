# Plaibook Stats

Every NCAA soccer program — Division I, II and III, men's and women's — with rosters, box scores, season
stats, official conference standings and the United Soccer Coaches polls, plus professional and international
soccer. It is a public website (https://www.plaibook.live) and Plaibook's private read API over the same data.

## The API is Plaibook's

There is no public API (since 2026-10-16). `/v1` answers named keys from `COLLEGE_API_KEYS` only (`plaibook` for
the app, `hub` for the operator console): the 17 college routes the app's sync and Tekki use, and `/v1/site/<path>`,
which returns any read the site itself makes (college, pro, international, news). Contract, routes and the webhook:
[docs/PLAIBOOK_API.md](docs/PLAIBOOK_API.md). Client: [docs/plaibook-client.mjs](docs/plaibook-client.mjs), copied into
Plaibook as `api/_lib/collegeApi.mjs`.

```bash
curl -H "X-Api-Key: $KEY" "https://www.plaibook.live/v1/search?q=duke&gender=m"
curl -H "X-Api-Key: $KEY" "https://www.plaibook.live/v1/site/pro/rankings"
STATS_URL=https://www.plaibook.live STATS_KEY=$KEY node scripts/site-contract.mjs   # every site read, checked
```

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
