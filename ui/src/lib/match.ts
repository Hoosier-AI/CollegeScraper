// Who scored, for the match header: goal events grouped by player per side, or box-score goal counts when a
// stat crew published no play-by-play.
export interface Scorer { name: string; minutes: string[]; player_id: string | null; count: number }

const minute = (clock: string | null | undefined, period: number | null | undefined): string | null => {
  const m = String(clock ?? '').match(/^(\d+):(\d\d)/);
  if (m) return `${Number(m[1]) + (Number(m[2]) > 0 ? 1 : 0)}′`;
  return (period ?? 0) > 2 ? 'OT' : null;
};
const isPerson = (s: string | null | undefined) => !!s && /[a-z]/i.test(s) && !/^(the )?(team|tm|bench)$/i.test(s.trim());

export function scorersFrom(events: any[], players: any[], ids: { home: string | null; away: string | null }, source: string | null): { home: Scorer[]; away: Scorer[] } {
  const out = { home: [] as Scorer[], away: [] as Scorer[] };
  const goals = events.filter((e) => e.event_type === 'goal' && (!source || e.source === source)).sort((a, b) => a.period - b.period || a.seq - b.seq);
  if (goals.length) {
    for (const e of goals) {
      const side = e.program_id === ids.home ? 'home' : e.program_id === ids.away ? 'away' : null;
      if (!side) continue;
      const raw = isPerson(e.player_name_raw) ? String(e.player_name_raw).trim() : null;
      const name = raw ? raw.replace(/^([^,]+),\s*(.+)$/, '$2 $1') : 'Unknown scorer';
      const list = out[side];
      let s = list.find((x) => x.name === name);
      if (!s) { s = { name, minutes: [], player_id: null, count: 0 }; list.push(s); }
      s.count += 1;
      const m = minute(e.clock, e.period); if (m) s.minutes.push(m);
    }
    return out;
  }
  // No play-by-play: the box score's goal column, without minutes.
  for (const p of players.filter((l) => (l.goals ?? 0) > 0 && (!source || l.source === source))) {
    const side = p.program_id === ids.home ? 'home' : p.program_id === ids.away ? 'away' : null;
    if (!side) continue;
    out[side].push({ name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(), minutes: [], player_id: p.player_id ?? null, count: p.goals });
  }
  return out;
}
