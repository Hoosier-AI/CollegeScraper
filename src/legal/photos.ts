// Player photos sent in on /photo (migration 206).
//   POST /api/photo-submissions        the public form (multipart): a photo of a college player with three consents.
//                                      5 an hour per visitor, a hidden honeypot field, the IP kept only as a salted
//                                      hash. The photo is re-encoded (sharp drops EXIF, so no GPS) to a JPEG of at most
//                                      1600 px and kept in a private bucket until a founder approves it.
//   GET  /api/console/photos           submissions by status (?status=pending|approved|declined|removed|all), each
//                                      with a 10-minute link to the picture; admin only (the /api/console prefix)
//   PUT  /api/console/photos/:id       approve (copied to the public bucket, set as the player's photo_url), decline,
//                                      or remove (files deleted, the player's photo cleared); admin only
import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { getDb } from '../db/client.js';
import { forgetMemo } from '../pro/memo.js';
import { ipHash } from './routes.js';

const PRIVATE = 'player-photo-submissions';
const PUBLIC = 'player-photos';
const RELATIONS = ['player', 'parent or guardian', 'school staff'] as const;
const STATUSES = ['pending', 'approved', 'declined', 'removed'] as const;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOURLY_LIMIT = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 1600;
const MIN_SIDE = 400;
const FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const yes = (v: unknown) => v === 'true' || v === 'on' || v === '1';

export interface PhotoFields { player_id?: string; name?: string; email?: string; relation?: string; credit?: string; consent_owner?: string; consent_age?: string; consent_use?: string; website?: string }
export type CheckedPhoto = { ok: true; row: { college_player_id: string; name: string; email: string; relation: string; photographer_credit: string } } | { ok: false; error: string; spam?: boolean };

/** Validates the form's fields (the picture is checked separately). `website` is the honeypot. */
export function checkPhotoFields(f: PhotoFields): CheckedPhoto {
  if (clip(f.website, 200)) return { ok: false, error: 'spam', spam: true };
  const player = clip(f.player_id, 40);
  if (!UUID.test(player)) return { ok: false, error: 'Choose the player this photo is of.' };
  const name = clip(f.name, 120);
  if (name.length < 2) return { ok: false, error: 'Enter your name.' };
  const email = clip(f.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: 'Enter an email address we can reply to.' };
  const relation = clip(f.relation, 30);
  if (!(RELATIONS as readonly string[]).includes(relation)) return { ok: false, error: 'Say who you are: the player, a parent or guardian, or school staff.' };
  const credit = clip(f.credit, 120);
  if (credit.length < 2) return { ok: false, error: 'Say how to credit the photo (the photographer, or the school).' };
  if (!yes(f.consent_owner) || !yes(f.consent_age) || !yes(f.consent_use)) return { ok: false, error: 'Tick all three boxes to send the photo.' };
  return { ok: true, row: { college_player_id: player, name, email, relation, photographer_credit: credit } };
}

/** The picture as we keep it: upright, at most 1600 px on its long side, JPEG, with no EXIF (location) data. */
export async function cleanPhoto(buf: Buffer): Promise<{ ok: true; jpeg: Buffer; width: number; height: number } | { ok: false; status: number; error: string }> {
  let meta;
  try { meta = await sharp(buf).metadata(); } catch { return { ok: false, status: 415, error: 'That file is not a photo we can read. Send a JPEG, PNG, WebP or HEIC.' }; }
  if (!meta.format || !FORMATS.has(meta.format)) return { ok: false, status: 415, error: 'Send a JPEG, PNG, WebP or HEIC photo.' };
  const { data, info } = await sharp(buf).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  if (Math.min(info.width, info.height) < MIN_SIDE) return { ok: false, status: 400, error: `The photo is too small: send one at least ${MIN_SIDE} pixels on its short side.` };
  return { ok: true, jpeg: data, width: info.width, height: info.height };
}

/** The approved photo's public address. */
const publicUrl = (path: string) => getDb().storage.from(PUBLIC).getPublicUrl(path).data.publicUrl;
const publicPath = (playerId: string, id: number) => `${playerId}/${id}.jpg`;

