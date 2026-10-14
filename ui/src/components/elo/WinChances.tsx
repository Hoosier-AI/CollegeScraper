// Plaibook Elo's chances before kickoff for a college or pro club match (src/ui/elo.ts eloChances): each side's rating
// and rank, and the chances of each result. Same look as International's EloMatchCard.
import { Link } from 'react-router-dom';

export interface EloChances { home: { rating: number; rank: number | null }; away: { rating: number; rank: number | null }; home_win: number; draw: number; away_win: number; as_of: string }
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function WinChances({ elo, home, away, rankingsHref, drawLabel = 'Draw' }: { elo: EloChances; home: string; away: string; rankingsHref: string; drawLabel?: string }) {
  const side = (name: string, s: EloChances['home']) => <span className="text-chalk-400">{name}: <span className="text-chalk-200 tnum">{s.rating}</span>{s.rank ? `, No. ${s.rank}` : ''}</span>;
  return (
    <section className="frame space-y-3 p-3" aria-label="Plaibook Elo prediction">
      <h2 className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-chalk-100">
        Plaibook Elo prediction
        <Link to={rankingsHref} className="text-2xs font-normal text-pitch-300 hover:text-pitch-200">Rankings and how it works</Link>
      </h2>
      <div>
        <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={`Chances before kickoff: ${home} ${pct(elo.home_win)}, ${drawLabel.toLowerCase()} ${pct(elo.draw)}, ${away} ${pct(elo.away_win)}`}>
          <span className="bg-pitch-400" style={{ width: pct(elo.home_win) }} />
          <span className="bg-field-600" style={{ width: pct(elo.draw) }} />
          <span className="bg-note" style={{ width: pct(elo.away_win) }} />
        </div>
        <div className="mt-1 grid grid-cols-3 text-xs tnum">
          <span className="text-chalk-200">{home} <span className="font-semibold">{pct(elo.home_win)}</span></span>
          <span className="text-center text-chalk-400">{drawLabel} {pct(elo.draw)}</span>
          <span className="text-right text-chalk-200">{away} <span className="font-semibold">{pct(elo.away_win)}</span></span>
        </div>
      </div>
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">{side(home, elo.home)}{side(away, elo.away)}</p>
    </section>
  );
}
