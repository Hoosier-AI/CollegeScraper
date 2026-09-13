// Client for NCAA.com's GraphQL gateway (persisted queries only) plus an interchangeable
// transport for a self-hosted henrygd/ncaa-api instance. Both yield the same raw NCAA `data`
// objects, so `fetchGameDocs` / `fetchNcaaBoxScore` work with either.
//
// Verified live (2026-09-11, contest 6310566):
//   GET https://sdataprod.ncaa.com/?extensions={"persistedQuery":{"version":1,"sha256Hash":"<h>"}}&variables={"contestId":"6310566","staticTestEnv":null}
//     → {"data":{"boxscore":{…}}} / {"data":{"playbyplay":{…}}} / {"data":{"scoringSummary":{…}}}
//   gamecenter additionally sends meta=GetGamecenterGameById_web and variables {"id":"…","week":null,"staticTestEnv":null}
//     → {"data":{"contests":[{…location:{venue,city,stateUsps}, linescores:[…]}]}}
//   unknown hash → HTTP 200 {"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}
import type { BoxScore, Division, Fetcher, Gender } from '../../model.js';
import { PersistedQueryStore, type NcaaOp } from './persistedQueries.js';
import { parseNcaaBoxScore, type NcaaGameDocs } from './game.js';

export const GRAPHQL_ENDPOINT = 'https://sdataprod.ncaa.com/';

export class PersistedQueryNotFoundError extends Error {
  constructor(public readonly op: NcaaOp, public readonly hash: string) {
    super(`PersistedQueryNotFound for ${op} (${hash})`);
  }
}

export class NcaaGraphqlError extends Error {
  constructor(message: string, public readonly url: string, public readonly errors: unknown[]) {
    super(message);
  }
}

/** Build the GET URL the NCAA site uses (meta= is only sent for the gamecenter op, as the site does). */
export function graphqlUrl(hash: string, variables: Record<string, unknown>, opts: { meta?: string; queryName?: string } = {}): string {
  const q: string[] = [];
  if (opts.meta) q.push(`meta=${encodeURIComponent(opts.meta)}`);
  q.push(`extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }))}`);
  if (opts.queryName) q.push(`queryName=${encodeURIComponent(opts.queryName)}`);
  q.push(`variables=${encodeURIComponent(JSON.stringify(variables))}`);
  return `${GRAPHQL_ENDPOINT}?${q.join('&')}`;
}

export function variablesFor(op: NcaaOp, contestId: string): Record<string, unknown> {
  return op === 'gamecenter' ? { id: contestId, week: null, staticTestEnv: null } : { contestId, staticTestEnv: null };
}

function isPersistedQueryNotFound(body: { errors?: unknown }): boolean {
  const errs = Array.isArray(body.errors) ? body.errors as { message?: string; extensions?: { code?: string } }[] : [];
  return errs.some((e) => e?.message === 'PersistedQueryNotFound' || e?.extensions?.code === 'PERSISTED_QUERY_NOT_FOUND');
}

/**
 * Run one persisted operation. On `PersistedQueryNotFound` the store re-learns hashes from the
 * live game page once and the call is retried with the new hash.
 */
export async function graphqlGet<T = unknown>(
  fetcher: Fetcher,
  op: NcaaOp,
  variables: Record<string, unknown>,
  store: PersistedQueryStore,
  opts: { retry?: boolean } = {},
): Promise<T> {
  await store.init();
  const attempt = async (hash: string): Promise<{ data: T } | 'notfound'> => {
    const url = graphqlUrl(hash, variables, op === 'gamecenter' ? { meta: store.operationName(op) } : {});
    const res = await fetcher.get(url, { accept: 'application/json', skipCache: true });
    let body: { data?: T; errors?: unknown };
    try { body = JSON.parse(res.text) as { data?: T; errors?: unknown }; } catch { throw new NcaaGraphqlError(`non-JSON response (${res.status})`, url, []); }
    if (isPersistedQueryNotFound(body)) return 'notfound';
    if (Array.isArray(body.errors) && body.errors.length > 0 && body.data == null) {
      throw new NcaaGraphqlError(`GraphQL error for ${op}: ${JSON.stringify(body.errors).slice(0, 300)}`, url, body.errors);
    }
    if (body.data == null) throw new NcaaGraphqlError(`empty data for ${op}`, url, []);
    return { data: body.data };
  };
  const first = await attempt(store.get(op));
  if (first !== 'notfound') return first.data;
  if (opts.retry === false) throw new PersistedQueryNotFoundError(op, store.get(op));
  const staleHash = store.get(op);
  await store.refresh(fetcher);
  const second = await attempt(store.get(op));
  if (second === 'notfound') throw new PersistedQueryNotFoundError(op, staleHash);
  return second.data;
}