export function registerPhotoApi(app: FastifyInstance, o: { salt: string }) {
  void app.register(async (scoped) => {
    await scoped.register(multipart, { throwFileSizeLimit: false, limits: { fileSize: MAX_BYTES, files: 1, fields: 12, fieldSize: 2000 } });
    scoped.post('/api/photo-submissions', { bodyLimit: MAX_BYTES + 64 * 1024 }, async (req, reply) => {
      if (!req.isMultipart()) return reply.code(415).send({ error: 'Send the form with the photo attached.' });
      const fields: Record<string, string> = {};
      let file: Buffer | null = null;
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          file = await part.toBuffer();
          if (part.file.truncated) return reply.code(413).send({ error: 'The photo is over 10 MB. Send a smaller one.' });
        } else if (typeof part.value === 'string') fields[part.fieldname] = part.value;
      }
      const checked = checkPhotoFields(fields);
      // A honeypot hit gets the same answer as a real one, so a bot learns nothing.
      if (!checked.ok) return checked.spam ? reply.code(201).send({ ok: true }) : reply.code(400).send({ error: checked.error });
      if (!file?.length) return reply.code(400).send({ error: 'Attach the photo.' });
      const db = getDb();
      const hash = ipHash(req.ip, o.salt);
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await db.from('player_photo_submissions').select('id', { count: 'exact', head: true }).eq('ip_hash', hash).gte('created_at', since);
      if ((count ?? 0) >= HOURLY_LIMIT) return reply.code(429).send({ error: 'Too many photos from here in the last hour. Please try again later.' });
      const { data: player } = await db.from('college_players').select('id,suppress').eq('id', checked.row.college_player_id).maybeSingle();
      if (!player || player.suppress) return reply.code(400).send({ error: 'We could not find that player.' });
      const photo = await cleanPhoto(file);
      if (!photo.ok) return reply.code(photo.status).send({ error: photo.error });
      const path = `${player.id}/${randomUUID()}.jpg`;
      const up = await db.storage.from(PRIVATE).upload(path, photo.jpeg, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw new Error(`photo upload: ${up.error.message}`);
      const { error } = await db.from('player_photo_submissions').insert({ ...checked.row, storage_path: path, width: photo.width, height: photo.height, consent_owner: true, consent_age: true, consent_use: true, ip_hash: hash, user_agent: clip(req.headers['user-agent'], 300) || null });
      if (error) {
        await db.storage.from(PRIVATE).remove([path]);
        throw new Error(`photo insert: ${error.message}`);
      }
      return reply.code(201).send({ ok: true });
    });
  });

  app.get<{ Querystring: { status?: string } }>('/api/console/photos', async (req) => {
    const db = getDb();
    let q = db.from('player_photo_submissions').select('id,college_player_id,storage_path,width,height,name,email,relation,photographer_credit,status,note,created_at,reviewed_at,college_players(display_name,slug,photo_url)').order('created_at', { ascending: false }).limit(200);
    if (req.query.status !== 'all') q = q.eq('status', (STATUSES as readonly string[]).includes(req.query.status ?? '') ? req.query.status! : 'pending');
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const kept = rows.filter((r: any) => r.status === 'pending' || r.status === 'approved');
    const signed = kept.length ? (await db.storage.from(PRIVATE).createSignedUrls(kept.map((r: any) => r.storage_path), 600)).data ?? [] : [];
    const link = new Map(signed.map((s) => [s.path, s.signedUrl]));
    const { count } = await db.from('player_photo_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    return {
      pending: count ?? 0,
      rows: rows.map((r: any) => ({
        id: r.id, player: { id: r.college_player_id, name: r.college_players?.display_name ?? null, slug: r.college_players?.slug ?? null },
        image: link.get(r.storage_path) ?? null, width: r.width, height: r.height, name: r.name, email: r.email, relation: r.relation, credit: r.photographer_credit,
        status: r.status, note: r.note, created_at: r.created_at, reviewed_at: r.reviewed_at,
        live: r.status === 'approved' && r.college_players?.photo_url === publicUrl(publicPath(r.college_player_id, r.id)),
      })),
    };
  });

  app.put<{ Params: { id: string }; Body: { status?: string; note?: string } }>('/api/console/photos/:id', async (req, reply) => {
    const id = Number(req.params.id), status = req.body?.status ?? '';
    if (!Number.isInteger(id) || !['approved', 'declined', 'removed'].includes(status)) return reply.code(400).send({ error: 'bad request' });
    const db = getDb();
    const { data: row, error } = await db.from('player_photo_submissions').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return reply.code(404).send({ error: 'not found' });
    const dest = publicPath(row.college_player_id, row.id);
    if (status === 'approved') {
      if (row.status === 'declined' || row.status === 'removed') return reply.code(409).send({ error: 'That photo was deleted; ask for it again.' });
      const file = await db.storage.from(PRIVATE).download(row.storage_path);
      if (file.error || !file.data) throw new Error(`photo download: ${file.error?.message ?? 'missing'}`);
      const up = await db.storage.from(PUBLIC).upload(dest, Buffer.from(await file.data.arrayBuffer()), { contentType: 'image/jpeg', upsert: true, cacheControl: '86400' });
      if (up.error) throw new Error(`photo publish: ${up.error.message}`);
      // One photo per player: an earlier approved one is taken down.
      const { data: earlier } = await db.from('player_photo_submissions').select('id,storage_path').eq('college_player_id', row.college_player_id).eq('status', 'approved').neq('id', row.id);
      for (const e of earlier ?? []) {
        await db.storage.from(PUBLIC).remove([publicPath(row.college_player_id, e.id)]);
        await db.storage.from(PRIVATE).remove([e.storage_path]);
        await db.from('player_photo_submissions').update({ status: 'removed', note: 'Replaced by a newer photo', reviewed_at: new Date().toISOString() }).eq('id', e.id);
      }
      const set = await db.from('college_players').update({ photo_url: publicUrl(dest), photo_credit: row.photographer_credit }).eq('id', row.college_player_id);
      if (set.error) throw new Error(set.error.message);
    } else {
      // Declined or removed: the files go now, the row after 30 days (ops-retention).
      await db.storage.from(PUBLIC).remove([dest]);
      await db.storage.from(PRIVATE).remove([row.storage_path]);
      const { data: p } = await db.from('college_players').select('photo_url').eq('id', row.college_player_id).maybeSingle();
      if (p?.photo_url === publicUrl(dest)) await db.from('college_players').update({ photo_url: null, photo_credit: null }).eq('id', row.college_player_id);
    }
    const done = await db.from('player_photo_submissions').update({ status, note: clip(req.body?.note, 1000) || null, reviewed_at: new Date().toISOString() }).eq('id', id);
    if (done.error) throw new Error(done.error.message);
    // The team of the week and the leaders carry the photo: their next read loads afresh.
    forgetMemo('ctotw:');
    forgetMemo('college:leaders');
    return { ok: true };
  });
}
