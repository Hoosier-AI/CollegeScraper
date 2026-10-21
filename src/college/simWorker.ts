// The season simulation on its own thread: simulate() is seconds of pure CPU per division, and on the web process it
// froze every page for up to 28 s while it ran (/health loop stalls, 2026-10-21). Messages are a SimInput without
// rng; the answer is { odds } or { error }.
import { parentPort } from 'node:worker_threads';
import { simulate, type SimInput } from './sim.js';

parentPort?.on('message', (input: SimInput) => {
  try {
    parentPort!.postMessage({ odds: simulate(input) });
  } catch (err) {
    parentPort!.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
});
