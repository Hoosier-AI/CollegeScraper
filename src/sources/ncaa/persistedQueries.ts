// Persisted-query (APQ) hashes for NCAA.com's GraphQL gateway (sdataprod.ncaa.com).
//
// The game page https://www.ncaa.com/game/{contestId} embeds an inline JSON map of
//   "NCAA_<OperationName>":"<sha256 hex>"   (e.g. "NCAA_GetGamecenterBoxscoreSoccerById_web":"c907…")
// plus a few un-prefixed entries ("GetGamecenterGameById_web":"26d1…"). Those are the hashes the
// site itself sends. DEFAULT_HASHES below were read from that page and each was verified live
// against contest 6310566 on 2026-09-11; henrygd/ncaa-api (src/codes.ts) carries the same soccer /
// generic-pbp values. `refresh()` re-extracts them from the live page (and, failing that, from the
// page's script bundles) so a silent hash rotation only costs one extra round-trip.
import type { Fetcher } from '../../model.js';

export type NcaaOp = 'gamecenter' | 'boxscore' | 'pbp' | 'scoring' | 'teamStats' | 'scoreboard';

export const OPERATION_NAMES: Record<NcaaOp, string> = {
  gamecenter: 'GetGamecenterGameById_web',
  boxscore: 'GetGamecenterBoxscoreSoccerById_web',
  pbp: 'GetGamecenterPbpGenericById_web',
  scoring: 'GetGamecenterScoringSummaryById_web',
  teamStats: 'GetGamecenterTeamStatsSoccerById_web',
  // Operation name for the contests-by-date scoreboard query is not visible in the game page bundles;
  // the hash below is the one ncaa.com's scoreboard uses (verified live 2026-09-12).
  scoreboard: 'GetContestsByDate_web',
};

export const DEFAULT_HASHES: Record<NcaaOp, string> = {
  // henrygd's older 93a02c7193c89d85bcdda8c1784925d9b64657f73ef584382e2297af555acd4b also still resolves.
  gamecenter: '26d14df5714c5cd454c9032a1f8ebb1b1dc35173065ab858709b0fa84dd07b5f',
  boxscore: 'c9070c4e5a76468a4025896df89f8a7b22be8275c54a22ff79619cbb27d63d7d',
  pbp: '57f922d56d60d88326b62202b3d88e8cd3cfb6687931bc0b5b3dfab089b84faa',
  // henrygd's older 7f86673d4875cd18102b7fa598e2bc5da3f49d05a1c15b1add0e2367ee890198 also still resolves.
  scoring: 'fcd5729c72b0f72a4f659bf07e7b1da0fdce8f41ad286b0ddfe830adc7a45ca3',
  teamStats: 'd3009ee734557a3af9b80a1fd0326575799094e8046a4188c6aebea7072ea7bf',
  scoreboard: '7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c',
};

/** Contest whose page is fetched to re-learn hashes; any real game page works. */
export const DEFAULT_REFRESH_CONTEST_ID = '6310566';

const HEX64 = '[0-9a-fA-F]{64}';
const OPNAME = '[A-Za-z][A-Za-z0-9]*_(?:web|ncaa)';

/**
 * Pull every `<operationName> ↔ <sha256>` pair out of a page or JS bundle. Handles both
 * orderings: `"NCAA_Op_web":"hash"` / `Op_web:"hash"` and
 * `sha256Hash":"hash"…operationName":"Op_web"` (or `…Op_web` within ~200 chars of the hash).
 * Keys are operation names with any `NCAA_` prefix stripped.
 */
export function extractPersistedHashes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (name: string, hash: string) => {
    const key = name.replace(/^NCAA_/, '');
    if (!out[key]) out[key] = hash.toLowerCase();
  };
  // name first: "NCAA_GetX_web":"<hash>"  |  GetX_web:"<hash>"  |  GetX_web = '<hash>'
  const nameFirst = new RegExp(`["']?((?:NCAA_)?${OPNAME})["']?\\s*[:=]\\s*["'](${HEX64})["']`, 'g');
  for (const m of text.matchAll(nameFirst)) put(m[1]!, m[2]!);
  // hash first: sha256Hash":"<hash>" … operationName":"GetX_web"  (Apollo-style link config / URLs)
  const hashFirst = new RegExp(`sha256Hash(?:%22|"|')?(?:%3A|:)?(?:%22|"|')?(${HEX64})[\\s\\S]{0,200}?(?:operationName|queryName|meta)(?:%22|"|')?(?:%3A|:|=)(?:%22|"|')?((?:NCAA_)?${OPNAME})`, 'g');
  for (const m of text.matchAll(hashFirst)) put(m[2]!, m[1]!);
  return out;
}