// ---------------------------------------------------------------------------------------------
// Transports

/** Raw NCAA documents, unwrapped exactly as henrygd/ncaa-api serves them. */
export interface NcaaGameTransport {
  readonly kind: 'graphql' | 'ncaa-api';
  boxscore(contestId: string): Promise<unknown>;
  playByPlay(contestId: string): Promise<unknown>;
  scoringSummary(contestId: string): Promise<unknown>;
  teamStats(contestId: string): Promise<unknown>;
  /** The `contests[0]` object (venue, linescores, records); null when absent. */
  gamecenter(contestId: string): Promise<unknown | null>;
}

type Wrapped = Record<string, unknown>;

/** Direct sdataprod.ncaa.com transport. */
export class GraphqlTransport implements NcaaGameTransport {
  readonly kind = 'graphql' as const;
  constructor(private fetcher: Fetcher, private store: PersistedQueryStore = new PersistedQueryStore()) {}
  private async run(op: NcaaOp, id: string): Promise<Wrapped> {
    return graphqlGet<Wrapped>(this.fetcher, op, variablesFor(op, id), this.store);
  }
  async boxscore(id: string) { return (await this.run('boxscore', id)).boxscore; }
  async playByPlay(id: string) { return (await this.run('pbp', id)).playbyplay; }
  async scoringSummary(id: string) { return (await this.run('scoring', id)).scoringSummary; }
  async teamStats(id: string) { return (await this.run('teamStats', id)).boxscore; }
  async gamecenter(id: string) {
    const d = await this.run('gamecenter', id);
    const contests = d.contests;
    return Array.isArray(contests) && contests.length > 0 ? contests[0] : null;
  }
}

/** Transport for a self-hosted henrygd/ncaa-api (`/game/{id}/boxscore`, …). */
export class NcaaApiTransport implements NcaaGameTransport {
  readonly kind = 'ncaa-api' as const;
  private base: string;
  constructor(private fetcher: Fetcher, baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, '');
  }
  private async json(path: string): Promise<unknown> {
    const res = await this.fetcher.get(`${this.base}${path}`, { accept: 'application/json', skipCache: true });
    return JSON.parse(res.text);
  }
  boxscore(id: string) { return this.json(`/game/${id}/boxscore`); }
  playByPlay(id: string) { return this.json(`/game/${id}/play-by-play`); }
  scoringSummary(id: string) { return this.json(`/game/${id}/scoring-summary`); }
  teamStats(id: string) { return this.json(`/game/${id}/team-stats`); }
  async gamecenter(id: string) {
    const d = (await this.json(`/game/${id}`)) as { contests?: unknown[] } | null;
    return Array.isArray(d?.contests) && d.contests.length > 0 ? d.contests[0] : null;
  }
}

export interface FetchGameDocsOptions {
  /** Skip the gamecenter call (venue / linescores / records). Default false. */
  skipGamecenter?: boolean;
  /** Treat scoring-summary / team-stats / gamecenter failures as missing docs instead of throwing. Default true. */
  tolerateOptional?: boolean;
}

/** Fetch the four game documents (+ gamecenter) through either transport. */
export async function fetchGameDocs(transport: NcaaGameTransport, contestId: string, opts: FetchGameDocsOptions = {}): Promise<NcaaGameDocs> {
  const tolerate = opts.tolerateOptional !== false;
  const optional = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); } catch (err) { if (tolerate) return null; throw err; }
  };
  const [boxscore, pbp, scoring, teamStats, gamecenter] = await Promise.all([
    transport.boxscore(contestId),
    optional(() => transport.playByPlay(contestId)),
    optional(() => transport.scoringSummary(contestId)),
    optional(() => transport.teamStats(contestId)),
    opts.skipGamecenter ? Promise.resolve(null) : optional(() => transport.gamecenter(contestId)),
  ]);
  return { boxscore, pbp, scoring, teamStats, gamecenter };
}

export async function fetchNcaaBoxScore(
  transport: NcaaGameTransport,
  contestId: string,
  gender: Gender,
  division: Division,
  date: string,
  opts: FetchGameDocsOptions = {},
): Promise<BoxScore> {
  const docs = await fetchGameDocs(transport, contestId, opts);
  return parseNcaaBoxScore(docs, contestId, gender, division, date);
}
