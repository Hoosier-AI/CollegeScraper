// Apple Push Notification service sender: node:http2 and node:crypto only (no package).
//   - provider token: an ES256 JWT ({ alg, kid } . { iss: team id, iat }) signed with the .p8 key, reused for 50
//     minutes (Apple accepts one for up to an hour and refuses a new one more often than every 20 minutes);
//   - one HTTP/2 session per host (production and sandbox), opened on first use and again after an error or GOAWAY;
//   - the answer is one of four kinds so the caller knows what to do: ok, gone (the token is dead: clear it),
//     retry (Apple is busy or down), other (our request is wrong: log it).
// The hosts can be replaced (tests run it against a local http2 server).
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

export type ApnsEnv = 'production' | 'sandbox';
export interface ApnsConfig { keyP8: string; keyId: string; teamId: string; bundleId: string }
export interface ApnsNotification {
  title: string; body: string;
  /** The match key: the collapse id (a newer alert for the match replaces the older one) and the thread. */
  matchKey: string;
  /** The page to open, e.g. /pro/matches/<slug>. */
  to: string;
  /** Unix seconds after which Apple stops trying to deliver. */
  expiresAt: number;
  /** Quiet hours: delivered to the list without sound or lighting the screen. */
  passive?: boolean;
}
export type ApnsResult =
  | { kind: 'ok'; status: 200 }
  | { kind: 'gone'; status: number; reason: string }
  | { kind: 'retry'; status: number; reason: string }
  | { kind: 'other'; status: number; reason: string };

export const APNS_HOSTS: Record<ApnsEnv, string> = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };
const TOKEN_TTL_MS = 50 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/** The .p8 file's text. An env var often carries it with "\n" written out, or as bare base64 with no header. */
export function readP8(text: string): KeyObject {
  let pem = text.replace(/\\n/g, '\n').trim();
  if (!pem.includes('BEGIN')) pem = `-----BEGIN PRIVATE KEY-----\n${pem}\n-----END PRIVATE KEY-----`;
  return createPrivateKey(pem);
}

/** The provider JWT for `now` (ms). */
export function providerToken(cfg: Pick<ApnsConfig, 'keyId' | 'teamId'>, key: KeyObject, now = Date.now()): string {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) }));
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64url(sig)}`;
}

/** What Apple's answer means for us. */
export function classify(status: number, reason: string): ApnsResult {
  if (status === 200) return { kind: 'ok', status: 200 };
  if (status === 410 || (status === 400 && reason === 'BadDeviceToken')) return { kind: 'gone', status, reason };
  if (status === 429 || status >= 500 || status === 0 || reason === 'ExpiredProviderToken') return { kind: 'retry', status, reason };
  return { kind: 'other', status, reason };
}

/** The JSON Apple gets. `to` sits beside `aps` for the app to open the match. */
export function apnsBody(n: ApnsNotification): Record<string, unknown> {
  const aps: Record<string, unknown> = { alert: { title: n.title, body: n.body }, 'thread-id': n.matchKey };
  if (n.passive) aps['interruption-level'] = 'passive'; else aps.sound = 'default';
  return { aps, to: n.to };
}

/** At most 64 bytes (Apple's limit for apns-collapse-id), cut on a character boundary. */
export function collapseId(matchKey: string): string {
  let out = matchKey;
  while (Buffer.byteLength(out) > 64) out = out.slice(0, -1);
  return out;
}

export class ApnsClient {
  private key: KeyObject | null = null;
  private token: { value: string; at: number } | null = null;
  private sessions = new Map<string, ClientHttp2Session>();
  private hosts: Record<ApnsEnv, string>;
  constructor(private cfg: ApnsConfig, opts: { hosts?: Partial<Record<ApnsEnv, string>> } = {}) {
    this.hosts = { ...APNS_HOSTS, ...opts.hosts };
  }

  /** The cached provider token, made again after 50 minutes. */
  bearer(now = Date.now()): string {
    if (this.token && now - this.token.at < TOKEN_TTL_MS) return this.token.value;
    this.key ??= readP8(this.cfg.keyP8);
    this.token = { value: providerToken(this.cfg, this.key, now), at: now };
    return this.token.value;
  }

  private session(host: string): ClientHttp2Session {
    const open = this.sessions.get(host);
    if (open && !open.closed && !open.destroyed) return open;
    const s = connect(host);
    const drop = () => { if (this.sessions.get(host) === s) this.sessions.delete(host); };
    s.on('error', () => { drop(); s.destroy(); });
    s.on('goaway', () => { drop(); s.close(); });
    s.on('close', drop);
    // An idle session must not keep the process alive at shutdown.
    s.unref();
    this.sessions.set(host, s);
    return s;
  }

  /** One alert to one device. Never throws: a network failure is a 'retry' with status 0. */
  send(env: ApnsEnv, deviceToken: string, n: ApnsNotification): Promise<ApnsResult> {
    return new Promise<ApnsResult>((resolve) => {
      let done = false;
      const finish = (r: ApnsResult) => { if (!done) { done = true; resolve(r); } };
      let bearer: string;
      // A key that cannot be read is our mistake, not Apple being busy.
      try { bearer = this.bearer(); } catch (err) { finish({ kind: 'other', status: 0, reason: `provider key: ${err instanceof Error ? err.message : String(err)}` }); return; }
      try {
        const host = this.hosts[env];
        const session = this.session(host);
        const body = Buffer.from(JSON.stringify(apnsBody(n)));
        const req = session.request({
          [constants.HTTP2_HEADER_METHOD]: 'POST',
          [constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
          authorization: `bearer ${bearer}`,
          'apns-topic': this.cfg.bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-collapse-id': collapseId(n.matchKey),
          'apns-expiration': String(Math.floor(n.expiresAt)),
          'content-type': 'application/json',
          'content-length': String(body.length),
        });
        let status = 0; let text = '';
        req.setEncoding('utf8');
        req.setTimeout(REQUEST_TIMEOUT_MS, () => { req.close(constants.NGHTTP2_CANCEL); finish({ kind: 'retry', status: 0, reason: 'timeout' }); });
        req.on('response', (h) => { status = Number(h[constants.HTTP2_HEADER_STATUS]) || 0; });
        req.on('data', (c: string) => { if (text.length < 2000) text += c; });
        req.on('end', () => {
          let reason = '';
          try { reason = String((JSON.parse(text || '{}') as { reason?: unknown }).reason ?? ''); } catch { reason = ''; }
          // A token Apple calls expired is made again for the next request.
          if (reason === 'ExpiredProviderToken') this.token = null;
          finish(classify(status, reason));
        });
        req.on('error', (err) => finish({ kind: 'retry', status: 0, reason: err instanceof Error ? err.message : String(err) }));
        req.end(body);
      } catch (err) {
        finish({ kind: 'retry', status: 0, reason: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  close(): void {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}
