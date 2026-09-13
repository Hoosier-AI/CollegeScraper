# College Stats demo — walkthrough

**URL:** https://plaibook-college-scraper.onrender.com  **Sign-in:** the trigger secret (ask Evan)

What it is: a live database of NCAA college soccer (D1/D2/D3, men's and women's, 2026 season) built by
crawling each program's own athletics site plus NCAA.com, with a viewer to inspect every stat before it goes
into Plaibook.

## Suggested 10-minute tour

1. **Teams** — every program the crawler knows for 2026 with division, conference, site platform, record and
   how much is stored. Search "Duke". Notice the **Sync** button: any team can be pulled on demand in about a minute.
2. **Duke (team page)** — record and splits, goals / shots / corners per game, clean sheets, attendance, form.
   Roster tab: every player with GP, GS, minutes, goals, assists, shots, SOG %, conversion, cards, per-90 toggle,
   goalkeeper GAA / save %. Amber cells would mean our computed number differs from the school's own table; there are none.
3. **A game** (Games tab → Georgetown 3 @ Duke 0) — the school's box score and NCAA.com's side by side,
   with disagreements highlighted; per-player lines from both; the full play-by-play; the raw payloads.
4. **A player** (click Ulfur Bjornsson) — bio, seasons across years (identity carries over 2025 → 2026),
   career totals, honors extracted from the school bio, game log.
5. **Leaders** — pick any stat (goals, assists per 90, save %, corners...) across the division.
6. **Standings / Rankings** — conference records computed from stored games; the United Soccer Coaches poll.
7. **Quality** — the automated checks that keep the data honest (score reconciliation, minutes, source disagreements).
8. **Jobs** — the crawl queue: what ran, how long, counters, errors.

## Talking points

- Two independent sources per game (school site + NCAA.com) reconciled automatically; the school is the
  truth when its box score validates, NCAA.com fills gaps (tournament games the NCAA feed dropped, sites we cannot parse).
- Roughly 85% of schools run Sidearm, 10% PrestoSports; both are handled. Polite crawling: 1 request/second per host, identified UA.
- Everything here is a fact (rosters, results, stats). Logos and headshots are hot-linked, never stored.
- Plaibook integration is ready but not switched on: the same tables are read by the Plaibook API gateway (`college_*` ops), so
  Tekki tools and coach-facing pages are the next step, not a rebuild.
