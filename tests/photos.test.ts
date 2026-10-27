import Fastify from 'fastify';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { checkPhotoFields, cleanPhoto, registerPhotoApi } from '../src/legal/photos.js';

const PLAYER = 'ee6d3435-7cf3-45fd-b79c-90f9122c8c75';
const GOOD = { player_id: PLAYER, name: 'Sam Smith', email: 'Sam@Example.com', relation: 'player', credit: 'Jane Doe', consent_owner: 'on', consent_age: 'on', consent_use: 'on' };

// A photo with EXIF location data, as a phone writes it.
const phonePhoto = (w = 900, h = 1200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#3a7' } })
    .withExif({ IFD0: { Make: 'Phone', Model: 'X' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 46/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '78/1 38/1 0/1' } })
    .jpeg()
    .toBuffer();

const multipartBody = (fields: Record<string, string>, file?: { name: string; type: string; data: Buffer }) => {
  const b = '----plaibooktest';
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="photo"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
};

describe('player photo form', () => {
  it('accepts a complete form and tidies it', () => {
    expect(checkPhotoFields({ ...GOOD, name: '  Sam   Smith ' })).toEqual({ ok: true, row: { college_player_id: PLAYER, name: 'Sam Smith', email: 'sam@example.com', relation: 'player', photographer_credit: 'Jane Doe' } });
  });
  it('needs all three consents, a player, who you are and a credit', () => {
    expect(checkPhotoFields({ ...GOOD, consent_age: '' })).toMatchObject({ ok: false, error: 'Tick all three boxes to send the photo.' });
    expect(checkPhotoFields({ ...GOOD, player_id: 'nope' })).toMatchObject({ ok: false });
    expect(checkPhotoFields({ ...GOOD, relation: 'fan' })).toMatchObject({ ok: false });
    expect(checkPhotoFields({ ...GOOD, credit: '' })).toMatchObject({ ok: false });
    expect(checkPhotoFields({ ...GOOD, email: 'x' })).toMatchObject({ ok: false });
  });
  it('quietly drops honeypot hits', () => {
    expect(checkPhotoFields({ ...GOOD, website: 'http://spam' })).toEqual({ ok: false, error: 'spam', spam: true });
  });
});

describe('the photo we keep', () => {
  it('drops EXIF (location) data and shrinks to 1600 px', async () => {
    const raw = await phonePhoto(2400, 3200);
    expect((await sharp(raw).metadata()).exif).toBeDefined();
    const r = await cleanPhoto(raw);
    if (!r.ok) throw new Error(r.error);
    const meta = await sharp(r.jpeg).metadata();
    expect(meta.exif).toBeUndefined();
    expect([meta.format, r.width, r.height]).toEqual(['jpeg', 1200, 1600]);
  });
  it('refuses what is not a photo, and photos too small to use', async () => {
    expect(await cleanPhoto(Buffer.from('%PDF-1.4 not a photo'))).toMatchObject({ ok: false, status: 415 });
    expect(await cleanPhoto(await phonePhoto(300, 300))).toMatchObject({ ok: false, status: 400 });
  });
});

describe('POST /api/photo-submissions', () => {
  const app = async () => {
    const a = Fastify();
    registerPhotoApi(a, { salt: 't' });
    await a.ready();
    return a;
  };
  it('refuses a form without the photo attached as a file upload', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/api/photo-submissions', payload: { ...GOOD } });
    expect(res.statusCode).toBe(415);
  });
  it('refuses missing consent before anything is stored', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/api/photo-submissions', ...multipartBody({ ...GOOD, consent_use: '' }, { name: 'a.jpg', type: 'image/jpeg', data: await phonePhoto() }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/three boxes/);
  });
  it('answers a honeypot hit like a real submission', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/api/photo-submissions', ...multipartBody({ ...GOOD, website: 'x' }, { name: 'a.jpg', type: 'image/jpeg', data: await phonePhoto() }) });
    expect(res.statusCode).toBe(201);
  });
  it('refuses a photo over 10 MB', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/api/photo-submissions', ...multipartBody({ ...GOOD }, { name: 'a.jpg', type: 'image/jpeg', data: Buffer.alloc(11 * 1024 * 1024, 1) }) });
    expect(res.statusCode).toBe(413);
  });
});
