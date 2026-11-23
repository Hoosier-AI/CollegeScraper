// Database requests that hit a passing gateway error are tried again instead of failing the job.
//
// A single 502 from the database gateway while saving one game ended the weekly full re-sync on 2026-10-27 and
// 2026-11-03 after more than an hour of work; "fetch failed" and ECONNRESET did the same to hourly and pro-plan
// runs. Those answers mean the request may never have reached Postgres, so a request that is safe to send twice is
// sent again after a short wait.
//
// Safe to send twice: reads (GET, HEAD), updates and deletes (PATCH, PUT, DELETE: the same filter and the same values
// land the same way) and upserts (POST with Prefer: resolution=...). Plain inserts and RPCs are never repeated: an
// insert could land twice and an RPC such as college_claim_run changes state on every call.

const RETRY_STATUS = new Set([502, 503, 504]);
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PATCH', 'PUT', 'DELETE']);

type FetchInput = string | URL | Request;
type HeadersLike = Headers | [string, string][] | Record<string, string>;
type FetchFn = (input: FetchInput, init?: RequestInit) => Promise<Response>;

function headerValue(headers: HeadersLike | undefined, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) return headers.find(([k]) => k.toLowerCase() === name)?.[1] ?? null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? (headers as Record<string, string>)[key] ?? null : null;
}

/** Whether this request may be sent a second time. */
export function safeToRepeat(input: FetchInput, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (IDEMPOTENT.has(method)) return true;
  if (method !== 'POST') return false;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/rest/v1/rpc/')) return false;
  // An upsert: PostgREST merges or ignores a row that is already there.
  return /resolution=(merge|ignore)-duplicates/.test(headerValue(init?.headers as HeadersLike | undefined, 'prefer') ?? '');
}

/** A thrown fetch that means the connection failed, not that the request was refused or aborted on purpose. */
function transientError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return false;
  const text = `${err instanceof Error ? err.message : String(err)} ${String((err as { cause?: unknown })?.cause ?? '')}`;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|UND_ERR/i.test(text);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wraps fetch so a repeatable database request that gets a 502/503/504 or a dropped connection is tried again,
 * up to `attempts` times in all, waiting `delaysMs[i]` before try i+2. The last answer or error is returned as is.
 */
export function retryingFetch(inner: FetchFn, opts: { attempts?: number; delaysMs?: number[]; onRetry?: (info: { attempt: number; reason: string; url: string }) => void } = {}): FetchFn {
  const attempts = opts.attempts ?? 3;
  const delays = opts.delaysMs ?? [1_000, 4_000];
  return async (input, init) => {
    if (!safeToRepeat(input, init)) return inner(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await inner(input, init);
        if (!RETRY_STATUS.has(res.status) || attempt >= attempts) return res;
        opts.onRetry?.({ attempt, reason: `HTTP ${res.status}`, url });
        await res.body?.cancel().catch(() => {});
      } catch (err) {
        if (!transientError(err) || attempt >= attempts || init?.signal?.aborted) throw err;
        opts.onRetry?.({ attempt, reason: err instanceof Error ? err.message : String(err), url });
      }
      await sleep(delays[Math.min(attempt - 1, delays.length - 1)] ?? 1_000);
    }
  };
}
