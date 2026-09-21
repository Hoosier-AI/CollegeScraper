// Data access for the owner's console: every read is an admin-only /api/console route, polled where it changes.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api } from './api';

export interface Heartbeat { at: string; pid: number; host: string; run_id: string | null; job: string | null; started_at: string }
export interface Health { ok: boolean; problems: string[]; lanes: Record<string, { alive: boolean; age_s: number | null; job: string | null }>; db: { ok: boolean } }
export interface ScheduleEntry { job: string; label: string; cadence: string; enabled: boolean; last_fired: string | null; next: string | null; gated: boolean }
export interface Schedule { enabled: boolean; paused: boolean; tick_at: string | null; entries: ScheduleEntry[] }
export interface LiveSettings { scoreboard_every_min: number; detail_enabled: boolean; detail_every_min: number; detail_budget: number; tick_budget_ms: number }
export interface JobRollup { last_done: { id: string; finished_at: string | null; started_at: string | null } | null; last_failed: { id: string; finished_at: string | null; error: string | null } | null; queued: number; running: number }
export interface Overview {
  season: number; host: string; health: Health; other_hosts: { lane: string; host: string; at: string; job: string | null; alive: boolean }[]; scheduler: Schedule;
  live: { settings: LiveSettings; games_live: number; with_fresh_stats: number; last_run: { id: string; status: string; finished_at: string | null; counters: Record<string, unknown>; error: string | null } | null };
  queue: { queued: number; running: { id: string; job: string; params: Record<string, unknown>; started_at: string; heartbeat_at: string | null; counters: Record<string, unknown> }[] };
  jobs: Record<string, JobRollup>;
  counts: { programs: number; games: number; finals: number; finals_with_box: number; box_coverage: number | null };
  api_today: { principal: string; requests: number; limited: number }[];
  flags: { crawl_paused: boolean; scheduler_paused: boolean };
  generated_at: string;
}
export interface ParamSpec { name: string; type: 'number' | 'string' | 'boolean' | 'enum' | 'string[]' | 'json'; label: string; help?: string; default?: unknown; options?: string[]; required?: boolean }
export interface CatalogueJob { name: string; description: string; lane: 'crawl' | 'live'; composite?: boolean; params: ParamSpec[]; dangerous?: boolean; scheduled: boolean }
export interface Run { id: string; job: string; status: string; params: Record<string, unknown>; started_at: string | null; heartbeat_at: string | null; finished_at: string | null; counters: Record<string, unknown>; error: string | null; created_at: string }
export interface RunsPage { rows: Run[]; total: number; limit: number; offset: number }
export interface QualityCheck { id: string; title: string; description: string; count: number; sample: any[]; previous: number | null; delta: number | null }
export interface QualityData { season: number; latest: { id: string; taken_at: string; games: number; finals: number; checks: QualityCheck[] } | null; previous_taken_at: string | null; history: Record<string, { taken_at: string; count: number }[]>; snapshots: number }
export interface HostRow { host: string; fetches: number; errors: number; status_429: number; last_error: string | null; last_error_at: string | null; retry_backlog: number }
export interface CrawlData { hosts_24h: HostRow[]; hosts_7d: HostRow[]; process: { totals: { requests: number; cacheHits: number; notModified: number; errors: number; status429: number; robotsBlocked: number }; hosts: ({ host: string } & { requests: number; errors: number; status429: number; lastError: string | null; lastErrorAt: string | null })[] } | null; flags: { crawl_paused: boolean; scheduler_paused: boolean }; cache_rows: number; generated_at: string }
export interface SettingsData { live: LiveSettings; scheduler_paused: boolean; crawl_paused: boolean; overrides: Record<string, { enabled: boolean }>; contact_email: string; jobs: string[] }
export interface ApiKeyRow { id: string | null; name: string; source: 'env' | 'db'; prefix: string | null; note: string | null; created_at: string | null; revoked_at: string | null; last_used_at: string | null }
export interface ApiData { keys: ApiKeyRow[]; usage: { day: string; principal: string; requests: number; limited: number; last_seen_at: string | null }[]; pending: { day: string; principal: string; requests: number; limited: number }[]; limits: { key: number; anon: number; site: number }; cors_origins: string[]; public_url: string | null; plaibook: { name: string; last_seen_at: string | null; today: number } | null }
export interface DeployData { configured: boolean; service_id?: string | null; service?: { id: string; name: string; suspended?: string; autoDeploy?: string; branch?: string; repo?: string; updatedAt?: string; serviceDetails?: { url?: string; plan?: string; region?: string; healthCheckPath?: string } }; deploys?: { id: string; status: string; createdAt: string; finishedAt?: string | null; trigger?: string; commit?: { id?: string; message?: string } }[]; env?: { key: string; value: string; secret: boolean; protected: boolean }[] }

export function useConsole<T>(path: string, opts: { every?: number | false; enabled?: boolean } = {}): UseQueryResult<T> {
  return useQuery({ queryKey: ['console', path], queryFn: () => api<T>(`/api/console${path}`), refetchInterval: opts.every ?? false, enabled: opts.enabled ?? true });
}

/** A console write; the listed console paths are refetched when it lands. */
export function useConsoleAction<TVars = void>(fn: (v: TVars) => { path: string; method?: 'POST' | 'PUT'; body?: unknown }, invalidate: string[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: TVars) => { const r = fn(v); return api<any>(`/api/console${r.path}`, { method: r.method ?? 'POST', body: r.body === undefined ? undefined : JSON.stringify(r.body) }); },
    onSuccess: () => { for (const p of invalidate) void qc.invalidateQueries({ queryKey: ['console', p] }); void qc.invalidateQueries({ queryKey: ['runs'] }); },
  });
}
