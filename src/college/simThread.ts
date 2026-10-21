// simulate() off the event loop. One worker per job run, one division per message; where the compiled worker file
// does not exist (tests and `tsx` run the .ts sources) or the thread fails to start, it runs inline as before.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { simulate, type SimInput, type SimOdds } from './sim.js';

export interface SimRunner { run(input: SimInput): Promise<SimOdds[]>; close(): Promise<void>; threaded: boolean }

export function simRunner(): SimRunner {
  const file = new URL('./simWorker.js', import.meta.url);
  let worker: Worker | null = null;
  try {
    if (existsSync(fileURLToPath(file))) worker = new Worker(file);
  } catch {
    worker = null;
  }
  if (!worker) return { run: async (input) => simulate(input), close: async () => {}, threaded: false };
  const w = worker;
  return {
    threaded: true,
    run: (input) => new Promise<SimOdds[]>((resolve, reject) => {
      const done = () => { w.off('message', onMessage); w.off('error', onError); w.off('exit', onExit); };
      const onMessage = (m: { odds?: SimOdds[]; error?: string }) => { done(); if (m.odds) resolve(m.odds); else reject(new Error(`simulation: ${m.error}`)); };
      const onError = (err: Error) => { done(); reject(err); };
      const onExit = (code: number) => { done(); reject(new Error(`simulation thread exited (${code})`)); };
      w.on('message', onMessage); w.on('error', onError); w.on('exit', onExit);
      const { rng: _rng, ...plain } = input;
      w.postMessage(plain);
    }),
    close: async () => { await w.terminate(); },
  };
}
