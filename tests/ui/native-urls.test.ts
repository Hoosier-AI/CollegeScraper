// The phone app's bundle is served from capacitor://localhost and reads the server at https://www.plaibook.live.
// A server path written straight into fetch() or sendBeacon() works on the website and fails in the app, and
// window.location's host or origin is "localhost" there. Both go through the seams instead:
//   ui/src/lib/apiBase.ts       apiUrl('/api/...')            (network calls, /card and /og pictures)
//   ui/src/lib/publicOrigin.ts  publicUrl(), PUBLIC_HOST      (links that leave the page)
// ui/src/lab is a design sandbox that is never in the app's build, so it is not scanned.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../ui/src');
const SKIP_DIR = resolve(ROOT, 'lab');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (p !== SKIP_DIR) out.push(...files(p)); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SOURCES = files(ROOT).map((p) => ({ rel: relative(ROOT, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }));

/** file:line of every match, comment-only lines left out. */
function hits(re: RegExp, skip: (rel: string, line: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const { rel, text } of SOURCES) {
    text.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (re.test(line) && !skip(rel, line)) out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  return out;
}

// fetch('/…'), fetch(`/…`), navigator.sendBeacon?.("/…"): a string or template literal starting with '/'.
const RAW_CALL = /\b(fetch|sendBeacon)\s*(\?\.)?\(\s*['"`]\//;
// window.location.host, window.location.hostname, window.location.origin, location.origin and the like.
const RAW_ORIGIN = /\blocation\s*(\?\.|\.)\s*(host|hostname|origin)\b/;

// Where reading the page's own origin is right:
const ORIGIN_ALLOWED: { file: string; has: string; why: string }[] = [
  // The seam itself: the website's public origin IS the page's origin.
  { file: 'lib/publicOrigin.ts', has: 'window.location', why: 'the seam' },
  // The corrections form prefills "which page" from document.referrer only when the visitor arrived from this same
  // site. That is a comparison with the document's own origin, not an address handed to anyone; in the app the
  // referrer is empty, so nothing is prefilled.
  { file: 'pages/Legal.tsx', has: 'document.referrer.startsWith(location.origin)', why: 'same-site referrer check' },
];

describe('the app build reaches the server through the seams', () => {
  it('scans the UI source', () => {
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(SOURCES.some((s) => s.rel.startsWith('lab/'))).toBe(false);
  });

  it('the patterns catch what they are meant to', () => {
    for (const bad of ["fetch('/api/x')", 'await fetch(`/card${p}.png`)', 'navigator.sendBeacon?.("/api/t", data)', "navigator.sendBeacon('/api/t', d)", 'fetch( "/og/x.png" )']) expect(RAW_CALL.test(bad), bad).toBe(true);
    for (const ok of ["fetch(apiUrl('/api/x'))", 'fetch(src)', "refetch('/x')", "q.refetch()", "fetch('https://example.com/x')"]) expect(RAW_CALL.test(ok), ok).toBe(false);
    for (const bad of ['window.location.host', 'window.location.origin', 'location.origin', 'window.location.hostname', 'window.location?.origin']) expect(RAW_ORIGIN.test(bad), bad).toBe(true);
    for (const ok of ['window.location.pathname', 'window.location.reload()', 'useLocation()', 'window.location.href']) expect(RAW_ORIGIN.test(ok), ok).toBe(false);
  });

  it('no fetch or sendBeacon is given a bare server path', () => {
    expect(hits(RAW_CALL)).toEqual([]);
  });

  it('nothing reads the page host or origin outside the seam', () => {
    const allowed = (rel: string, line: string) => ORIGIN_ALLOWED.some((a) => a.file === rel && line.includes(a.has));
    expect(hits(RAW_ORIGIN, allowed)).toEqual([]);
  });

  it('every allowlist entry is still needed', () => {
    for (const a of ORIGIN_ALLOWED) {
      const src = SOURCES.find((s) => s.rel === a.file);
      expect(src, a.file).toBeTruthy();
      expect(src!.text.split('\n').some((l) => RAW_ORIGIN.test(l) && l.includes(a.has)), `${a.file}: ${a.why}`).toBe(true);
    }
  });

  it('the api wrapper, the beacon and the stat card go through apiUrl', () => {
    const text = (rel: string) => SOURCES.find((s) => s.rel === rel)!.text;
    expect(text('lib/api.ts')).toContain('fetch(apiUrl(path)');
    expect(text('lib/track.ts')).toContain("apiUrl('/api/t')");
    expect(text('components/StatCardButton.tsx')).toContain('apiUrl(`/card${path}.png`)');
  });
});
