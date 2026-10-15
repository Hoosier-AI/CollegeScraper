// Pure: a league or conference table from finished matches, as FotMob shows it: All, Home only, Away only, or Form
// (each team's last N matches). Points 3/1/0; order by points, goal difference, goals for, then name.
export type TableView = 'all' | 'home' | 'away' | 'form';
export interface ViewMatch { home: string; away: string; hs: number; as: number; date: string }
export interface ViewRow { team: string; p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number; form: string; rank: number }

export function tableView(matches: ViewMatch[], teams: string[], view: TableView, formN = 5): ViewRow[] {
  const inTable = new Set(teams);
  const sorted = [...matches].filter((m) => inTable.has(m.home) || inTable.has(m.away)).sort((a, b) => a.date.localeCompare(b.date));
  // Each team's own matches (for Form: the last N), from its side.
  const lines = new Map<string, { gf: number; ga: number }[]>(teams.map((t) => [t, []]));
  for (const m of sorted) {
    if (inTable.has(m.home) && view !== 'away') lines.get(m.home)!.push({ gf: m.hs, ga: m.as });
    if (inTable.has(m.away) && view !== 'home') lines.get(m.away)!.push({ gf: m.as, ga: m.hs });
  }
  const rows: ViewRow[] = teams.map((team) => {
    const ls = view === 'form' ? lines.get(team)!.slice(-formN) : lines.get(team)!;
    const r = { team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: '', rank: 0 };
    for (const x of ls) {
      r.p++; r.gf += x.gf; r.ga += x.ga;
      if (x.gf > x.ga) { r.w++; r.pts += 3; } else if (x.gf === x.ga) { r.d++; r.pts += 1; } else r.l++;
    }
    r.gd = r.gf - r.ga;
    r.form = lines.get(team)!.slice(-5).map((x) => (x.gf > x.ga ? 'W' : x.gf === x.ga ? 'D' : 'L')).join('');
    return r;
  });
  rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
