// What each job does and which parameters it takes, so the console can draw a form per job instead of a JSON
// box. Kept in one place next to the schedule rather than spread over the job modules; tests/jobs/catalogue.test.ts
// checks every registered job is described here.
import type { JobMeta, ParamSpec } from './runner.js';

const season: ParamSpec = { name: 'season', type: 'number', label: 'Season', help: 'Defaults to the current season.' };
const gender: ParamSpec = { name: 'gender', type: 'enum', label: 'Gender', options: ['m', 'w'], help: 'Both when blank.' };
const division: ParamSpec = { name: 'division', type: 'enum', label: 'Division', options: ['d1', 'd2', 'd3'], help: 'All when blank.' };
const program: ParamSpec = { name: 'program', type: 'string', label: 'Program (school slug)', help: 'One school, e.g. duke.' };
const force: ParamSpec = { name: 'force', type: 'boolean', label: 'Force', help: 'Ignore freshness and re-fetch.' };
const STAGES = ['roster', 'schedule', 'stats', 'boxscores', 'bios'];

export const JOB_META: Record<string, JobMeta> = {
  'discover-teams': { description: 'Find every program from the NCAA.com scoreboard and school pages; creates programs and program-seasons.', lane: 'crawl', params: [season, gender, division, program, force, { name: 'skip_school_pages', type: 'boolean', label: 'Skip school pages' }], dangerous: true },
  'detect-sites': { description: 'Work out which platform (Sidearm, Presto, WMT) each school\'s athletics site runs.', lane: 'crawl', params: [season, program, force, { name: 'only_unknown', type: 'boolean', label: 'Only unclassified schools' }, { name: 'platforms', type: 'string[]', label: 'Re-probe platforms', help: 'e.g. unknown, other' }, { name: 'program_status', type: 'string[]', label: 'Only site statuses', help: 'unknown, failed, not_found' }] },
  'sweep-scoreboard': { description: 'Read the NCAA.com scoreboard for each day and division: creates fixtures, links contest ids, records finals.', lane: 'crawl', params: [season, gender, division, { name: 'days', type: 'enum', label: 'Days', options: ['recent', 'all'], default: 'recent', help: 'recent = yesterday, today, tomorrow.' }, force] },
  'fetch-games-ncaa': { description: 'Fetch NCAA.com box scores and play-by-play for finished games with a contest id.', lane: 'crawl', params: [season, gender, division, program, { name: 'recent_days', type: 'number', label: 'Recent days', help: 'Only games in the last N days.' }, { name: 'refetch', type: 'boolean', label: 'Re-fetch already fetched' }, { name: 'limit', type: 'number', label: 'Limit' }, { name: 'contest_ids', type: 'string[]', label: 'Contest ids' }] },
  'sync-site': { description: 'Crawl school athletics sites: roster, schedule, cumulative stats, box scores, player bios.', lane: 'crawl', params: [season, program, gender, division, { name: 'stages', type: 'string[]', label: 'Stages', options: STAGES, help: 'All five when blank.' }, { name: 'only_recent_days', type: 'number', label: 'Only programs that played in the last N days' }, { name: 'only_pending_boxscores', type: 'number', label: 'Only programs with a box score missing (days)' }, { name: 'only_never_synced', type: 'boolean', label: 'Only never-synced rosters' }, force, { name: 'reparse', type: 'boolean', label: 'Re-parse stored pages', help: 'Box scores from the fetch cache, no new requests.' }, { name: 'from_cache', type: 'boolean', label: 'Use pages from the last 14 days', help: 'Fetch only what was never downloaded.' }], dangerous: true },
  'reconcile-games': { description: 'Pick each final\'s source of truth (school box score when valid, else NCAA.com) and repair swapped sides.', lane: 'crawl', params: [season, program, { name: 'all', type: 'boolean', label: 'Every final', help: 'Not just recently fetched ones.' }] },
  'compute-aggregates': { description: 'Recompute season totals per player and team from the box scores (and transfer links).', lane: 'crawl', params: [season, program, gender, { name: 'transfers', type: 'boolean', label: 'Link transfers', default: false }] },
  'refresh-rankings': { description: 'Read the United Soccer Coaches polls and NCAA.com category ranks.', lane: 'crawl', params: [season, gender, division, { name: 'categories', type: 'boolean', label: 'NCAA category ranks', default: true, help: 'Off = polls only (fast).' }] },
  'verify-membership': { description: 'Check conference membership and NCAA-listed records against NCAA.com\'s leaderboard.', lane: 'crawl', params: [season, gender, division] },
  'compute-standings': { description: 'Read conference standings pages and compute our own tables; records the differences.', lane: 'crawl', params: [season, gender, division, { name: 'conference', type: 'string', label: 'Conference (NCAA seo)', help: 'One conference only.' }] },
  'resolve-orphans': { description: 'Link box-score-only players and unresolved opponents to programs and rosters.', lane: 'crawl', params: [season] },
  'live': { description: 'Live scores and live stats from NCAA.com while games are in progress (runs every minute in game hours).', lane: 'live', params: [season, { name: 'dates', type: 'string[]', label: 'Dates (Eastern)', help: 'YYYY-MM-DD; today when blank.' }, force, { name: 'detail', type: 'boolean', label: 'Live stats phase', default: true }] },
  'pq-health': { description: 'Check the NCAA.com persisted GraphQL queries still work; re-learns the hashes if not.', lane: 'crawl', params: [] },
  'quality': { description: 'Run the data-quality checks for a season and store a snapshot the console can trend.', lane: 'crawl', params: [season] },
  'weather': { description: 'Weather at kickoff for the next week of matches: the ground\'s city (schedules, else the home team\'s usual city) and the National Weather Service hourly forecast.', lane: 'aux', params: [season, { name: 'days', type: 'number', label: 'Days ahead', default: 6, help: 'NWS forecasts reach about 6.5 days.' }, { name: 'force', type: 'boolean', label: 'Re-read every game', help: 'Ignore the 3-hour refresh rule.' }] },
  'h2h-detail': { description: 'NCAA.com box scores for earlier meetings a match page asked for (queued automatically for head-to-head scorers).', lane: 'aux', params: [season, { name: 'contest_ids', type: 'string[]', label: 'Contest ids' }] },
  'ops-retention': { description: 'Delete finished runs older than 30 days (live: 1 day), API usage older than 90 days, quality snapshots older than 180 days.', lane: 'crawl', params: [] },
  'hourly': { description: 'Every 30 minutes in season: recent scoreboard days, NCAA box scores, pending school box scores, reconcile, aggregates.', lane: 'crawl', composite: true, params: [season] },
  'nightly': { description: 'Daily: two-day sweep, NCAA re-fetch, school sync (no bios), orphans, reconcile, aggregates, standings, polls, quality, retention.', lane: 'crawl', composite: true, params: [season], dangerous: true },
  'standings': { description: 'Every 3 hours in season: membership verification, conference standings, polls.', lane: 'crawl', composite: true, params: [season] },
  'weekly': { description: 'Tuesdays: discover teams, verify membership, detect sites, rankings with categories, every schedule and box score, full sweep, orphans, reconcile all.', lane: 'crawl', composite: true, params: [season], dangerous: true },
  'backfill': { description: 'Everything for a season from scratch (hours).', lane: 'crawl', composite: true, params: [season, gender, division, force], dangerous: true },
  'sync-program': { description: 'One program end to end: site sync, NCAA box scores, reconcile, aggregates.', lane: 'crawl', composite: true, params: [season, program, gender, force, { name: 'conference', type: 'string', label: 'Conference (NCAA seo)' }] },
};

export function metaFor(name: string): JobMeta {
  return JOB_META[name] ?? { description: '', lane: 'crawl', params: [] };
}
