// The built single-page app shell (ui/dist/index.html) with per-page <head> tags and the #ssr summary injected
// at the marker comments. The shell's generic title/description/Open Graph tags are removed so a page never
// carries two of them.
import { readFileSync, statSync } from 'node:fs';

export const HEAD_MARKER = '<!--ssr-head-->';
export const BODY_MARKER = '<!--ssr-body-->';

/** Used when the UI has not been built (tests, API-only runs): still a valid page with both markers. */
export const MINIMAL_SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Plaibook Stats</title>
    ${HEAD_MARKER}
  </head>
  <body>
    <div id="root"></div>
    ${BODY_MARKER}
  </body>
</html>
`;

// Tags a page replaces. og:site_name, twitter:card, icons and fonts stay.
const REPLACED = [
  /<title>[\s\S]*?<\/title>\s*/i,
  /<meta\s+name="description"[^>]*>\s*/gi,
  /<meta\s+name="robots"[^>]*>\s*/gi,
  /<link\s+rel="canonical"[^>]*>\s*/gi,
  /<meta\s+property="og:(?:type|title|description|url|image)"[^>]*>\s*/gi,
  /<meta\s+name="twitter:(?:title|description|image)"[^>]*>\s*/gi,
];

export function injectPage(shell: string, head: string, body: string): string {
  let html = shell;
  for (const re of REPLACED) html = html.replace(re, '');
  html = html.includes(HEAD_MARKER) ? html.replace(HEAD_MARKER, head) : html.replace(/<\/head>/i, `${head}\n</head>`);
  html = html.includes(BODY_MARKER) ? html.replace(BODY_MARKER, body) : html.replace(/(<div id="root"><\/div>)/i, `$1\n${body}`);
  return html;
}

/** The shell as served to the single-page app's own routes: markers stripped, nothing else changed. */
export const plainShell = (shell: string): string => shell.replace(HEAD_MARKER, '').replace(BODY_MARKER, '');

export interface Template {
  /** The unmodified shell (SPA routes the server does not render). */
  shell(): string;
  render(head: string, body: string): string;
}

export function stringTemplate(html: string): Template {
  return { shell: () => plainShell(html), render: (head, body) => injectPage(html, head, body) };
}

/**
 * ui/dist/index.html, read once and re-read only when the file changes (checked at most every 10 s), so a UI
 * rebuild on a running dev server does not serve stale asset hashes.
 */
export function fileTemplate(path: string, fallback = MINIMAL_SHELL): Template {
  let html = fallback; let mtime = -1; let checkedAt = 0;
  const load = () => {
    const now = Date.now();
    if (now - checkedAt < 10_000 && mtime !== -1) return html;
    checkedAt = now;
    try {
      const m = statSync(path).mtimeMs;
      if (m !== mtime) { html = readFileSync(path, 'utf8'); mtime = m; }
    } catch { /* keep what we have */ }
    return html;
  };
  load();
  return { shell: () => plainShell(load()), render: (head, body) => injectPage(load(), head, body) };
}
