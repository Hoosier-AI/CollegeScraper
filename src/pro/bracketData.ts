// The knockout stage of one competition season (src/pro/bracket.ts) read from the database: every fixture of the
// season, not the latest 30 the competition page carries. Pro cups and international tournaments share pro_fixtures,
// so one read serves both; the match links follow the competition's scope.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { cupKnockout, roundRank, type CupFixture, type CupKnockout } from './bracket.js';

// The columns the bracket needs (a subset of FIXTURE_SELECT in queries.ts: no league, venue or half-time columns).
const TEAM = 'id,display_name,slug,logo';
const BRACKET_SELECT = `id,slug,kickoff,status,status_short,round,home_goals,away_goals,et_home,et_away,pen_home,pen_away,winner,
home:pro_teams!pro_fixtures_home_team_id_fkey(${TEAM}),
away:pro_teams!pro_fixtures_away_team_id_fkey(${TEAM})`;

export interface LeagueBracket extends CupKnockout { season: number; has_groups: boolean }

const toFixture = (r: any): CupFixture => ({
  id: Number(r.id), slug: r.slug, kickoff: r.kickoff, status: r.status, status_short: r.status_short ?? null, round: r.round ?? null,
  home: { id: r.home?.id ?? null, name: r.home?.display_name ?? null, logo: r.home?.logo ?? null, score: r.home_goals ?? null },
  away: { id: r.away?.id ?? null, name: r.away?.display_name ?? null, logo: r.away?.logo ?? null, score: r.away_goals ?? null },
  et: [r.et_home ?? null, r.et_away ?? null], pen: [r.pen_home ?? null, r.pen_away ?? null], winner: r.winner ?? null,
});

/** The season's knockout stage, or null: no such competition, no season, or no knockout round among its fixtures. */
export async function leagueBracket(db: Db, slug: string, season?: number | null): Promise<LeagueBracket | null> {
  const { data: l, error } = await db.from('pro_leagues').select('id,type,scope,current_season').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  const lg = l as { id: number; type: string | null; scope: string | null; current_season: number | null } | null;
  const s = season ?? lg?.current_season ?? null;
  if (!lg || s == null) return null;
  const [rows, groups] = await Promise.all([
    selectAll<any>(db, 'pro_fixtures', BRACKET_SELECT, (q) => q.eq('league_id', lg.id).eq('season', s)),
    selectAll<{ group_name: string | null }>(db, 'pro_standings', 'group_name', (q) => q.eq('league_id', lg.id).eq('season', s)),
  ]);
  const fixtures = rows.map(toFixture);
  const k = cupKnockout(fixtures, (m) => `${lg.scope === 'intl' ? '/intl' : '/pro'}/matches/${m}`);
  if (!k.bracket && !k.third_place && !k.preliminary.length) return null;
  // A league's numbered rounds are matchdays, not ties: outside a cup only a real bracket counts.
  if (!k.bracket && lg.type !== 'cup') return null;
  // Groups: a group round among the fixtures, or more than one table for the season.
  const has_groups = fixtures.some((f) => roundRank(f.round).stage === 'group') || new Set(groups.map((g) => g.group_name ?? '')).size > 1;
  return { season: s, ...k, has_groups };
}