/** Pluggable persistence for the learned hash map (DB implementation lives elsewhere). */
export interface PersistedQueryPersistence {
  load(): Promise<Partial<Record<NcaaOp, string>> | null>;
  save(hashes: Record<NcaaOp, string>): Promise<void>;
}

export class MemoryPersistedQueryPersistence implements PersistedQueryPersistence {
  constructor(private stored: Partial<Record<NcaaOp, string>> | null = null) {}
  async load() { return this.stored; }
  async save(hashes: Record<NcaaOp, string>) { this.stored = { ...hashes }; }
}

export interface RefreshResult {
  /** Ops whose hash changed. */
  updated: NcaaOp[];
  /** Every operation name → hash pair seen on the page/bundles. */
  found: Record<string, string>;
  /** URLs that were fetched. */
  fetched: string[];
}

export class PersistedQueryStore {
  private hashes: Record<NcaaOp, string>;
  private loaded = false;

  constructor(
    private persistence: PersistedQueryPersistence = new MemoryPersistedQueryPersistence(),
    defaults: Record<NcaaOp, string> = DEFAULT_HASHES,
    private opts: { refreshContestId?: string; maxBundles?: number } = {},
  ) {
    this.hashes = { ...defaults };
  }

  /** Overlay persisted hashes onto the defaults (idempotent). */
  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const stored = await this.persistence.load();
    if (stored) for (const [op, hash] of Object.entries(stored)) if (hash && op in this.hashes) this.hashes[op as NcaaOp] = hash;
  }

  get(op: NcaaOp): string { return this.hashes[op]; }
  operationName(op: NcaaOp): string { return OPERATION_NAMES[op]; }
  all(): Record<NcaaOp, string> { return { ...this.hashes }; }

  set(op: NcaaOp, hash: string): void { this.hashes[op] = hash.toLowerCase(); }

  /** Apply a raw `operationName → hash` map (as returned by extractPersistedHashes). */
  applyFound(found: Record<string, string>): NcaaOp[] {
    const updated: NcaaOp[] = [];
    for (const op of Object.keys(OPERATION_NAMES) as NcaaOp[]) {
      const h = found[OPERATION_NAMES[op]];
      if (h && h !== this.hashes[op]) { this.hashes[op] = h; updated.push(op); }
    }
    return updated;
  }

  /**
   * Re-learn hashes from the live game page. The page HTML carries the map inline; if it does not,
   * the page's `<script src>` bundles (gamecenter/Next chunks first) are scanned too.
   */
  async refresh(fetcher: Fetcher, contestId = this.opts.refreshContestId ?? DEFAULT_REFRESH_CONTEST_ID): Promise<RefreshResult> {
    const pageUrl = `https://www.ncaa.com/game/${contestId}`;
    const fetched: string[] = [pageUrl];
    const page = await fetcher.get(pageUrl, { accept: 'text/html', skipCache: true });
    let found = extractPersistedHashes(page.text);
    const wanted = Object.values(OPERATION_NAMES);
    const complete = () => wanted.every((n) => found[n]);
    if (!complete()) {
      const max = this.opts.maxBundles ?? 12;
      for (const src of bundleUrls(page.text, pageUrl).slice(0, max)) {
        try {
          const js = await fetcher.get(src, { accept: 'application/javascript,*/*' });
          fetched.push(src);
          found = { ...extractPersistedHashes(js.text), ...found };
          if (complete()) break;
        } catch { /* a missing bundle is not fatal */ }
      }
    }
    const updated = this.applyFound(found);
    if (updated.length > 0) await this.persistence.save(this.all());
    return { updated, found, fetched };
  }
}

/** Absolute script URLs from a page, most-likely-relevant (gamecenter / Next.js chunks) first. */
export function bundleUrls(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)) {
    let u = m[1]!;
    if (u.startsWith('//')) u = `https:${u}`;
    else if (u.startsWith('/')) u = new URL(u, pageUrl).toString();
    else if (!/^https?:/i.test(u)) u = new URL(u, pageUrl).toString();
    if (!urls.includes(u)) urls.push(u);
  }
  const score = (u: string) => (/gamecenter|gc-game|_next\/static|chunks|graphql|sdata/i.test(u) ? 0 : /ncaa\.com/.test(u) ? 1 : 2);
  return urls.filter((u) => score(u) < 2).sort((a, b) => score(a) - score(b));
}
