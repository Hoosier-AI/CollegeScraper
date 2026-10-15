// The policy and information pages (/about, /contact, /terms, /privacy, /sources, /data-use, /copyright, /corrections,
// /accessibility). One component: the text comes from the server (src/legal/content.ts via /api/legal/:slug), the same
// text the server renders for search engines. /corrections adds the request form.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { ErrorBox, Skeleton } from '../components/primitives';

type Block = string | { bullets: string[] } | { table: { head: string[]; rows: string[][] } };
interface Page { slug: string; path: string; title: string; description: string; intro: string; updated: string; sections: { id: string; heading: string; blocks: Block[] }[]; form?: 'request' }

/** Paragraph text with [text](url) links: our paths open in the app, everything else in a new tab. */
function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const [, label, href] = m;
    const cls = 'text-pitch-300 underline decoration-pitch-400/40 underline-offset-2 hover:text-pitch-200';
    parts.push(href!.startsWith('/') && !href!.startsWith('/v1/') && !href!.endsWith('.txt')
      ? <Link key={k++} to={href!} className={cls}>{label}</Link>
      : <a key={k++} href={href} className={cls} {...(href!.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{label}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function BlockView({ b }: { b: Block }) {
  if (typeof b === 'string') return <p><Inline text={b} /></p>;
  if ('bullets' in b) return <ul className="list-disc space-y-1.5 pl-5 marker:text-chalk-500">{b.bullets.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ul>;
  return (
    <div className="frame overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead><tr>{b.table.head.map((h) => <th key={h} scope="col" className="th whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{b.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`td align-top ${j === 0 ? 'font-medium text-chalk-100' : 'text-chalk-300'}`}><Inline text={c} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function Legal({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['legal', slug], queryFn: () => api<Page>(`/api/legal/${slug}`), staleTime: 3600_000 });
  // A link to a section (/privacy#athletes, /contact#who): scroll there once the text has loaded.
  const { hash } = useLocation();
  useEffect(() => { if (q.data && hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView(); }, [q.data, hash]);
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="mx-auto max-w-3xl space-y-3"><Skeleton className="h-10" /><Skeleton className="h-96" /></div>;
  const p = q.data!;
  const toc = p.sections.length >= 5;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="display text-3xl text-chalk-100 sm:text-4xl">{p.title}</h1>
        <p className="text-xs text-chalk-500">Last updated {p.updated}</p>
        <p className="text-[15px] leading-relaxed text-chalk-200"><Inline text={p.intro} /></p>
      </header>
      {p.form === 'request' && <RequestForm />}
      {toc && (
        <nav aria-label="On this page" className="frame px-4 py-3 text-sm">
          <p className="mb-1.5 text-xs font-medium text-chalk-400">On this page</p>
          <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">{p.sections.map((s, i) => <li key={s.id}><a href={`#${s.id}`} className="text-chalk-200 hover:text-pitch-300"><span className="mr-1.5 text-chalk-500 tnum">{i + 1}.</span>{s.heading}</a></li>)}</ol>
        </nav>
      )}
      {p.sections.map((s, i) => (
        <section key={s.id} id={s.id} className="scroll-mt-20 space-y-3 text-[15px] leading-relaxed text-chalk-300">
          <h2 className="text-lg font-semibold text-chalk-100">{toc && <span className="mr-2 text-chalk-500 tnum">{i + 1}.</span>}{s.heading}</h2>
          {s.blocks.map((b, j) => <BlockView key={j} b={b} />)}
        </section>
      ))}
      <p className="border-t border-field-700 pt-4 text-xs text-chalk-500">
        Plaibook Stats is operated by Plaibook Technologies, Inc. See also <Link to="/terms" className="text-pitch-300 hover:text-pitch-200">Terms</Link>, <Link to="/privacy" className="text-pitch-300 hover:text-pitch-200">Privacy</Link> and <Link to="/sources" className="text-pitch-300 hover:text-pitch-200">Data sources</Link>.
      </p>
    </div>
  );
}

const KINDS = [
  { value: 'correction', label: 'A wrong score, stat, name or position' },
  { value: 'removal', label: 'Remove a player\'s details or photo' },
  { value: 'privacy', label: 'My personal information (privacy)' },
  { value: 'copyright', label: 'Copyright' },
  { value: 'other', label: 'Something else' },
];
const RELATIONS = ['', 'I am the player', 'Parent or guardian', 'School or team staff', 'Fan or other'];

/** The corrections / removal form. Nothing is stored in the browser; the server limits it to 5 an hour. */
function RequestForm() {
  const [f, setF] = useState({ kind: 'correction', name: '', email: '', relation: '', page_url: typeof document !== 'undefined' && document.referrer.startsWith(location.origin) ? document.referrer : '', details: '', website: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending'); setError(null);
    try {
      await api('/api/requests', { method: 'POST', body: JSON.stringify(f) });
      setState('sent');
    } catch (err) {
      setState('idle');
      setError(err instanceof ApiError ? err.message : 'Could not send. Please try again, or email us.');
    }
  }
  if (state === 'sent') return (
    <div role="status" className="frame flex items-start gap-3 bg-pitch-400/10 px-4 py-4 ring-1 ring-inset ring-pitch-400/30">
      <CheckCircle2 size={20} aria-hidden className="mt-0.5 shrink-0 text-pitch-300" />
      <div><p className="font-semibold text-chalk-100">Request sent</p><p className="mt-1 text-sm text-chalk-300">Thank you. We will reply to {f.email} within 10 business days, sooner for anything about safety or a player under 18.</p></div>
    </div>
  );
  const label = 'mb-1 block text-xs font-medium text-chalk-300';
  return (
    <form onSubmit={submit} className="frame space-y-3 px-4 py-4" aria-labelledby="req-title">
      <h2 id="req-title" className="text-base font-semibold text-chalk-100">Send a request</h2>
      <div>
        <label htmlFor="req-kind" className={label}>What is it about?</label>
        <select id="req-kind" className="input w-full" value={f.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="req-email" className={label}>Your email (to reply)</label><input id="req-email" type="email" required autoComplete="email" className="input w-full" value={f.email} onChange={set('email')} /></div>
        <div><label htmlFor="req-name" className={label}>Your name (optional)</label><input id="req-name" autoComplete="name" className="input w-full" value={f.name} onChange={set('name')} /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="req-rel" className={label}>You are (optional)</label><select id="req-rel" className="input w-full" value={f.relation} onChange={set('relation')}>{RELATIONS.map((r) => <option key={r} value={r}>{r || 'Choose…'}</option>)}</select></div>
        <div><label htmlFor="req-url" className={label}>Page on this site (optional)</label><input id="req-url" type="url" inputMode="url" placeholder="https://www.plaibook.live/…" className="input w-full" value={f.page_url} onChange={set('page_url')} /></div>
      </div>
      <div>
        <label htmlFor="req-details" className={label}>Details</label>
        <textarea id="req-details" required minLength={10} rows={5} className="input h-auto min-h-[8rem] w-full py-2" placeholder="What is wrong, what it should be, and a link to an official source if you have one." value={f.details} onChange={set('details')} />
      </div>
      {/* A field people never see: bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label htmlFor="req-website">Website</label><input id="req-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></div>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send request'}</button>
        <p className="text-xs text-chalk-500">We use your email only to answer this request. See <Link to="/privacy" className="text-pitch-300 hover:text-pitch-200">Privacy</Link>.</p>
      </div>
    </form>
  );
}
