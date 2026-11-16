// A knockout bracket (src/college/bracket.ts): one column per round on wide screens, joined by elbow connectors, each
// game a link to its match; on phones one round at a time. Big brackets are shown a part at a time (the NCAA's 64 by
// quarter, then the College Cup). Empty positions are byes; a game not known yet shows who goes into it.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { fmt } from '../lib/api';
import { useHref } from '../lib/filters';
import { SegmentedControl, TeamLogo } from './primitives';

export interface BracketTeam { id: string | null; name: string | null; seo: string | null; logo: string | null; seed: number | null; score: number | null; winner: boolean }
export interface BracketGame { id: string | null; position: number; date: string | null; status: string | null; home: BracketTeam | null; away: BracketTeam | null; overtime: boolean; shootout: boolean; neutral: boolean; feeds: [number | null, number | null] }
export interface BracketRound { number: number; label: string; games: (BracketGame | null)[] }
export interface BracketData { rounds: BracketRound[]; champion: BracketTeam | null; complete: boolean; teams: number }

const H = 60, GAP = 12, PITCH = H + GAP, COL = 224, CGAP = 32;

function TeamLine({ t, decided, final, tag, tagTone }: { t: BracketTeam | null; decided: boolean; final: boolean; tag?: string | null; tagTone?: 'live' }) {
  const lost = decided && !!t && !t.winner;
  return (
    <span className={`flex h-7 min-w-0 items-center gap-1.5 px-2 text-sm ${lost ? 'text-chalk-400' : 'text-chalk-100'}`}>
      <span className="w-4 shrink-0 text-right text-2xs text-chalk-500 tnum">{t?.seed ?? ''}</span>
      {t ? <TeamLogo src={t.logo} seo={t.seo} name={t.name} size={16} /> : <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-field-600" aria-hidden />}
      <span className={`min-w-0 flex-1 truncate ${t?.winner ? 'font-semibold' : t ? 'font-medium' : 'text-chalk-500'}`}>{t?.name ?? 'TBD'}</span>
      {tag && <span className={`shrink-0 text-2xs ${tagTone === 'live' ? 'font-semibold text-win' : 'text-chalk-500'}`}>{tag}</span>}
      {final && <span className={`w-5 shrink-0 text-right tnum ${t?.winner ? 'font-semibold text-chalk-100' : ''}`}>{t?.score ?? ''}</span>}
    </span>
  );
}

function describe(g: BracketGame): string {
  const sides = `${g.home?.name ?? 'TBD'} ${g.status === 'final' ? `${g.home?.score ?? ''}-${g.away?.score ?? ''} ` : 'v '}${g.away?.name ?? 'TBD'}`;
  const how = g.status === 'final' ? (g.shootout ? ', won on penalties' : g.overtime ? ', after extra time' : '') : g.status === 'live' ? ', live' : '';
  return `${sides}${how}${g.date ? `, ${fmt.day(g.date)}` : ''}`;
}

/** One game: two lines (seed, logo, name, score). A link to the match where there is one. */
export function BracketCard({ g, feedsFrom, champion }: { g: BracketGame | null; feedsFrom?: string; champion?: boolean }) {
  const href = useHref();
  if (!g) {
    return (
      <div className="frame flex h-full flex-col justify-center border-dashed px-2 text-2xs text-chalk-500" aria-label={feedsFrom ?? 'To be decided'}>
        <span className="truncate">{feedsFrom ?? 'To be decided'}</span>
      </div>
    );
  }
  const final = g.status === 'final' || g.status === 'live';
  const decided = g.status === 'final' && !!(g.home?.winner || g.away?.winner);
  // Notes sit on a line inside the card: how a played game was won (on the winner's line), "Live", or the date to come.
  const how = g.status === 'final' ? (g.shootout ? 'PKs' : g.overtime ? 'OT' : null) : null;
  const homeTag = g.status === 'live' ? 'Live' : g.status !== 'final' && g.date ? fmt.day(g.date) : how && g.home?.winner ? how : null;
  const awayTag = how && g.away?.winner ? how : null;
  const body = (
    <>
      <TeamLine t={g.home} decided={decided} final={final} tag={homeTag} tagTone={g.status === 'live' ? 'live' : undefined} />
      <TeamLine t={g.away} decided={decided} final={final} tag={awayTag} />
    </>
  );
  const cls = `frame relative flex h-full flex-col justify-center transition-colors duration-150 ${champion ? 'border-pitch-400' : ''}`;
  return g.id
    ? <Link to={href(`/matches/${g.id}`)} className={`${cls} hover:bg-field-800`} aria-label={describe(g)} title={describe(g)}>{body}</Link>
    : <div className={cls} aria-label={describe(g)}>{body}</div>;
}

interface Slice { from: number; to: number; part: number; parts: number }

function columns(b: BracketData, s: Slice) {
  return b.rounds.filter((r) => r.number >= s.from && r.number <= s.to).map((r) => {
    const per = Math.max(1, r.games.length / s.parts), off = (s.part - 1) * per;
    return { round: r, games: r.games.slice(off, off + per) };
  });
}

/** Who goes into an unknown game: "Winner of A / B" from the games that feed it. */
function feedLabel(prev: (BracketGame | null)[] | undefined, i: number): string | undefined {
  if (!prev) return undefined;
  const name = (g: BracketGame | null | undefined) => (g ? (g.home?.winner ? g.home.name : g.away?.winner ? g.away.name : `${g.home?.name ?? 'TBD'}/${g.away?.name ?? 'TBD'}`) : null);
  const a = name(prev[2 * i]), b = name(prev[2 * i + 1]);
  return a || b ? `Winner of ${[a, b].filter(Boolean).join(' v ')}` : undefined;
}

function Tree({ b, s }: { b: BracketData; s: Slice }) {
  const cols = columns(b, s);
  const base = cols[0]?.games.length ?? 0;
  if (!base) return null;
  // A position shows a card when it holds a game or when a game feeds it (a later round not known yet).
  const shown: boolean[][] = [];
  cols.forEach((c, ci) => { shown[ci] = c.games.map((g, i) => !!g || (ci > 0 && (shown[ci - 1]![2 * i] || shown[ci - 1]![2 * i + 1]) === true)); });
  const height = base * PITCH;
  const width = cols.length * COL + (cols.length - 1) * CGAP + 2;
  const yc = (ci: number, i: number) => (i + 0.5) * PITCH * 2 ** ci;
  const lastCol = cols.length - 1;
  const isFinal = (ci: number) => cols[ci]!.round.number === b.rounds.at(-1)!.number;
  return (
    <div className="overflow-x-auto pb-2">
      <div className="relative" style={{ width, height: height + 28 }}>
        {cols.map((c, ci) => (
          <h3 key={c.round.number} className="absolute top-0 text-2xs font-semibold uppercase tracking-wide text-chalk-500" style={{ left: ci * (COL + CGAP), width: COL }}>{c.round.label}</h3>
        ))}
        <svg className="absolute left-0 top-7 text-field-600" width={width} height={height} aria-hidden>
          {cols.map((c, ci) => ci === 0 ? null : c.games.map((_, i) => shown[ci]![i] ? [2 * i, 2 * i + 1].map((k) => {
            if (!shown[ci - 1]![k]) return null;
            const x1 = (ci - 1) * (COL + CGAP) + COL, x2 = ci * (COL + CGAP), xm = x1 + CGAP / 2;
            const y1 = yc(ci - 1, k), y2 = yc(ci, i);
            return <path key={`${ci}-${i}-${k}`} d={`M${x1} ${y1}H${xm}V${y2}H${x2}`} fill="none" stroke="currentColor" strokeWidth={1.25} />;
          }) : null))}
        </svg>
        {cols.map((c, ci) => c.games.map((g, i) => shown[ci]![i] && (
          <div key={`${ci}-${i}`} className="absolute" style={{ left: ci * (COL + CGAP), top: 28 + yc(ci, i) - H / 2, width: COL, height: H }}>
            <BracketCard g={g} feedsFrom={g ? undefined : feedLabel(cols[ci - 1]?.games, i)} champion={ci === lastCol && isFinal(ci) && !!g && b.complete} />
          </div>
        )))}
      </div>
    </div>
  );
}

function RoundList({ b, s }: { b: BracketData; s: Slice }) {
  const cols = columns(b, s).filter((c) => c.games.some(Boolean));
  const [pick, setPick] = useState<number | null>(null);
  // Default: the latest round with a game played or to come.
  const current = [...cols].reverse().find((c) => c.games.some((g) => g && (g.status === 'final' || g.status === 'live'))) ?? cols[0];
  const sel = cols.find((c) => c.round.number === pick) ?? current;
  if (!sel) return null;
  return (
    <div className="space-y-3">
      <div className="-mx-4 overflow-x-auto px-4">
        <SegmentedControl size="sm" label="Round" value={String(sel.round.number)} onChange={(v) => setPick(Number(v))}
          options={cols.map((c) => ({ value: String(c.round.number), label: c.round.label }))} />
      </div>
      <ol className="space-y-2">
        {sel.games.map((g, i) => g && <li key={g.id ?? i} style={{ height: H }}><BracketCard g={g} /></li>)}
      </ol>
    </div>
  );
}

/** A whole bracket with its champion. `parts` > 1 splits the early rounds (`from`..`split`) into that many sections
 *  and adds a final section for the rounds after `split`. */
export function Bracket({ b, title, parts = 1, split, partLabel = 'Quarter' }: { b: BracketData; title?: string; parts?: number; split?: number; partLabel?: string }) {
  const last = b.rounds.at(-1)?.number ?? 1;
  const sections = useMemo(() => {
    if (parts <= 1 || !split) return [{ key: 'all', label: 'All', s: { from: 1, to: last, part: 1, parts: 1 } }];
    return [
      ...Array.from({ length: parts }, (_, i) => ({ key: `q${i + 1}`, label: `${partLabel} ${i + 1}`, s: { from: 1, to: split, part: i + 1, parts } })),
      { key: 'cup', label: 'College Cup', s: { from: split, to: last, part: 1, parts: 1 } },
    ];
  }, [parts, split, last, partLabel]);
  // Open on the section being played: the College Cup once the early rounds are done.
  const early = b.rounds.filter((r) => r.number < (split ?? last));
  const earlyDone = early.length > 0 && early.every((r) => r.games.every((g) => !g || g.status === 'final'));
  const [key, setKey] = useState<string>(sections.length > 1 && earlyDone ? 'cup' : sections[0]!.key);
  const sec = sections.find((x) => x.key === key) ?? sections[0]!;
  return (
    <section className="min-w-0 space-y-3" aria-label={title ?? 'Bracket'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {title && <h2 className="h-section">{title}</h2>}
        {b.champion && (
          <p className="inline-flex items-center gap-2 rounded-md border border-pitch-400/60 bg-field-900 px-3 py-1.5 text-sm">
            <Trophy size={15} className="text-pitch-300" aria-hidden />
            <span className="text-chalk-400">Champion</span>
            <TeamLogo src={b.champion.logo} seo={b.champion.seo} name={b.champion.name} size={18} />
            <span className="font-semibold text-chalk-100">{b.champion.name}</span>
          </p>
        )}
      </div>
      {sections.length > 1 && (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <SegmentedControl size="sm" label="Part of the bracket" value={sec.key} onChange={setKey} options={sections.map((x) => ({ value: x.key, label: x.label }))} />
        </div>
      )}
      <div className="hidden sm:block"><Tree b={b} s={sec.s} /></div>
      <div className="sm:hidden"><RoundList key={sec.key} b={b} s={sec.s} /></div>
    </section>
  );
}
