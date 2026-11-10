// Parent side: keeps the worker child (dist/worker.js) running next to the website and starts it again if it dies.
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';
import { setRemoteOutbound } from './ops/netMeter.js';

const file = fileURLToPath(new URL('./worker.js', import.meta.url));
/** Where the compiled child exists (not under `tsx`, which runs the .ts sources: the lanes then run inline). */
export const workerBuilt = (): boolean => existsSync(file);

export interface WorkerSupervisor { status(): { pid: number | null; restarts: number; last_exit: string | null; started_at: string | null } }

// The crawl's own heap ceiling. The 2 GB instance is shared with the website (its own ceiling is set in the
// Dockerfile): a job that runs away is stopped here and the website stays up.
const WORKER_HEAP_MB = Number(process.env.WORKER_HEAP_MB) || 1000;

export function superviseWorker(signal: AbortSignal): WorkerSupervisor {
  let child: ChildProcess | null = null;
  let restarts = 0, lastExit: string | null = null, startedAt: string | null = null, fastExits = 0;
  const start = () => {
    if (signal.aborted) return;
    const t0 = Date.now();
    child = fork(file, [], { execArgv: [`--max-old-space-size=${WORKER_HEAP_MB}`], env: process.env });
    startedAt = new Date().toISOString();
    log.info({ pid: child.pid, heap_mb: WORKER_HEAP_MB }, 'worker process forked');
    child.on('message', (m: any) => { if (m?.type === 'net' && Array.isArray(m.rows)) setRemoteOutbound(m.rows); });
    // A fork that fails (out of memory, EAGAIN) emits 'error' and no 'exit'. Unhandled, that error reached
    // uncaughtException and took the WEBSITE down with it; handled, the crawl just tries again after a wait.
    child.on('error', (err) => {
      log.error({ err: String(err) }, 'worker process error');
      if (child && !child.pid) {
        child = null;
        if (signal.aborted) return;
        restarts++;
        fastExits++;
        setTimeout(start, Math.min(60_000, 2_000 * 2 ** Math.min(fastExits, 5))).unref();
      }
    });
    child.on('exit', (code, sig) => {
      lastExit = `${new Date().toISOString()} code=${code} signal=${sig}`;
      child = null;
      if (signal.aborted) return;
      restarts++;
      // A child that dies within a minute backs off (up to a minute) so a crash loop cannot spin the CPU.
      fastExits = Date.now() - t0 < 60_000 ? fastExits + 1 : 0;
      const wait = Math.min(60_000, 2_000 * 2 ** Math.min(fastExits, 5));
      log.error({ code, sig, restarts, retry_ms: wait }, 'worker process exited, restarting');
      setTimeout(start, wait).unref();
    });
  };
  start();
  // A deploy: pass SIGTERM on, so the lanes stop taking jobs and the child flushes (Render ends the process after 30 s).
  signal.addEventListener('abort', () => { child?.kill('SIGTERM'); });
  return { status: () => ({ pid: child?.pid ?? null, restarts, last_exit: lastExit, started_at: startedAt }) };
}
