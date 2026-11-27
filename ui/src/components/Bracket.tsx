// A knockout bracket (src/college/bracket.ts), 2026-11 redesign. Wide screens: a big bracket is drawn two-sided, both
// halves meeting at the final in the middle, from the round that fits (earlier rounds are listed under it); a small one
// is a tree left to right. Phones: one round per page, its games paired the way they meet in the next round. Each game
// links to its match; pointing at a team lights its path. Empty positions are byes; a game not known yet shows who
// goes into it.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { fmt } from '../lib/api';
import { useHref } from '../lib/filters';
import { SegmentedControl, TeamLogo } from './primitives';

interface Hl { id: string | null; set: (id: string | null) => void }

export interface BracketTeam { id: string | null; name: string | null; seo: string | null; logo: string | null; seed: number | null; score: number | null; winner: boolean }
export interface BracketGame { id: string | null; position: number; date: string | null; status: string | null; home: BracketTeam | null; away: BracketTeam | null; overtime: boolean; shootout: boolean; neutral: boolean; feeds: [number | null, number | null];
  /** Pro cups and international tournaments (src/pro/bracket.ts): the match page, each leg of a tie (the score is then
   *  the aggregate, or games won in a `series`), and the shootout score. */
  to?: string | null; legs?: { home: number | null; away: number | null; date: string }[]; pens?: [number, number] | null; series?: boolean }
export interface BracketRound { number: number; label: string; games: (BracketGame | null)[] }
export interface BracketData { rounds: BracketRound[]; champion: BracketTeam | null; complete: boolean; teams: number }

const H = 56, GAP = 10, PITCH = H + GAP, CGAP = 22, HEAD = 26;
const has = (g: BracketGame | null | undefined, id: string | null) => !!id && !!g && (g.home?.id === id || g.away?.id === id);

function TeamLine({ t, decided, final, tag, tagTone, hl }: { t: BracketTeam | null; decided: boolean; final: boolean; tag?: string | null; tagTone?: 'live'; hl?: Hl }) {
  const lost = decided && !!t && !t.winner;
  const lit = !!t?.id && hl?.id === t.id;
  return (
    <span className={`flex h-6 min-w-0 items-center gap-1.5 px-2 text-[13px] ${lit ? 'text-pitch-300' : lost ? 'text-chalk-500' : 'text-chalk-100'}`}
      onMouseEnter={() => t?.id && hl?.set(t.id)} onMouseLeave={() => hl?.set(null)}>
      <span className="w-3.5 shrink-0 text-right text-[11px] text-chalk-500 tnum">{t?.seed ?? ''}</span>
      {t ? <TeamLogo src={t.logo} seo={t.seo} name={t.name} size={16} /> : <span className="h-4 w-4 shrink-0" aria-hidden />}
      <span className={`min-w-0 flex-1 truncate ${t?.winner ? 'font-semibold' : ''} ${t ? '' : 'text-chalk-500'}`}>{t?.name ?? 'To be decided'}</span>
      {tag && <span className={`shrink-0 text-[11px] ${tagTone === 'live' ? 'font-semibold text-live' : 'text-chalk-500'}`}>{tag}</span>}
      {final && <span className={`display w-4 shrink-0 text-right tnum ${t?.winner ? 'text-chalk-100' : ''}`}>{t?.score ?? ''}</span>}
    </span>
  );
}

function describe(g: BracketGame): string {
  const sides = `${g.home?.name ?? 'TBD'} ${g.status === 'final' ? `${g.home?.score ?? ''}-${g.away?.score ?? ''} ` : 'v '}${g.away?.name ?? 'TBD'}`;
  const multi = (g.legs?.length ?? 0) > 1;
  const how = g.status === 'final' ? (g.pens ? `, ${g.pens[0]}-${g.pens[1]} on penalties` : g.shootout ? ', won on penalties' : multi ? (g.series ? ', games won' : ', on aggregate') : g.overtime ? ', after extra time' : '') : g.status === 'live' ? ', live' : '';
  return `${sides}${how}${g.date ? `, ${fmt.day(g.date)}` : ''}`;
}

