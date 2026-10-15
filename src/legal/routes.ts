// Policy pages and the corrections / removal request form.
//   GET  /api/legal/:slug               the page text (src/legal/content.ts), for the app
//   POST /api/requests                  the public form on /corrections: 5 an hour per visitor, a hidden honeypot field,
//                                       the IP kept only as a salted hash (migration 192)
//   GET  /api/console/requests          open (or all) requests, admin only (the /api/console prefix is admin-gated)
//   PUT  /api/console/requests/:id      close a request with a note, admin only
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';
import { LEGAL, UPDATED, type LegalSlug } from './content.js';

const KINDS = ['correction', 'removal', 'privacy', 'copyright', 'other'] as const;
const STATUSES = ['open', 'done', 'declined', 'spam'] as const;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const HOURLY_LIMIT = 5;

export interface RequestInput { kind?: unknown; name?: unknown; email?: unknown; relation?: unknown; page_url?: unknown; details?: unknown; website?: unknown }
export type Checked = { ok: true; row: { kind: string; name: string | null; email: string; relation: string | null; page_url: string | null; details: string } } | { ok: false; error: string; spam?: boolean };

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** Validates a form submission. `website` is the hidden honeypot field: a person never fills it in. */
export function checkRequest(b: RequestInput): Checked {
  if (clip(b.website, 200)) return { ok: false, error: 'spam', spam: true };
  const kind = clip(b.kind, 20);
  if (!(KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'Choose what the request is about.' };
  const email = clip(b.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: 'Enter an email address we can reply to.' };
  const details = typeof b.details === 'string' ? b.details.trim().slice(0, 4000) : '';
  if (details.length < 10) return { ok: false, error: 'Tell us a little more (at least a sentence).' };
  const page = clip(b.page_url, 500);
  if (page && !/^https?:\/\/|^\//.test(page)) return { ok: false, error: 'The page should be a link to this site (or leave it empty).' };
  return { ok: true, row: { kind, name: clip(b.name, 120) || null, email, relation: clip(b.relation, 60) || null, page_url: page || null, details } };
}

/** The visitor's IP as a one-way code (for the hourly limit only). */
export const ipHash = (ip: string, salt: string) => createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32);

export function registerLegalApi(app: FastifyInstance, o: { salt: string }) {
  app.get<{ Params: { slug: string } }>('/api/legal/:slug', async (req, reply) => {
    const page = LEGAL[req.params.slug as LegalSlug];
    if (!page) return reply.code(404).send({ error: 'not found' });
    return reply.header('Cache-Control', 'public, max-age=3600').send({ ...page, updated: UPDATED });
  });

  app.post<{ Body: RequestInput }>('/api/requests', async (req, reply) => {
    const checked = checkRequest((req.body ?? {}) as RequestInput);
    // A honeypot hit gets the same answer as a real request, so a bot learns nothing.
    if (!checked.ok) return checked.spam ? reply.code(201).send({ ok: true }) : reply.code(400).send({ error: checked.error });
    const db = getDb();
    const hash = ipHash(req.ip, o.salt);
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from('stats_requests').select('id', { count: 'exact', head: true }).eq('ip_hash', hash).gte('created_at', since);
    if ((count ?? 0) >= HOURLY_LIMIT) return reply.code(429).send({ error: 'Too many requests from here in the last hour. Please try again later or email us.' });
    const { error } = await db.from('stats_requests').insert({ ...checked.row, ip_hash: hash, user_agent: clip(req.headers['user-agent'], 300) || null });
    if (error) throw new Error(`request insert: ${error.message}`);
    return reply.code(201).send({ ok: true });
  });

  app.get<{ Querystring: { status?: string } }>('/api/console/requests', async (req) => {
    let q = getDb().from('stats_requests').select('id,kind,name,email,relation,page_url,details,status,note,created_at,closed_at').order('created_at', { ascending: false }).limit(200);
    if (req.query.status !== 'all') q = q.eq('status', (STATUSES as readonly string[]).includes(req.query.status ?? '') ? req.query.status! : 'open');
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const { count } = await getDb().from('stats_requests').select('id', { count: 'exact', head: true }).eq('status', 'open');
    return { open: count ?? 0, rows: data ?? [] };
  });

  app.put<{ Params: { id: string }; Body: { status?: string; note?: string } }>('/api/console/requests/:id', async (req, reply) => {
    const id = Number(req.params.id), status = req.body?.status ?? '';
    if (!Number.isInteger(id) || !(STATUSES as readonly string[]).includes(status)) return reply.code(400).send({ error: 'bad request' });
    const { error } = await getDb().from('stats_requests').update({ status, note: clip(req.body?.note, 1000) || null, closed_at: status === 'open' ? null : new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
}
