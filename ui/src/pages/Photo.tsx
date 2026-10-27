// /photo?player=<slug or id>: a college player (or their parent or guardian, or school staff) sends a photo for the
// player's page and Plaibook's social posts. Three consents, a credit line, the photo; the server re-encodes it
// without location data and keeps it private until we approve it (src/legal/photos.ts). Nothing is stored in the
// browser.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ImagePlus } from 'lucide-react';
import { api } from '../lib/api';
import { useEntityId } from '../lib/entity';
import { EmptyState, ErrorBox, PlayerAvatar, Skeleton } from '../components/primitives';

const RELATIONS = [
  { value: 'player', label: 'I am the player' },
  { value: 'parent or guardian', label: 'Parent or guardian' },
  { value: 'school staff', label: 'School or team staff' },
];
const MAX_MB = 10;
const label = 'mb-1 block text-xs font-medium text-chalk-300';

export default function Photo() {
  const [params] = useSearchParams();
  const key = params.get('player') ?? '';
  const entity = useEntityId('player', key);
  const q = useQuery({ queryKey: ['player', entity.id], queryFn: () => api<any>(`/api/players/${entity.id}`), enabled: !!entity.id });
  if (!key || entity.missing) return <EmptyState title="Which player?" body="Open the player's page on Plaibook Stats and choose Add a photo there." action={<Link className="btn-ghost btn-sm" to="/players">Find a player</Link>} />;
  if (entity.error) return <ErrorBox error={entity.error} />;
  if (q.isPending) return <div className="mx-auto max-w-2xl space-y-3"><Skeleton className="h-16" /><Skeleton className="h-96" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const p = q.data?.player;
  const school = q.data?.seasons?.[0]?.program;
  if (!p) return <EmptyState title="No such player" body="The link may be out of date." action={<Link className="btn-ghost btn-sm" to="/players">Find a player</Link>} />;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center gap-4">
        <PlayerAvatar src={p.photo_url ?? p.headshot_url} name={p.display_name} size={64} crest={school?.college_schools?.logo_svg_url} crestSeo={school?.school_seo} />
        <div>
          <h1 className="display text-2xl text-chalk-100 sm:text-3xl">Add a photo of {p.display_name}</h1>
          <p className="text-sm text-chalk-400">{school?.name ? `${school.name}. ` : ''}<Link to={`/players/${p.slug ?? p.id}`} className="text-pitch-300 hover:text-pitch-200">Back to the player page</Link></p>
        </div>
      </header>
      <div className="space-y-2 text-[15px] leading-relaxed text-chalk-300">
        <p>Send a photo of this player for their Plaibook Stats page and for Plaibook&apos;s posts about them (team of the week, stat leaders). We look at every photo before it is used, and credit it the way you ask.</p>
        <p>The player, a parent or guardian, or school or team staff can send one. We remove the location and camera details from the file. To have a photo taken down later, use the <Link to="/corrections" className="text-pitch-300 hover:text-pitch-200">corrections form</Link>.</p>
      </div>
      <PhotoForm playerId={p.id} name={p.display_name} />
    </div>
  );
}

function PhotoForm({ playerId, name }: { playerId: string; name: string }) {
  const [f, setF] = useState({ name: '', email: '', relation: '', credit: '', consent_owner: false, consent_age: false, consent_use: false, website: '' });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null;
    setError(null);
    if (next && next.size > MAX_MB * 1024 * 1024) { setError(`The photo is over ${MAX_MB} MB. Send a smaller one.`); setFile(null); setPreview(null); return; }
    setFile(next);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(next && /^image\/(jpeg|png|webp)$/.test(next.type) ? URL.createObjectURL(next) : null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError('Attach the photo.'); return; }
    setState('sending'); setError(null);
    const body = new FormData();
    body.set('player_id', playerId);
    for (const [k, v] of Object.entries(f)) body.set(k, typeof v === 'boolean' ? (v ? 'on' : '') : v);
    body.set('photo', file);
    try {
      // Not api(): the browser sets the multipart boundary itself.
      const res = await fetch('/api/photo-submissions', { method: 'POST', body });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error ?? 'Could not send. Please try again.');
      setState('sent');
    } catch (err) {
      setState('idle');
      setError(err instanceof Error ? err.message : 'Could not send. Please try again.');
    }
  }

  if (state === 'sent') return (
    <div role="status" className="frame flex items-start gap-3 bg-pitch-400/10 px-4 py-4 ring-1 ring-inset ring-pitch-400/30">
      <CheckCircle2 size={20} aria-hidden className="mt-0.5 shrink-0 text-pitch-300" />
      <div><p className="font-semibold text-chalk-100">Photo sent</p><p className="mt-1 text-sm text-chalk-300">Thank you. We will look at it within a few days. If we use it, it appears on {name}&apos;s page, credited to {f.credit}.</p></div>
    </div>
  );
  return (
    <form onSubmit={submit} className="frame space-y-4 px-4 py-4" aria-labelledby="photo-title">
      <h2 id="photo-title" className="text-base font-semibold text-chalk-100">Send the photo</h2>
      <div>
        <label htmlFor="photo-file" className={label}>Photo (JPEG, PNG, WebP or HEIC, up to {MAX_MB} MB)</label>
        <label htmlFor="photo-file" className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-field-600 px-3 py-3 text-sm text-chalk-300 hover:border-pitch-400">
          {preview ? <img src={preview} alt="" className="h-20 w-16 rounded object-cover" /> : <ImagePlus size={22} aria-hidden className="text-chalk-500" />}
          <span>{file ? file.name : 'Choose a photo. A clear picture of the player alone works best.'}</span>
        </label>
        <input id="photo-file" type="file" required accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" onChange={pick} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="photo-name" className={label}>Your name</label><input id="photo-name" required autoComplete="name" className="input w-full" value={f.name} onChange={set('name')} /></div>
        <div><label htmlFor="photo-email" className={label}>Your email (we only use it about this photo)</label><input id="photo-email" type="email" required autoComplete="email" className="input w-full" value={f.email} onChange={set('email')} /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="photo-rel" className={label}>You are</label><select id="photo-rel" required className="input w-full" value={f.relation} onChange={set('relation')}><option value="">Choose…</option>{RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
        <div><label htmlFor="photo-credit" className={label}>Credit the photo to</label><input id="photo-credit" required placeholder="The photographer, or the school" className="input w-full" value={f.credit} onChange={set('credit')} /></div>
      </div>
      <fieldset className="space-y-2 text-sm text-chalk-200">
        <legend className={label}>Please confirm</legend>
        <label className="flex items-start gap-2"><input type="checkbox" required className="mt-1" checked={f.consent_owner} onChange={set('consent_owner')} /><span>I took this photo, or the person who took it said we can use it.</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" required className="mt-1" checked={f.consent_age} onChange={set('consent_age')} /><span>The player is 18 or older, or I am their parent or guardian.</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" required className="mt-1" checked={f.consent_use} onChange={set('consent_use')} /><span>Plaibook may show this photo on Plaibook Stats and in Plaibook&apos;s social posts, credited as above, until I ask for it to be removed.</span></label>
      </fieldset>
      {/* A person never fills this in; bots do. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label htmlFor="photo-website">Website</label><input id="photo-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></div>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send photo'}</button>
        <p className="text-xs text-chalk-500">See <Link to="/privacy" className="text-pitch-300 hover:text-pitch-200">Privacy</Link> for how we keep what you send.</p>
      </div>
    </form>
  );
}
