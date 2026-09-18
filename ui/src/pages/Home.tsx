// The public front door. Everything here comes from the same /v1 routes anyone else can call.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../lib/api';
import { Logo } from '../components/Brand';
import { Spinner, Stat, TeamLogo } from '../components/ui';

interface Meta { seasons: number[]; currentSeason: number; conferences: { id: string }[]; last_completed_runs: Record<string, string>; limits?: { anon_per_min: number; key_per_min: number } }
interface Status { season: number; programs: number; games: number; finals: number }
interface ProgramHit { program_id: string; name: string; gender: string; logo_svg_url: string | null }
interface PlayerHit { player_id: string; display_name: string; program_name: string; season: number; pos: string | null }

export default function Home() {
  const meta = useQuery({ queryKey: ['v1meta'], queryFn: () => api<Meta>('/v1/meta') });
  const season = meta.data?.currentSeason;
  const status = useQuery({ queryKey: ['v1status', season], queryFn: () => api<Status>(`/v1/status${qs({ season })}`), enabled: !!season });
  const freshest = useMemo(() => {
    const times = Object.values(meta.data?.last_completed_runs ?? {}).filter(Boolean);
    return times.sort().at(-1) ?? null;
  }, [meta.data]);

  return (
    <div className="space-y-10 pb-4">
      <section className="flex flex-col items-center gap-5 pt-8 text-center sm:pt-14">
        <Logo size={72} withText={false} />
        <h1 className="max-w-3xl text-4xl font-black tracking-tight text-ink-100 sm:text-5xl">
          Plaibook <span className="text-teal-400">Stats</span>
        </h1>
        <p className="max-w-2xl text-base text-ink-300 sm:text-lg">
          Every NCAA soccer program — Division I, II and III, men's and women's. Rosters, box scores, season stats,
          conference standings and polls, cross-checked against each school's own numbers and NCAA.com.
        </p>
        <Search season={season} />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link className="btn-primary" to="/teams">Browse teams</Link>
          <Link className="btn-ghost" to="/standings">Standings</Link>
          <Link className="btn-ghost" to="/leaders">Leaders</Link>
          <Link className="btn-ghost" to="/docs">Use the API</Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Programs" value={status.data ? fmt.num(status.data.programs) : '–'} sub={season ? `${season} season` : undefined} />
        <Stat label="Games" value={status.data ? fmt.num(status.data.games) : '–'} sub={status.data ? `${fmt.num(status.data.finals)} final` : undefined} />
        <Stat label="Conferences" value={meta.data ? fmt.num(meta.data.conferences.length) : '–'} sub="D1 · D2 · D3" />
        <Stat label="Last updated" value={freshest ? fmt.ago(freshest) : '–'} sub="crawls run through the day" />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Card title="Two sources, both kept">
          Each program's own athletics site is the primary source — rosters with bios, schedules, cumulative season
          stats and full box scores. NCAA.com is stored alongside it as the complete-coverage cross-check, so every
          game has a second opinion.
        </Card>
        <Card title="Records you can check">
          Conference standings come from each conference's official table, and every row is compared with the record
          computed from our stored results. Where they disagree, the row says so instead of hiding it.
        </Card>
        <Card title="Not just a website">
          The pages here are drawn with the public API. The same routes answer your requests — with no key, no signup
          and no scraping — so you can build on the data instead of re-collecting it.
        </Card>
      </section>

      <section className="card flex flex-col gap-4 md:flex-row md:items-center">
        <div className="space-y-1">
          <h2 className="text-lg font-black text-ink-100">Start with one request</h2>
          <p className="text-sm text-ink-400">
            No key required{meta.data?.limits ? ` — ${meta.data.limits.anon_per_min} requests a minute, per IP` : ''}. A named key raises the limit when you need more.
          </p>
        </div>
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-xl border border-navy-700 bg-navy-950 p-3 text-[12px] leading-relaxed text-teal-300">curl "{typeof location === 'undefined' ? '' : location.origin}/v1/search?q=duke&amp;gender=m"</pre>
        <Link className="btn-primary shrink-0 justify-center" to="/docs">Read the docs</Link>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-2">
      <h2 className="text-base font-bold text-ink-100">{title}</h2>
      <p className="text-sm leading-relaxed text-ink-400">{children}</p>
    </div>
  );
}

function Search({ season }: { season?: number }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const nav = useNavigate();
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const hits = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<{ programs: ProgramHit[]; players: PlayerHit[] }>(`/v1/search${qs({ q: debounced, limit: 6 })}`),
    enabled: debounced.length >= 2,
  });
  const open = debounced.length >= 2;
  return (
    <div className="relative w-full max-w-xl text-left">
      <input
        className="input w-full py-2.5 text-base"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a team or a player — Duke, Stanford, a name…"
        aria-label="Search teams and players"
      />
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-96 overflow-auto rounded-xl border border-navy-700 bg-navy-900 p-1 shadow-xl shadow-black/40">
          {hits.isPending && <div className="px-3 py-2"><Spinner /></div>}
          {hits.data && !hits.data.programs.length && !hits.data.players.length && <div className="px-3 py-2 text-sm text-ink-500">Nothing matched “{debounced}”.</div>}
          {hits.data?.programs.map((p) => (
            <button key={p.program_id} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-navy-800"
              onClick={() => nav(`/teams/${p.program_id}${qs({ season, gender: p.gender })}`)}>
              <TeamLogo src={p.logo_svg_url} name={p.name} size={20} />
              <span className="text-ink-100">{p.name}</span>
              <span className="ml-auto text-xs text-ink-500">{p.gender === 'w' ? "Women's" : "Men's"} team</span>
            </button>
          ))}
          {hits.data?.players.map((p) => (
            <button key={p.player_id} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-navy-800"
              onClick={() => nav(`/players/${p.player_id}`)}>
              <span className="text-ink-100">{p.display_name}</span>
              <span className="text-xs text-ink-400">{p.program_name}</span>
              <span className="ml-auto text-xs text-ink-500">{[p.pos, p.season].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
