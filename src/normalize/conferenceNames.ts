// Conference names from data/conference-names.json, by NCAA.com conference slug. The scoreboard gives only the slug,
// and title-casing it showed "Metro" for the MAAC, "Uac " for the UAC and "Socon" (2026-10-26).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface ConferenceName { name: string; short: string }
let names: Map<string, ConferenceName> | null = null;

function load(): Map<string, ConferenceName> {
  if (names) return names;
  const here = dirname(fileURLToPath(import.meta.url));
  const file = [resolve(here, '../../data/conference-names.json'), resolve(process.cwd(), 'data/conference-names.json')].find((f) => { try { readFileSync(f); return true; } catch { return false; } });
  const raw = file ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  names = new Map(Object.entries(raw).filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object').map(([k, v]) => [k, v as ConferenceName]));
  return names;
}

/** The curated name of a conference, or null when its slug is not in the file yet. */
export function conferenceName(ncaaSeo: string): ConferenceName | null {
  return load().get(ncaaSeo) ?? null;
}

/** Every curated slug (tests). */
export function curatedConferenceSlugs(): string[] {
  return [...load().keys()];
}