/** One game: two lines (seed, logo, name, score). A link to the match where there is one. */
export function BracketCard({ g, feedsFrom, champion, hl }: { g: BracketGame | null; feedsFrom?: string; champion?: boolean; hl?: Hl }) {
  const href = useHref();
  if (!g) {
    return (
      <div className="flex h-full flex-col justify-center rounded-md border border-dashed border-field-700 px-2 text-xs text-chalk-500" aria-label={feedsFrom ?? 'To be decided'}>
        <span className="truncate">{feedsFrom ?? 'To be decided'}</span>
      </div>
    );
  }
  const final = g.status === 'final' || g.status === 'live';
  const decided = g.status === 'final' && !!(g.home?.winner || g.away?.winner);
  // Notes sit on a line inside the card: how a played game was won (on the winner's line), "Live", or the date to come.
  const how = g.status === 'final' ? (g.pens ? `pens ${g.pens[0]}-${g.pens[1]}` : g.shootout ? 'pens' : (g.legs?.length ?? 0) > 1 ? (g.series ? 'series' : 'agg') : g.overtime ? 'OT' : null) : null;
  const homeTag = g.status === 'live' ? 'Live' : g.status !== 'final' && g.date ? fmt.day(g.date) : how && g.home?.winner ? how : null;
  const awayTag = how && g.away?.winner ? how : null;
  const body = (
    <>
      <TeamLine t={g.home} decided={decided} final={final} tag={homeTag} tagTone={g.status === 'live' ? 'live' : undefined} hl={hl} />
      <TeamLine t={g.away} decided={decided} final={final} tag={awayTag} hl={hl} />
    </>
  );
  const cls = `relative flex h-full flex-col justify-center rounded-md bg-field-900 transition-colors duration-150 ${champion ? 'ring-1 ring-pitch-400/70' : ''}`;
  return g.to || g.id
    ? <Link to={g.to ?? href(`/matches/${g.id}`)} className={`${cls} hover:bg-field-800`} aria-label={describe(g)} title={describe(g)}>{body}</Link>
    : <div className={cls} aria-label={describe(g)}>{body}</div>;
}

type Col = { round: BracketRound; games: (BracketGame | null)[] };

/** Who goes into an unknown game: "Winner of A / B" from the games that feed it. */
function feedLabel(prev: (BracketGame | null)[] | undefined, i: number): string | undefined {
  if (!prev) return undefined;
  const name = (g: BracketGame | null | undefined) => (g ? (g.home?.winner ? g.home.name : g.away?.winner ? g.away.name : `${g.home?.name ?? 'TBD'}/${g.away?.name ?? 'TBD'}`) : null);
  const a = name(prev[2 * i]), b = name(prev[2 * i + 1]);
  return a || b ? `Winner of ${[a, b].filter(Boolean).join(' v ')}` : undefined;
}

