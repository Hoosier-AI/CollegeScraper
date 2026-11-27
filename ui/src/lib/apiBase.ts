// Where the server is. On the website VITE_API_BASE_URL is unset, so every call stays relative exactly as before.
// The app's bundle is served from capacitor://localhost, which has no /api, /card or /og: its build sets the base to
// https://www.plaibook.live (the www host: the bare domain redirects, and a WebView does not follow a redirect on a
// cross-origin request). The server's side of this is the allowlist in src/http/cors.ts.
//
// Always go through apiUrl('/api/...'): a literal fetch('/api/...') works on the web and fails in the app
// (tests/ui/native-urls.test.ts refuses one).
export const API_BASE: string = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/** The address of a server path ('/api/meta', '/card/players/x.png'). Anything not starting with '/' is returned as is. */
export const apiUrl = (path: string): string => (path.startsWith('/') ? `${API_BASE}${path}` : path);
