// "Stat card": the page's picture made to be posted (server: src/seo/statcard.ts, /card/<page path>.png). Opens a
// preview with Download, and Share on phones that can share files (Instagram, X, Messages take the image directly).
import { useEffect, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Share2, X } from 'lucide-react';

export function StatCardButton({ path, name }: { path: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [canShare, setCanShare] = useState(false);
  const blob = useRef<Blob | null>(null);
  const src = `/card${path}.png`;
  const file = `plaibook-${path.split('/').filter(Boolean).pop() ?? 'card'}.png`;
  useEffect(() => {
    if (!open) return;
    let live = true;
    setState('loading');
    fetch(src).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status))))).then((b) => {
      if (!live) return;
      blob.current = b;
      const f = new File([b], file, { type: 'image/png' });
      setCanShare(typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] }));
      setState('ready');
    }).catch(() => live && setState('failed'));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => { live = false; document.removeEventListener('keydown', onKey); };
  }, [open, src, file]);
  const share = async () => {
    if (!blob.current) return;
    try { await navigator.share({ files: [new File([blob.current], file, { type: 'image/png' })], title: name, text: `${name} on plaibook.live` }); } catch { /* closed */ }
  };
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog"><ImageIcon size={14} aria-hidden /> Stat card</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label={`Stat card: ${name}`} className="relative flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl border border-field-700 bg-field-900 shadow-2xl shadow-black/60 sm:rounded-2xl" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="flex items-center justify-between border-b border-field-700 px-4 py-3">
              <h2 className="h-section">Stat card</h2>
              <button type="button" className="btn-ghost btn-icon" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {state === 'loading' && <div className="skeleton aspect-[4/5] w-full rounded-lg" aria-busy="true" />}
              {state === 'failed' && <p className="py-10 text-center text-sm text-chalk-400">This card could not be drawn right now. Try again in a minute.</p>}
              {state === 'ready' && <img src={src} alt={`Stat card for ${name}`} className="mx-auto w-full rounded-lg border border-field-700" />}
            </div>
            <div className="flex gap-2 border-t border-field-700 px-4 py-3">
              <a href={src} download={file} className={`btn-ghost flex-1 ${state === 'ready' ? '' : 'pointer-events-none opacity-40'}`}><Download size={16} aria-hidden /> Download</a>
              {canShare && <button type="button" className="btn-primary flex-1" onClick={share}><Share2 size={16} aria-hidden /> Share</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