/** Columns of games joined by elbows. `mirror` draws right to left: the far half of a two-sided bracket. */
function Tree({ cols, colW, hl, mirror, champion }: { cols: Col[]; colW: number; hl: Hl; mirror?: boolean; champion?: boolean }) {
  const base = cols[0]?.games.length ?? 0;
  if (!base) return null;
  // A position shows a card when it holds a game or when a game feeds it (a later round not known yet).
  const shown: boolean[][] = [];
  cols.forEach((c, ci) => { shown[ci] = c.games.map((g, i) => !!g || (ci > 0 && (shown[ci - 1]![2 * i] || shown[ci - 1]![2 * i + 1]) === true)); });
  const height = base * PITCH, width = cols.length * colW + (cols.length - 1) * CGAP;
  const x = (ci: number) => (mirror ? cols.length - 1 - ci : ci) * (colW + CGAP);
  const yc = (ci: number, i: number) => (i + 0.5) * PITCH * 2 ** ci;
  return (
    <div className="relative shrink-0" style={{ width, height: height + HEAD }}>
      {cols.map((c, ci) => <h3 key={c.round.number} className={`absolute top-0 truncate text-xs font-semibold text-chalk-500 ${mirror ? 'text-right' : ''}`} style={{ left: x(ci), width: colW }}>{c.round.label}</h3>)}
      <svg className="absolute left-0" style={{ top: HEAD }} width={width} height={height} aria-hidden>
        {cols.map((c, ci) => ci === 0 ? null : c.games.map((g, i) => shown[ci]![i] ? [2 * i, 2 * i + 1].map((k) => {
          if (!shown[ci - 1]![k]) return null;
          const x1 = mirror ? x(ci - 1) : x(ci - 1) + colW, x2 = mirror ? x(ci) + colW : x(ci), xm = (x1 + x2) / 2;
          const on = has(cols[ci - 1]!.games[k], hl.id) && (has(g, hl.id) || !g);
          return <path key={`${ci}-${i}-${k}`} d={`M${x1} ${yc(ci - 1, k)}H${xm}V${yc(ci, i)}H${x2}`} fill="none" strokeWidth={on ? 1.75 : 1.25} className={on ? 'stroke-pitch-400' : 'stroke-field-600'} />;
        }) : null))}
      </svg>
      {cols.map((c, ci) => c.games.map((g, i) => shown[ci]![i] && (
        <div key={`${ci}-${i}`} className="absolute" style={{ left: x(ci), top: HEAD + yc(ci, i) - H / 2, width: colW, height: H }}>
          <BracketCard g={g} hl={hl} feedsFrom={g ? undefined : feedLabel(cols[ci - 1]?.games, i)} champion={champion && ci === cols.length - 1 && !!g} />
        </div>
      )))}
    </div>
  );
}

const half = (c: Col, right: boolean): Col => ({ round: c.round, games: right ? c.games.slice(c.games.length / 2) : c.games.slice(0, c.games.length / 2) });

/** Wide screens. Up to four first-column games: one tree. More: two halves meeting at the final, from the round with
 *  at most eight games; the rounds before it are listed underneath. */
function Wide({ b, hl }: { b: BracketData; hl: Hl }) {
  const cols: Col[] = b.rounds.map((r) => ({ round: r, games: r.games }));
  const last = cols.length - 1;
  if ((cols[0]?.games.length ?? 0) <= 4 || cols.length < 3) return <div className="overflow-x-auto pb-2"><Tree cols={cols} colW={208} hl={hl} champion={b.complete} /></div>;
  // The latest round that still has a game to play decides where the picture starts; never more than eight across.
  const firstFit = cols.findIndex((c) => c.games.length <= 8);
  const side = cols.slice(firstFit, last);
  const final = cols[last]!.games[0] ?? null;
  const earlier = cols.slice(0, firstFit).reverse();
  return (
    <div className="stack">
      <div className="overflow-x-auto pb-2">
        <div className="flex w-max items-center gap-3 lg:mx-auto">
          <Tree cols={side.map((c) => half(c, false))} colW={172} hl={hl} />
          <div className="grid w-44 shrink-0 justify-items-center gap-3 text-chalk-500">
            <Trophy size={28} strokeWidth={1.5} aria-hidden />
            {b.champion ? <span className="flex items-center gap-2 text-sm font-semibold text-chalk-100"><TeamLogo src={b.champion.logo} seo={b.champion.seo} name={b.champion.name} size={22} />{b.champion.name}</span> : <span className="text-xs">{cols[last]!.round.label}</span>}
            <div className="w-full" style={{ height: H }}><BracketCard g={final} hl={hl} feedsFrom={feedLabel(cols[last - 1]?.games, 0)} champion={b.complete} /></div>
          </div>
          <Tree cols={side.map((c) => half(c, true))} colW={172} hl={hl} mirror />
        </div>
      </div>
      {earlier.map((c) => c.games.some(Boolean) && (
        <section key={c.round.number} className="space-y-2">
          <h3 className="text-sm font-semibold text-chalk-100">{c.round.label}</h3>
          <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">{c.games.map((g, i) => g && <li key={g.id ?? i} style={{ height: H }}><BracketCard g={g} hl={hl} /></li>)}</ol>
        </section>
      ))}
    </div>
  );
}

