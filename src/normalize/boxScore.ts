import type { BoxScore } from '../model.js';

/**
 * The same box score with home and away exchanged: used when a school's page lists its own team first even though
 * NCAA.com (whose orientation we keep for linked games) has it as the visitor. Every orientation-dependent field
 * follows: the two team blocks, their isHome flags, and each event's side and running score.
 */
export function swapBoxSides(box: BoxScore): BoxScore {
  return {
    ...box,
    home: { ...box.away, isHome: true },
    away: { ...box.home, isHome: false },
    events: box.events.map((e) => ({ ...e, side: e.side === 'home' ? 'away' : e.side === 'away' ? 'home' : e.side, homeScore: e.awayScore, awayScore: e.homeScore })),
  };
}
