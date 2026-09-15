import { Command } from 'commander';
import { loadConfig } from './config.js';
import { getDb } from './db/client.js';
import { registerAllJobs } from './jobs/index.js';
import { enqueue, jobNames, runInline } from './jobs/runner.js';
import { log } from './log.js';

registerAllJobs();
const program = new Command();
program.name('college-scraper').description('NCAA college soccer data collector (school sites + NCAA.com)');

const common = (c: Command) => c
  .option('--season <n>', 'fall season year, e.g. 2025')
  .option('--program <seo>', 'restrict to one school (NCAA seo slug, e.g. duke)')
  .option('--gender <m|w>', 'restrict to one gender')
  .option('--division <d1|d2|d3>', 'restrict to one division')
  .option('--force', 'ignore fetch cache freshness');

function paramsFrom(opts: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (opts.season) p.season = Number(opts.season);
  if (opts.program) p.program = String(opts.program);
  if (opts.gender) p.gender = String(opts.gender);
  if (opts.division) p.division = String(opts.division);
  if (opts.force) p.force = true;
  return p;
}

for (const job of ['discover-teams', 'detect-sites', 'sweep-scoreboard', 'fetch-games-ncaa', 'sync-site', 'reconcile-games', 'compute-aggregates', 'refresh-rankings', 'verify-membership', 'compute-standings', 'resolve-orphans', 'pq-health', 'backfill', 'sync-program', 'hourly', 'nightly', 'weekly']) {
  common(program.command(job).description(`run the ${job} job inline`))
    .option('--stages <list>', 'sync-site: comma list of roster,schedule,stats,boxscores,bios')
    .option('--days <all|recent>', 'sweep-scoreboard: date range')
    .option('--all', 'reconcile-games: re-evaluate every final game')
    .option('--conference <seo>', 'compute-standings: one conference (ncaa seo)')
    .option('--only-unknown', 'detect-sites: only schools not yet classified')
    .option('--skip-categories', 'refresh-rankings: polls only, no NCAA.com category ranks')
    .action(async (opts) => {
      const p = paramsFrom(opts);
      if (opts.stages) p.stages = String(opts.stages).split(',');
      if (opts.days) p.days = opts.days;
      if (opts.all) p.all = true;
      if (opts.conference) p.conference = String(opts.conference);
      if (opts.onlyUnknown) p.only_unknown = true;
      if (opts.skipCategories) p.categories = false;
      const counters = await runInline(getDb(), job, p);
      console.log(JSON.stringify(counters, null, 2));
    });
}

program.command('enqueue <job>').description('queue a job for the worker').action(async (job: string) => {
  if (!jobNames().includes(job)) throw new Error(`unknown job ${job}; known: ${jobNames().join(', ')}`);
  console.log(JSON.stringify(await enqueue(getDb(), job, {})));
});

program.command('jobs').description('list job names').action(() => console.log(jobNames().join('\n')));

common(program.command('smoke').description('end-to-end crawl of one program (site + NCAA), then aggregates and checks'))
  .action(async (opts) => {
    const { smoke } = await import('./jobs/smoke.js');
    const ok = await smoke(getDb(), { season: Number(opts.season ?? new Date().getUTCFullYear()), program: String(opts.program ?? 'duke'), gender: (opts.gender as 'm' | 'w') ?? 'm', division: (opts.division as 'd1' | 'd2' | 'd3') ?? 'd1', force: !!opts.force });
    process.exit(ok ? 0 : 1);
  });

program.parseAsync(process.argv).catch((err) => {
  log.error({ err: err instanceof Error ? err.message : String(err) }, 'cli failed');
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
void loadConfig;
