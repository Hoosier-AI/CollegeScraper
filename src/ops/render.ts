// The console's Deploy tab talks to Render's API for this one service: status, recent deploys, deploy latest,
// restart, and the environment. Values are always masked on the way out; the keys that would let the console
// take the database or the console itself hostage cannot be edited here.
export interface RenderEnvVar { key: string; value: string }
export interface RenderService { id: string; name: string; suspended?: string; autoDeploy?: string; branch?: string; repo?: string; updatedAt?: string; serviceDetails?: { url?: string; plan?: string; region?: string; healthCheckPath?: string } }
export interface RenderDeploy { id: string; status: string; createdAt: string; finishedAt?: string | null; trigger?: string; commit?: { id?: string; message?: string } }

/** Never editable from the console (dashboard only): losing them would lock the service or the console out. */
export const PROTECTED_ENV = new Set(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RENDER_API_KEY', 'RENDER_SERVICE_ID', 'COLLEGE_TRIGGER_SECRET']);
/** Shown masked (first three characters, then dots). */
export const SECRET_ENV = /SECRET|KEY|PASSWORD|TOKEN/i;

export function maskEnv(vars: RenderEnvVar[]): { key: string; value: string; secret: boolean; protected: boolean }[] {
  return vars.map((v) => {
    const secret = SECRET_ENV.test(v.key);
    return { key: v.key, value: secret ? `${v.value.slice(0, 3)}${'•'.repeat(Math.max(4, Math.min(12, v.value.length - 3)))}` : v.value, secret, protected: PROTECTED_ENV.has(v.key) };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

/** The full set to PUT back: current values with `set` applied and `remove` dropped; protected keys refused. */
export function mergeEnv(current: RenderEnvVar[], edits: { set?: Record<string, string>; remove?: string[] }): RenderEnvVar[] {
  for (const k of [...Object.keys(edits.set ?? {}), ...(edits.remove ?? [])]) {
    if (PROTECTED_ENV.has(k)) throw new Error(`${k} can only be changed in the Render dashboard`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) throw new Error(`${k} is not a valid variable name`);
  }
  const map = new Map(current.map((v) => [v.key, v.value]));
  for (const [k, v] of Object.entries(edits.set ?? {})) map.set(k, v);
  for (const k of edits.remove ?? []) map.delete(k);
  return [...map].map(([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key));
}

export class RenderClient {
  constructor(private apiKey: string, private serviceId: string, private fetchImpl: typeof fetch = fetch) {}
  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await this.fetchImpl(`https://api.render.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } });
    const text = await r.text();
    let body: unknown; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!r.ok) throw new Error(`Render ${init.method ?? 'GET'} ${path} → ${r.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    return body as T;
  }
  service(): Promise<RenderService> { return this.api(`/services/${this.serviceId}`); }
  async deploys(limit = 10): Promise<RenderDeploy[]> { const rows = await this.api<{ deploy: RenderDeploy }[]>(`/services/${this.serviceId}/deploys?limit=${limit}`); return rows.map((r) => r.deploy); }
  deploy(): Promise<RenderDeploy> { return this.api(`/services/${this.serviceId}/deploys`, { method: 'POST', body: JSON.stringify({ clearCache: 'do_not_clear' }) }); }
  restart(): Promise<unknown> { return this.api(`/services/${this.serviceId}/restart`, { method: 'POST' }); }
  async envVars(): Promise<RenderEnvVar[]> { const rows = await this.api<{ envVar: RenderEnvVar }[]>(`/services/${this.serviceId}/env-vars?limit=100`); return rows.map((r) => r.envVar); }
  putEnvVars(vars: RenderEnvVar[]): Promise<unknown> { return this.api(`/services/${this.serviceId}/env-vars`, { method: 'PUT', body: JSON.stringify(vars) }); }
}
