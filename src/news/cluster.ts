// The same story from several outlets: headlines about the same team or player within 48 hours whose words overlap
// enough. The first one we hold leads the group; the site shows it once with "reported by N outlets".
import { words } from './entities.js';

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was', 'be', 'after', 'over', 'vs', 'v', 'his', 'her', 'their', 'its', 'it', 'this', 'that', 'how', 'why', 'what', 'who', 'will', 'has', 'have', 'new', 'says', 'said']);

export function titleTokens(title: string): Set<string> {
  return new Set(words(title).filter((w) => !STOP.has(w) && w.length > 1));
}

export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n / Math.min(a.size, b.size);
}

export interface Recent { id: number; cluster_id: number | null; tokens: Set<string>; entities: Set<string>; at: number; publisher: string }

/** The cluster a new story joins (the lead story's id), or null for a new story. */
export function clusterFor(r: Omit<Recent, 'id' | 'cluster_id'>, recent: Recent[]): number | null {
  let best: Recent | null = null, bestScore = 0;
  for (const x of recent) {
    if (Math.abs(x.at - r.at) > 48 * 3600_000 || x.publisher === r.publisher) continue;
    const shared = [...r.entities].some((e) => x.entities.has(e));
    const score = overlap(r.tokens, x.tokens);
    if ((shared && score >= 0.6) || score >= 0.8) if (score > bestScore) { best = x; bestScore = score; }
  }
  return best ? (best.cluster_id ?? best.id) : null;
}
