// Human names for the API's stat keys. Pages show these; the key itself only appears in the API docs.
export interface StatDef { label: string; short: string; group: string; decimals?: number; pct?: boolean; lowerIsBetter?: boolean; help?: string }

const P = (label: string, short: string, group: string, extra: Partial<StatDef> = {}): StatDef => ({ label, short, group, ...extra });

export const PLAYER_STAT_DEFS: Record<string, StatDef> = {
  goals: P('Goals', 'G', 'Scoring'), assists: P('Assists', 'A', 'Scoring'), points: P('Points', 'PTS', 'Scoring', { help: '2 per goal, 1 per assist' }),
  gwg: P('Game-winning goals', 'GWG', 'Scoring'), hat_tricks: P('Hat tricks', 'HT', 'Scoring'), pk_goals: P('Penalty goals', 'PKG', 'Scoring'), pk_att: P('Penalty attempts', 'PKA', 'Scoring'), pk_pct: P('Penalty conversion', 'PK%', 'Scoring', { pct: true }),
  goals_1h: P('First-half goals', 'G 1H', 'Scoring'), goals_2h: P('Second-half goals', 'G 2H', 'Scoring'), goals_ot: P('Overtime goals', 'G OT', 'Scoring'),
  shots: P('Shots', 'SH', 'Shooting'), sog: P('Shots on goal', 'SOG', 'Shooting'), shot_accuracy: P('Shot accuracy', 'SOG%', 'Shooting', { pct: true }), conversion_pct: P('Conversion', 'Conv%', 'Shooting', { pct: true }),
  shots_per_goal: P('Shots per goal', 'SH/G', 'Shooting', { decimals: 1, lowerIsBetter: true }), minutes_per_goal: P('Minutes per goal', 'MIN/G', 'Shooting', { lowerIsBetter: true }),
  gp: P('Games played', 'GP', 'Playing time'), gs: P('Games started', 'GS', 'Playing time'), minutes: P('Minutes', 'MIN', 'Playing time'), minutes_share: P('Share of team minutes', 'MIN%', 'Playing time', { pct: true }),
  goals_p90: P('Goals per 90', 'G/90', 'Per 90', { decimals: 2 }), assists_p90: P('Assists per 90', 'A/90', 'Per 90', { decimals: 2 }), points_p90: P('Points per 90', 'PTS/90', 'Per 90', { decimals: 2 }), shots_p90: P('Shots per 90', 'SH/90', 'Per 90', { decimals: 2 }), sog_p90: P('Shots on goal per 90', 'SOG/90', 'Per 90', { decimals: 2 }),
  saves: P('Saves', 'SV', 'Goalkeeping'), save_pct: P('Save percentage', 'SV%', 'Goalkeeping', { pct: true }), gaa: P('Goals against average', 'GAA', 'Goalkeeping', { decimals: 2, lowerIsBetter: true }), ga: P('Goals against', 'GA', 'Goalkeeping', { lowerIsBetter: true }),
  shutouts: P('Shutouts', 'SHO', 'Goalkeeping'), clean_sheets: P('Clean sheets', 'CS', 'Goalkeeping', { help: '≥45 minutes, none conceded' }), saves_p90: P('Saves per 90', 'SV/90', 'Goalkeeping', { decimals: 2 }), gk_minutes: P('Minutes in goal', 'GK MIN', 'Goalkeeping'),
  yc: P('Yellow cards', 'YC', 'Discipline'), rc: P('Red cards', 'RC', 'Discipline'), fouls: P('Fouls', 'FLS', 'Discipline'), corners: P('Corners taken', 'CK', 'Discipline'), offsides: P('Offsides', 'OFF', 'Discipline'),
  pct_points_p90: P('Points per 90 percentile', 'PTS/90 pctl', 'Percentiles', { pct: true }), pct_goals_p90: P('Goals per 90 percentile', 'G/90 pctl', 'Percentiles', { pct: true }), pct_assists_p90: P('Assists per 90 percentile', 'A/90 pctl', 'Percentiles', { pct: true }), pct_shots_p90: P('Shots per 90 percentile', 'SH/90 pctl', 'Percentiles', { pct: true }), pct_save_pct: P('Save percentage percentile', 'SV% pctl', 'Percentiles', { pct: true }), pct_gaa: P('Goals against percentile', 'GAA pctl', 'Percentiles', { pct: true }),
  div_rank_points: P('Division rank by points', 'Div rank', 'Ranks', { lowerIsBetter: true }), div_rank_goals: P('Division rank by goals', 'Div rank (G)', 'Ranks', { lowerIsBetter: true }), div_rank_assists: P('Division rank by assists', 'Div rank (A)', 'Ranks', { lowerIsBetter: true }), conf_rank_points: P('Conference rank by points', 'Conf rank', 'Ranks', { lowerIsBetter: true }), conf_rank_goals: P('Conference rank by goals', 'Conf rank (G)', 'Ranks', { lowerIsBetter: true }),
};

