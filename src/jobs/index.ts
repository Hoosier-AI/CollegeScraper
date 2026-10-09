// Importing each job module registers it with the runner.
import './discoverTeams.js';
import './detectSites.js';
import './sweepScoreboard.js';
import './fetchGamesNcaa.js';
import './finalDetail.js';
import './mergeTwins.js';
import './syncSite.js';
import './reconcileGames.js';
import './computeAggregates.js';
import './refreshRankings.js';
import './verifyMembership.js';
import './computeStandings.js';
import './resolveOrphans.js';
import './liveScoreboard.js';
import './schedules.js';
import './quality.js';
import './weather.js';
// Plaibook Stats Pro (API-Football).
import './pro/catalog.js';
import './pro/scoreboard.js';
import './pro/detail.js';
import './pro/standings.js';
import './pro/backfill.js';
import './pro/collegeLink.js';
import './pro/plan.js';

export function registerAllJobs(): void { /* side-effect imports above */ }
