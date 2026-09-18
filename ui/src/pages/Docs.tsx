// Public API documentation. The route table and the stat dictionary are read from the service itself
// (/v1/openapi.json and /v1/meta) so this page cannot drift from what the API actually does.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ErrorBox, Section, Spinner } from '../components/ui';

interface Param { name: string; in: 'query' | 'path'; required?: boolean; description?: string; schema?: { type?: string; enum?: string[]; format?: string; minimum?: number; maximum?: number } }
interface Op { summary?: string; parameters?: Param[] }
interface Spec { paths: Record<string, { get: Op }>; info: { description?: string } }
interface Meta { player_stats: string[]; team_stats: string[]; limits: { anon_per_min: number; key_per_min: number }; contact: string | null; currentSeason: number }

const origin = () => (typeof location === 'undefined' ? '' : location.origin);

export default function Docs() {
  const spec = useQuery({ queryKey: ['openapi'], queryFn: () => api<Spec>('/v1/openapi.json') });
  const meta = useQuery({ queryKey: ['v1meta'], queryFn: () => api<Meta>('/v1/meta') });
  const routes = useMemo(() => Object.entries(spec.data?.paths ?? {}).filter(([p]) => p !== '/v1/openapi.json'), [spec.data]);

  return (
    <div className="space-y-8 pb-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-black tracking-tight text-ink-100">The Plaibook Stats API</h1>
        <p className="max-w-3xl text-ink-300">
          Read-only HTTP access to every NCAA soccer program, roster, game, box score, season stat, conference
          standing and poll we hold — the same data this site renders. <strong className="text-ink-100">No key, no
          signup.</strong> Send the request and you get JSON.
        </p>
      </header>

      <Section title="Quickstart">
        <Code>{`curl "${origin()}/v1/search?q=duke&gender=m"`}</Code>
        <p className="text-sm text-ink-400">
          Season is the fall calendar year ({meta.data?.currentSeason ?? 2026}). Gender is <Mono>m</Mono> or <Mono>w</Mono>.
          Division is <Mono>d1</Mono>, <Mono>d2</Mono> or <Mono>d3</Mono>. Ids are UUIDs; find them with <Mono>/v1/search</Mono> or <Mono>/v1/programs</Mono>.
        </p>
        <Code>{`curl "${origin()}/v1/standings?season=${meta.data?.currentSeason ?? 2026}&gender=m&division=d1"`}</Code>
      </Section>

      <Section title="Try it">
        {spec.isPending && <Spinner />}
        {spec.error && <ErrorBox error={spec.error} />}
        {spec.data && <TryIt routes={routes} currentSeason={meta.data?.currentSeason ?? 2026} />}
      </Section>

      <Section title="Authentication and limits">
        <div className="card space-y-3 text-sm text-ink-300">
          <p>
            <strong className="text-ink-100">Anonymous (default).</strong> Every route answers requests with no
            credentials at all, up to <strong className="text-ink-100">{meta.data?.limits.anon_per_min ?? 60} requests a minute per IP</strong>.
            Keyless responses may be read from any origin, so browser code can call them directly.
          </p>
          <p>
            <strong className="text-ink-100">With a key.</strong> A named key raises the limit to {meta.data?.limits.key_per_min ?? 600} a
            minute and is accepted only from the origins configured on the service. Send it either way:
          </p>
          <Code>{`curl -H "X-Api-Key: $KEY" "${origin()}/v1/meta"\ncurl -H "Authorization: Bearer $KEY" "${origin()}/v1/meta"`}</Code>
          <p>
            Every response carries <Mono>X-RateLimit-Limit</Mono> and <Mono>X-RateLimit-Remaining</Mono>; over the limit you get
            <Mono>429</Mono> with <Mono>Retry-After</Mono>. Errors are JSON:
            <Mono>{`{ "error": "bad_request" | "unauthorized" | "rate_limited" | "not_found", "message": "…" }`}</Mono>.
            Successful reads are cacheable for 60 seconds; the data itself changes every half hour in season and nightly otherwise.
          </p>
          {meta.data?.contact && (
            <p>Need a higher limit, or planning something heavy? <a className="text-teal-400 hover:text-teal-300" href={`mailto:${meta.data.contact}?subject=Plaibook%20Stats%20API%20key`}>Ask for a key</a>.</p>
          )}
        </div>
      </Section>

      <Section title="Routes" right={<a className="text-sm text-teal-400 hover:text-teal-300" href="/v1/openapi.json">OpenAPI 3.1 →</a>}>
        {spec.isPending && <Spinner />}
        <div className="space-y-2">
          {routes.map(([path, item]) => (
            <details key={path} className="rounded-xl border border-navy-700 bg-navy-900/60">
              <summary className="cursor-pointer select-none px-3 py-2">
                <span className="mr-2 rounded bg-navy-800 px-1.5 py-0.5 text-[11px] font-bold text-teal-400">GET</span>
                <Mono>{path}</Mono>
                <span className="ml-2 text-sm text-ink-400">{item.get.summary}</span>
              </summary>
              <div className="border-t border-navy-700 px-3 py-2">
                {item.get.parameters?.length ? (
                  <table className="min-w-full text-sm">
                    <thead><tr><th className="th">Parameter</th><th className="th">Type</th><th className="th">Notes</th></tr></thead>
                    <tbody>
                      {item.get.parameters.map((p) => (
                        <tr key={p.name}>
                          <td className="td"><Mono>{p.name}</Mono>{p.required && <span className="ml-1 text-[11px] text-amber-300">required</span>}</td>
                          <td className="td text-ink-400">{p.schema?.enum ? p.schema.enum.slice(0, 8).join(' | ') + (p.schema.enum.length > 8 ? ' | …' : '') : p.schema?.format ?? p.schema?.type ?? 'string'}</td>
                          <td className="td whitespace-normal text-ink-400">{p.description ?? (p.in === 'path' ? 'Path segment.' : '')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="text-sm text-ink-500">No parameters.</p>}
              </div>
            </details>
          ))}
        </div>
      </Section>

      <Section title="Stat names">
        <div className="card space-y-3 text-sm text-ink-300">
          <p>
            <Mono>/v1/leaders</Mono> sorts by any of these, and they are the keys inside every <Mono>stats</Mono> object.
            <Mono>pct_*</Mono> and <Mono>div_pct_*</Mono> are percentiles within the division (0–1); <Mono>div_rank_*</Mono> and
            <Mono>conf_rank_*</Mono> are ranks where 1 is best. Player percentiles need at least 30 % of team minutes (keepers, 180 minutes).
          </p>
          <StatList label="Players" names={meta.data?.player_stats} />
          <StatList label="Teams" names={meta.data?.team_stats} />
        </div>
      </Section>

      <Section title="How records are verified">
        <div className="card space-y-2 text-sm text-ink-300">
          <p>
            Records are computed from every final game with both programs and a score. Games against non-NCAA
            opponents count; preseason exhibitions do not. Each standings row carries <Mono>checks[]</Mono> comparing
            our record with the conference's official table and with NCAA.com:
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li><Mono>conf_record</Mono>, <Mono>overall_record</Mono>, <Mono>ncaa_record</Mono> — a real difference, ours against theirs.</li>
            <li><Mono>*_lag</Mono> — the source lists fewer games than we hold and every result it does list matches ours: it simply has not posted the latest games.</li>
            <li><Mono>ncaa_record_ncaa_duplicate</Mono> — NCAA.com lists the same game twice.</li>
          </ul>
          <p>Each game also carries <Mono>source_of_truth</Mono> (<Mono>site</Mono> or <Mono>ncaa</Mono>), naming which box score the aggregates were built from.</p>
        </div>
      </Section>

      <Section title="Versioning">
        <p className="text-sm text-ink-400">
          <Mono>/v1</Mono> is stable: fields get added, never renamed or removed. A breaking change would ship as <Mono>/v2</Mono>.
        </p>
      </Section>
    </div>
  );
}

function StatList({ label, names }: { label: string; names?: string[] }) {
  if (!names?.length) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="flex flex-wrap gap-1">
        {names.map((n) => <span key={n} className="rounded bg-navy-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-300">{n}</span>)}
      </div>
    </div>
  );
}

function TryIt({ routes, currentSeason }: { routes: [string, { get: Op }][]; currentSeason: number }) {
  const [path, setPath] = useState(routes[0]?.[0] ?? '/v1/meta');
  const op = routes.find(([p]) => p === path)?.[1].get;
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ status: number; ms: number; body: string; limit?: string } | null>(null);
  const [running, setRunning] = useState(false);

  const url = useMemo(() => {
    let out = path;
    const query = new URLSearchParams();
    for (const p of op?.parameters ?? []) {
      const v = (values[`${path}:${p.name}`] ?? (p.name === 'season' ? String(currentSeason) : '')).trim();
      if (!v) continue;
      if (p.in === 'path') out = out.replace(`{${p.name}}`, encodeURIComponent(v));
      else query.set(p.name, v);
    }
    const s = query.toString();
    return out + (s ? `?${s}` : '');
  }, [path, op, values, currentSeason]);

  const incomplete = url.includes('{');
  const run = async () => {
    setRunning(true);
    const t0 = performance.now();
    try {
      const res = await fetch(url);
      const text = await res.text();
      let body = text;
      try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* leave as-is */ }
      setResult({ status: res.status, ms: Math.round(performance.now() - t0), body: body.slice(0, 20000), limit: res.headers.get('X-RateLimit-Remaining') ?? undefined });
    } catch (e) {
      setResult({ status: 0, ms: Math.round(performance.now() - t0), body: e instanceof Error ? e.message : String(e) });
    } finally { setRunning(false); }
  };

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input" value={path} onChange={(e) => { setPath(e.target.value); setResult(null); }}>
          {routes.map(([p, item]) => <option key={p} value={p}>{p} — {item.get.summary}</option>)}
        </select>
        <button className="btn-primary" onClick={run} disabled={running || incomplete}>{running ? 'Running…' : 'Send'}</button>
      </div>
      {!!op?.parameters?.length && (
        <div className="flex flex-wrap gap-2">
          {op.parameters.map((p) => (
            <label key={p.name} className="flex items-center gap-1 text-xs text-ink-400">
              <span>{p.name}{p.required && <span className="text-amber-300">*</span>}</span>
              {p.schema?.enum && p.schema.enum.length <= 12 ? (
                <select className="input py-1" value={values[`${path}:${p.name}`] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [`${path}:${p.name}`]: e.target.value }))}>
                  <option value="">—</option>
                  {p.schema.enum.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input className="input w-36 py-1" placeholder={p.name === 'season' ? String(currentSeason) : p.in === 'path' ? 'uuid' : ''}
                  value={values[`${path}:${p.name}`] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [`${path}:${p.name}`]: e.target.value }))} />
              )}
            </label>
          ))}
        </div>
      )}
      <Code>{`curl "${origin()}${url}"`}</Code>
      {incomplete && <p className="text-xs text-amber-300">Fill the path parameter — grab an id from /v1/search or /v1/programs.</p>}
      {result && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-3 text-xs text-ink-400">
            <span className={result.status === 200 ? 'text-emerald-300' : 'text-amber-300'}>HTTP {result.status || 'failed'}</span>
            <span>{result.ms} ms</span>
            {result.limit && <span>{result.limit} requests left this minute</span>}
          </div>
          <pre className="max-h-96 overflow-auto rounded-xl border border-navy-700 bg-navy-950 p-3 text-[11px] leading-snug text-ink-300">{result.body}</pre>
        </div>
      )}
    </div>
  );
}

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-auto rounded-xl border border-navy-700 bg-navy-950 p-3 pr-20 text-[12px] leading-relaxed text-teal-300">{children}</pre>
      <button className="btn-ghost absolute right-2 top-2 py-1 text-xs"
        onClick={() => { navigator.clipboard?.writeText(children).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-navy-800 px-1 py-0.5 font-mono text-[12px] text-ink-200">{children}</code>;
