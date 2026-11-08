// The crawl process: every worker lane, the scheduler and the source-request flush, apart from the website.
// Started by src/workerProcess.ts (a child of the web process, with its own heap and event loop). A job that holds
// the CPU or fills the heap stalls or crashes only this process; the website keeps answering and the parent starts
// this one again.
import { loadConfig } from './config.js';
import { getDb } from './db/client.js';
import { registerAllJobs } from './jobs/index.js';
import { runningNow } from './jobs/runner.js';
import { log } from './log.js';
import { meterFetch, outboundSnapshot } from './ops/netMeter.js';
import { flushRequests, startRequestFlush } from './ops/sourceRequests.js';
import { startWorkers } from './workerLanes.js';

globalThis.fetch = meterFetch(globalThis.fetch);
const cfg = loadConfig();
registerAllJobs();

const controller = new AbortController();
const stop = () => { controller.abort(); void flushRequests(getDb()).catch(() => {}); setTimeout(() => process.exit(0), 20_000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
// The parent is gone (it crashed or was killed): do not run on alone.
process.on('disconnect', () => { controller.abort(); process.exit(0); });

// Event-loop watchdog for this process (the web process has its own on /health).
let last = Date.now();
setInterval(() => {
  const now = Date.now(), lag = now - last - 500;
  last = now;
  if (lag >= 1000) log.warn({ lag_ms: lag, jobs: runningNow(), proc: 'worker' }, 'worker event loop stalled');
}, 500).unref();

startWorkers(controller, cfg);
startRequestFlush(getDb());
log.info({ pid: process.pid }, 'worker process started');

// Network meter snapshot for the web process's /api/console/net.
if (process.send) setInterval(() => { try { process.send?.({ type: 'net', rows: outboundSnapshot() }); } catch { /* parent gone */ } }, 15_000).unref();
