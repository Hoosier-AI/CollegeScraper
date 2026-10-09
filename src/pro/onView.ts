// What players and clubs fetched on view share: one daily request cap (PRO_ON_VIEW_PER_DAY, default 600, players and
// clubs together), the everyday quota floor, the bot check, a stand-in job context for the crawl helpers, and the
// "wait a few seconds at most" race.
import type { Db } from '../db/client.js';
import { kvGet, kvSet } from '../db/client.js';
import type { JobContext } from '../jobs/runner.js';
import type { ApiFootball } from '../sources/apiFootball/client.js';

export const capPerDay = () => Number(process.env.PRO_ON_VIEW_PER_DAY) || Number(process.env.PRO_PLAYER_REFRESH_PER_DAY) || 600;
const dayKey = () => `pro:on_view:${new Date().toISOString().slice(0, 10)}`;

/** Reserve `calls` requests from today's on-view allowance and the everyday quota; false when either is spent. */
export async function reserveCalls(db: Db, api: ApiFootball, calls: number): Promise<boolean> {
  if (calls <= 0) return true;
  if (api.headroom('everyday') < calls + 20) return false;
  const spent = Number((await kvGet<number>(db, dayKey())) ?? 0);
  if (spent + calls > capPerDay()) return false;
  await kvSet(db, dayKey(), spent + calls);
  return true;
}

/** Search engines and link previews read the server-rendered pages; their API calls never spend requests. */
export const isBot = (ua: string | undefined): boolean => !ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget|python|headless/i.test(ua);

/** The crawl helpers take a job context; on view there is no run, so counters go nowhere. */
export const viewContext = (db: Db): JobContext => ({
  db, runId: null, params: {}, counters: {}, inc: () => {}, note: () => {}, cancelled: async () => false, heartbeat: async () => {},
});

/** At most `ms` of waiting: whatever is slower lands for the next visit. */
export const within = <T>(p: Promise<T>, ms: number, late: T): Promise<T> => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(late), ms))]);