export const TEAM_STAT_DEFS: Record<string, StatDef> = {
  w: P('Wins', 'W', 'Record'), l: P('Losses', 'L', 'Record', { lowerIsBetter: true }), t: P('Ties', 'T', 'Record'), gp: P('Games played', 'GP', 'Record'), ppg: P('Points per game', 'PPG', 'Record', { decimals: 2, help: '3 for a win, 1 for a tie' }),
  conf_w: P('Conference wins', 'Conf W', 'Record'), conf_l: P('Conference losses', 'Conf L', 'Record', { lowerIsBetter: true }), conf_t: P('Conference ties', 'Conf T', 'Record'),
  vs_ranked_w: P('Wins vs ranked', 'W vs rk', 'Record'), vs_ranked_l: P('Losses vs ranked', 'L vs rk', 'Record', { lowerIsBetter: true }), vs_ranked_t: P('Ties vs ranked', 'T vs rk', 'Record'),
  gf: P('Goals for', 'GF', 'Goals'), ga: P('Goals against', 'GA', 'Goals', { lowerIsBetter: true }), gd: P('Goal difference', 'GD', 'Goals'), gf_pg: P('Goals for per game', 'GF/G', 'Goals', { decimals: 2 }), ga_pg: P('Goals against per game', 'GA/G', 'Goals', { decimals: 2, lowerIsBetter: true }),
  gf_home: P('Goals for at home', 'GF home', 'Goals'), gf_away: P('Goals for away', 'GF away', 'Goals'), ga_home: P('Goals against at home', 'GA home', 'Goals', { lowerIsBetter: true }), ga_away: P('Goals against away', 'GA away', 'Goals', { lowerIsBetter: true }),
  gf_1h: P('First-half goals for', 'GF 1H', 'Goals'), gf_2h: P('Second-half goals for', 'GF 2H', 'Goals'), ga_1h: P('First-half goals against', 'GA 1H', 'Goals', { lowerIsBetter: true }), ga_2h: P('Second-half goals against', 'GA 2H', 'Goals', { lowerIsBetter: true }),
  last5_gf: P('Goals for, last five', 'GF last 5', 'Goals'), last5_ga: P('Goals against, last five', 'GA last 5', 'Goals', { lowerIsBetter: true }),
  shots: P('Shots', 'SH', 'Shooting'), sog: P('Shots on goal', 'SOG', 'Shooting'), shots_pg: P('Shots per game', 'SH/G', 'Shooting', { decimals: 1 }), sog_pg: P('Shots on goal per game', 'SOG/G', 'Shooting', { decimals: 1 }), sog_pct: P('Shot accuracy', 'SOG%', 'Shooting', { pct: true }), shots_per_goal: P('Shots per goal', 'SH/goal', 'Shooting', { decimals: 1, lowerIsBetter: true }),
  pk_goals: P('Penalty goals', 'PKG', 'Shooting'), pk_att: P('Penalty attempts', 'PKA', 'Shooting'),
  corners: P('Corners', 'CK', 'Set pieces & discipline'), corners_pg: P('Corners per game', 'CK/G', 'Set pieces & discipline', { decimals: 1 }), fouls: P('Fouls', 'FLS', 'Set pieces & discipline'), offsides: P('Offsides', 'OFF', 'Set pieces & discipline'), yc: P('Yellow cards', 'YC', 'Set pieces & discipline'), rc: P('Red cards', 'RC', 'Set pieces & discipline'),
  saves: P('Saves', 'SV', 'Defending'), clean_sheets: P('Clean sheets', 'CS', 'Defending'), avg_attendance: P('Average attendance', 'Att', 'Home'),
  div_rank_ppg: P('Division rank by points per game', 'Div rank', 'Ranks', { lowerIsBetter: true }), conf_rank_ppg: P('Conference rank by points per game', 'Conf rank', 'Ranks', { lowerIsBetter: true }), conf_rank_gf_pg: P('Conference rank, goals for per game', 'Conf rank GF', 'Ranks', { lowerIsBetter: true }), conf_rank_ga_pg: P('Conference rank, goals against per game', 'Conf rank GA', 'Ranks', { lowerIsBetter: true }),
  div_pct_gf_pg: P('Attack percentile', 'Attack pctl', 'Percentiles', { pct: true }), div_pct_ga_pg: P('Defence percentile', 'Defence pctl', 'Percentiles', { pct: true }), div_pct_shots_pg: P('Shots percentile', 'Shots pctl', 'Percentiles', { pct: true }),
};

export function statDef(kind: 'player' | 'team', key: string): StatDef {
  return (kind === 'team' ? TEAM_STAT_DEFS : PLAYER_STAT_DEFS)[key] ?? { label: key.replace(/_/g, ' '), short: key, group: 'Other' };
}

/** Stats grouped in the order they should appear in a picker. */
export function statGroups(kind: 'player' | 'team', keys: string[]): { group: string; stats: { key: string; label: string }[] }[] {
  const order = kind === 'team' ? ['Record', 'Goals', 'Shooting', 'Set pieces & discipline', 'Defending', 'Home', 'Ranks', 'Percentiles', 'Other'] : ['Scoring', 'Shooting', 'Per 90', 'Playing time', 'Goalkeeping', 'Discipline', 'Ranks', 'Percentiles', 'Other'];
  const by = new Map<string, { key: string; label: string }[]>();
  for (const k of keys) { const d = statDef(kind, k); by.set(d.group, [...(by.get(d.group) ?? []), { key: k, label: d.label }]); }
  return order.filter((g) => by.has(g)).map((g) => ({ group: g, stats: by.get(g)! }));
}