/** Phones: one round per page; its games in the pairs that meet in the next round. */
function Narrow({ b, hl }: { b: BracketData; hl: Hl }) {
  const cols: Col[] = b.rounds.map((r) => ({ round: r, games: r.games })).filter((c) => c.games.some(Boolean) || c.round.number > 1);
  const [pick, setPick] = useState<number | null>(null);
  // Opens on the round being played: the first with a game still to finish.
  const current = cols.find((c) => c.games.some((g) => g && g.status !== 'final')) ?? cols.find((c) => !c.games.some(Boolean)) ?? cols.at(-1);
  const sel = cols.find((c) => c.round.number === pick) ?? current;
  if (!sel) return null;
  const idx = cols.indexOf(sel), next = cols[idx + 1], prev = b.rounds.find((r) => r.number === sel.round.number - 1)?.games;
  const there = (i: number) => !!(sel.games[i] || prev?.[2 * i] || prev?.[2 * i + 1]);
  const both = (pair: number[]) => pair.length === 2 && pair.every(there);
  const pairs = Array.from({ length: Math.ceil(sel.games.length / 2) }, (_, k) => [2 * k, 2 * k + 1].filter((i) => i < sel.games.length));
  return (
    <div className="space-y-3">
      <div className="bleed overflow-x-auto px-3.5 [scrollbar-width:none]">
        <SegmentedControl size="sm" label="Round" value={String(sel.round.number)} onChange={(v) => setPick(Number(v))} options={cols.map((c) => ({ value: String(c.round.number), label: c.round.label }))} />
      </div>
      <ol className="space-y-3">
        {pairs.map((pair, k) => (pair.some((i) => sel.games[i] || prev?.[2 * i] || prev?.[2 * i + 1]) ? (
          <li key={k} className="grid grid-cols-[minmax(0,1fr)_12px] gap-x-1.5">
            <div className="space-y-1.5">{pair.map((i) => (sel.games[i] || prev?.[2 * i] || prev?.[2 * i + 1] ? <div key={i} style={{ height: H }}><BracketCard g={sel.games[i] ?? null} hl={hl} feedsFrom={feedLabel(prev, i)} champion={!next && b.complete} /></div> : null))}</div>
            {next && both(pair) ? <div aria-hidden className="rounded-r border-y border-r border-field-600" style={{ margin: `${H / 2}px 0` }} /> : <span />}
            {next && both(pair) && <p className="col-span-2 pt-1 text-right text-[11px] text-chalk-500">Winners meet in the {next.round.label.toLowerCase()}</p>}
          </li>
        ) : null))}
      </ol>
    </div>
  );
}

/** A whole bracket with its champion. `parts`, `split` and `partLabel` are accepted for older callers; the bracket is
 *  no longer cut into parts. */
export function Bracket({ b, title }: { b: BracketData; title?: string; parts?: number; split?: number; partLabel?: string }) {
  const [id, setId] = useState<string | null>(null);
  const hl = useMemo<Hl>(() => ({ id, set: setId }), [id]);
  return (
    <section className="min-w-0 space-y-3" aria-label={title ?? 'Bracket'}>
      {(title || b.champion) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="h-section">{title}</h2>}
          {b.champion && (
            <p className="inline-flex items-center gap-2 text-sm sm:hidden">
              <Trophy size={15} className="text-pitch-300" aria-hidden /><span className="text-chalk-400">Champion</span>
              <TeamLogo src={b.champion.logo} seo={b.champion.seo} name={b.champion.name} size={18} /><span className="font-semibold text-chalk-100">{b.champion.name}</span>
            </p>
          )}
        </div>
      )}
      <div className="hidden sm:block"><Wide b={b} hl={hl} /></div>
      <div className="sm:hidden"><Narrow b={b} hl={hl} /></div>
    </section>
  );
}
