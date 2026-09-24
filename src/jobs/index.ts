// Importing each job module registers it with the runner.
import './discoverTeams.js';
import './detectSites.js';
import './sweepScoreboard.js';
import './fetchGamesNcaa.js';
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

export function registerAllJobs(): void { /* side-effect imports above */ }
