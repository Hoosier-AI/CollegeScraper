// Where the service's bytes go. Render bills every byte the service sends past 5 GB a month ($0.15/GB), and
// ~14 GB a day left it in hours with almost no visitors (2026-11-02). Counted in memory since start, read at
// /api/console/net (a deploy resets it):
// - outbound: what each job (and each step of a composite job) sends to each host: the database, crawled sites,
//   providers. Method + URL + headers + body, plus what came back where the response gives its length;
// - served: what each kind of site request was answered with (the socket's bytesWritten across the request).
import { AsyncLocalStorage } from 'node:async_hooks';

type Row = { requests: number; out: number; in: number };
type AnyFetch = (input: any, init?: any) => Promise<any>;

const METERED = Symbol.for('plaibook.netMeter');
const scope = new AsyncLocalStorage<() => string>();
const outbound = new Map<string, Row>();
const served = new Map<string, Row>();
let since = new Date().toISOString();

/** Runs a job with its name (a function, so a composite job's current step is read at request time). */
export const withJob = <T>(label: () => string, fn: () => Promise<T>): Promise<T> => scope.run(label, fn);

const bump = (m: Map<string, Row>, key: string): Row => {
  let r = m.get(key);
  if (!r) { r = { requests: 0, out: 0, in: 0 }; m.set(key, r); }
  return r;
};

function headerBytes(h: unknown): number {
  if (!h) return 0;
  let n = 0;
  const add = (k: string, v: string) => { n += k.length + String(v).length + 4; };
  if (typeof (h as Headers).forEach === 'function' && !Array.isArray(h)) (h as Headers).forEach((v, k) => add(k, v));
  else if (Array.isArray(h)) for (const [k, v] of h) add(k, v);
  else for (const [k, v] of Object.entries(h as Record<string, string>)) add(k, v);
  return n;
}

function bodyBytes(b: unknown): number {
  if (typeof b === 'string') return Buffer.byteLength(b);
  if (b instanceof ArrayBuffer) return b.byteLength;
  if (ArrayBuffer.isView(b)) return b.byteLength;
  if (b instanceof URLSearchParams) return Buffer.byteLength(b.toString());
  return 0;
}

/** A fetch that counts its bytes against the running job and the host. Wrapping twice counts once. */
export function meterFetch<F extends AnyFetch>(f: F): F {
  if ((f as any)[METERED]) return f;
  const metered = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url ?? '');
    const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
    let host = 'unknown';
    let detail = '';
    try {
      const u = new URL(url);
      host = u.host;
      // PostgREST calls name their table (or function), so the database's share splits by what was written.
      const rest = /^\/rest\/v1\/(rpc\/)?([^/?]+)/.exec(u.pathname);
      if (rest) detail = `${rest[1] ? 'RPC' : method} ${rest[2]}`;
    } catch { /* relative or odd input */ }
    const row = bump(outbound, `${scope.getStore()?.() ?? 'web'}|${host}|${detail}`);
    row.requests++;
    // Request line and HTTP/1.1 framing, roughly; TLS adds a little more.
    row.out += method.length + url.length + 40 + headerBytes(init?.headers ?? input?.headers) + bodyBytes(init?.body);
    const res = await f(input, init);
    const len = Number(res?.headers?.get?.('content-length'));
    if (Number.isFinite(len)) row.in += len;
    return res;
  }) as F;
  (metered as any)[METERED] = true;
  return metered;
}

/** Counts one site response: `who` (a kind of caller) and `what` (a route group). */
export function meterServed(who: string, what: string, bytes: number): void {
  const r = bump(served, `${who}|${what}`);
  r.requests++;
  r.out += Math.max(0, bytes);
}

/** The route group a URL is counted under: /api/<first part>, /v1/<first part>, assets, or pages. */
export function routeGroup(url: string): string {
  const path = url.split('?')[0] ?? '';
  const m = /^\/(api|v1)\/([^/]+)(?:\/([^/]+))?/.exec(path);
  if (m) return m[2] === 'site' || m[2] === 'pro' || m[2] === 'intl' || m[2] === 'console' ? `/${m[1]}/${m[2]}/${m[3] ?? ''}` : `/${m[1]}/${m[2]}`;
  if (path.startsWith('/assets/')) return 'assets';
  return 'pages';
}

const GB = 1024 ** 3;
const sum = (rows: Row[]): Row => rows.reduce((a, r) => ({ requests: a.requests + r.requests, out: a.out + r.out, in: a.in + r.in }), { requests: 0, out: 0, in: 0 });
const view = (r: Row, hours: number) => ({ requests: r.requests, out_bytes: r.out, out_mb: +(r.out / 1024 ** 2).toFixed(1), in_mb: +(r.in / 1024 ** 2).toFixed(1), out_gb_per_day: +((r.out / GB) * (24 / hours)).toFixed(2) });
function group(m: Map<string, Row>, pick: (key: string) => string): Map<string, Row> {
  const g = new Map<string, Row>();
  for (const [k, r] of m) { const x = bump(g, pick(k)); x.requests += r.requests; x.out += r.out; x.in += r.in; }
  return g;
}
const ranked = (m: Map<string, Row>, hours: number, n: number) => [...m].sort((a, b) => b[1].out - a[1].out).slice(0, n).map(([key, r]) => ({ key, ...view(r, hours) }));

/** The console's report. `dbHost` is labelled "database". */
export function netReport(dbHost: string | null, now = Date.now()) {
  const hours = Math.max((now - Date.parse(since)) / 3_600_000, 1 / 60);
  const label = (host: string) => (host === dbHost ? 'database' : host);
  const relabelled = new Map([...outbound].map(([k, r]) => { const [job, host, detail] = k.split('|'); return [`${job}|${label(host ?? '')}|${detail ?? ''}`, r] as const; }));
  const part = (k: string, i: number) => k.split('|')[i] ?? '';
  return {
    since, hours: +hours.toFixed(2),
    outbound: {
      total: view(sum([...outbound.values()]), hours),
      by_host: ranked(group(relabelled, (k) => part(k, 1)), hours, 25),
      by_job: ranked(group(relabelled, (k) => part(k, 0)), hours, 40),
      // Database calls by method and table, across jobs.
      by_table: ranked(group(new Map([...relabelled].filter(([k]) => part(k, 1) === 'database')), (k) => part(k, 2)), hours, 40),
      top: ranked(relabelled, hours, 50),
    },
    served: {
      total: view(sum([...served.values()]), hours),
      by_who: ranked(group(served, (k) => k.split('|')[0] ?? ''), hours, 10),
      by_route: ranked(group(served, (k) => k.split('|')[1] ?? ''), hours, 30),
      top: ranked(served, hours, 30),
    },
  };
}

/** Tests only. */
export function resetNetMeter(): void { outbound.clear(); served.clear(); since = new Date().toISOString(); }
