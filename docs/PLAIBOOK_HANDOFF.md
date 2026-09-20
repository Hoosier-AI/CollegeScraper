# Connecting Plaibook to the College Soccer API

Everything Plaibook needs is served by this service; Plaibook never touches the college database. Work on the
Plaibook side is a small, mechanical swap because its college data layer already exists as op-style calls.

## 1. Credentials

| Plaibook env var (Vercel, Production + Preview) | Value |
|---|---|
| `COLLEGE_API_URL` | `https://plaibook-college-scraper.onrender.com` |
| `COLLEGE_API_KEY` | the key named `plaibook`, stored here in `CollegeScraper/.env` as `PLAIBOOK_API_KEY` |

To rotate: change `COLLEGE_API_KEYS` on the Render service (`plaibook:<new key>`), redeploy, then update Vercel.

## 2. Swap the data layer (Plaibook repo)

1. Copy `docs/plaibook-client.mjs` from this repo to `plaibook/api/_lib/collegeApi.mjs`.
2. In `plaibook/api/_lib/college.mjs`, replace the PostgREST-backed service with the client:
   ```js
   import { createCollegeApi } from './collegeApi.mjs';
   export const college = createCollegeApi({ baseUrl: process.env.COLLEGE_API_URL, apiKey: process.env.COLLEGE_API_KEY });
   ```
   Op names, argument names and the `{ unavailable, note }` / `{ source: 'college', fetchedAt, ...data }` contract
   are unchanged, so `api/league.js` (the `college_` prefix dispatch), `src/lib/collegeClient.js`,
   `src/hooks/useCollege.js`, `opponent_brief` / `collegeFacts` and the gameday opponent picker keep working.
   The `ctx` argument (caller JWT) is accepted and ignored: the API key authenticates the server-to-server call.
3. `tests/college.test.mjs`: point the fake fetcher at `${COLLEGE_API_URL}/v1/...` paths instead of `/rest/v1/`
   tables, and keep the "no service key ever leaves the process" assertion (the API key goes in `X-Api-Key`).
4. Migrations 122 and 123 in `plaibook/supabase/migrations` are no longer needed for the read path. Leave them
   unapplied or delete them; the `college_*` tables that migration 120 created in Plaibook's project stay empty.
   (`owner_operations_snapshot` from migration 124 reads `college_crawl_runs` in Plaibook's own project, which is
   empty; point that tile at `GET /v1/status` when the owner console is next touched.)

## 3. New surfaces (when ready)

- Tekki tools: `find_college_team` → `college_search`, `get_college_team_stats` → `college_team`,
  `get_college_player` → `college_player` (pattern: `api/_lib/agentTools.mjs`, the `get_pro_*` tools that delegate
  to `football.run`). The catalog is public, so they can join `GUEST_TOOLS`.
- Pages under Coaching Tools: team (`college_team`), player (`college_player`), standings, rankings, leaders.
- The `preloaded_clubs` bridge: `college_programs.preloaded_club_id` exists; `college_search` returns
  `program_id`, name and logo for a picker.

## 4. Verify

```bash
curl -H "X-Api-Key: $COLLEGE_API_KEY" "$COLLEGE_API_URL/v1/search?q=duke&gender=m"
curl -H "X-Api-Key: $COLLEGE_API_KEY" "$COLLEGE_API_URL/v1/standings?season=2026&gender=m&division=d1"
```
Then, in Plaibook, open a gameday plan → Opponent insights → search a college program: the picker is the
existing live consumer and exercises `college_search` and `college_team` end to end.

## Data guarantees

- Every NCAA member program in D1/D2/D3, men and women, verified against NCAA.com's leaderboards.
- Records come from final scores; standings rows carry `checks[]` against the conference's official table and
  NCAA.com; `*_lag` means the source has not posted a game yet, not an error.
- Refresh: every 30 minutes in season (new results + box scores), nightly (rosters, schedules, standings pages,
  polls), weekly (membership, site detection).
- Player profiles can be suppressed on request (`college_players.suppress`); suppressed players 404 on `/v1/players/:id`, are absent from search, and are left out of the roster routes (`/v1/programs/:id`, `/v1/programs/:id/roster`). Their box-score lines inside `/v1/games/:id` still carry a name: not redacted yet.
- Logos and headshots are hot-linked URLs, never stored.
