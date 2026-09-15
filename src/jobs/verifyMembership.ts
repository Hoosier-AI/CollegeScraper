// NCAA membership from the "Won-Lost-Tied Percentage" team leaderboard on NCAA.com: it lists every member
// of a division with its official overall record, so it is the oracle for "all the teams" and for records.
// params: { season?, gender?, division? }
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { parseStatCategories, parseStatTable, statUrl, sportPath } from '../sources/ncaa/index.js';
import { listPrograms, listSchools, listProgramSeasons, upsertProgram, upsertProgramSeasons, upsertSchools } from '../db/repos.js';
import { upsertChunked } from '../db/client.js';
import { int } from '../normalize/num.js';
import { currentSeason } from './seasons.js';
import type { Division, Gender } from '../model.js';
import { log } from '../log.js';

export const WLT_CATEGORY = /won-?lost-?tied/i;

export async function verifyMembership(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const fetcher = makeFetcher(db);
  const genders: Gender[] = ctx.params.gender ? [ctx.params.gender as Gender] : ['m', 'w'];
  const divisions: Division[] = ctx.params.division ? [ctx.params.division as Division] : ['d1', 'd2', 'd3'];
  const schools = new Map((await listSchools(db)).map((s) => [s.seo, s]));
  const programs = await listPrograms(db);
  const byKey = new Map(programs.map((p) => [`${p.school_seo}|${p.gender}`, p]));
  const seasons = await listProgramSeasons(db, season);
  const seasonOf = new Map(seasons.map((s) => [s.program_id, s]));
  const now = new Date().toISOString();
  const listed = new Set<string>(); // program ids seen on a leaderboard
  const patches = new Map<string, Record<string, unknown>>();

  for (const gender of genders) for (const division of divisions) {
    if (await ctx.cancelled()) return;
    let catId: number | null = null;
    try {
      const landing = (await fetcher.get(`https://www.ncaa.com/stats/${sportPath(gender)}/${division}`, { skipCache: true })).text;
      catId = parseStatCategories(landing).team.find((c) => WLT_CATEGORY.test(c.name))?.id ?? null;
    } catch (err) { log.warn({ gender, division, err: String(err) }, 'stats landing failed'); }
    if (!catId) { ctx.inc('leaderboard_missing'); continue; }
    let page = 1, pages = 1, n = 0;
    do {
      let t;
      try { t = parseStatTable((await fetcher.get(statUrl(gender, division, 'current', 'team', catId, page), { skipCache: true })).text); }
      catch (err) { ctx.inc('leaderboard_errors'); log.warn({ gender, division, page, err: String(err) }, 'leaderboard page failed'); break; }
      pages = t.pages || 1;
      for (const r of t.rows) {
        const seo = r.teamSeo;
        if (!seo) { ctx.inc('leaderboard_rows_without_seo'); continue; }
        n += 1;
        const w = int(r.Won ?? r.W), l = int(r.Loss ?? r.Lost ?? r.L), tt = int(r.Tied ?? r.T);
        let p = byKey.get(`${seo}|${gender}`);
        if (!p) {
          if (!schools.has(seo)) { await upsertSchools(db, [{ seo, name: r.Team ?? seo }]); schools.set(seo, { seo, name: r.Team ?? seo } as any); }
          p = await upsertProgram(db, { school_seo: seo, gender, name: r.Team ?? seo, short_name: r.Team ?? null });
          byKey.set(`${seo}|${gender}`, p);
          ctx.inc('members_created');
          log.info({ seo, gender, division }, 'program created from NCAA leaderboard');
        }
        listed.add(p.id);
        const ps = seasonOf.get(p.id);
        if (ps && ps.division !== division) ctx.inc('division_corrected');
        patches.set(p.id, { program_id: p.id, season, division, conference_id: ps?.conference_id ?? null, ncaa_member: true, member_source: 'leaderboard', official_w: w, official_l: l, official_t: tt, official_record_at: now });
      }
      page += 1;
      await ctx.heartbeat();
    } while (page <= pages && page <= 20);
    ctx.inc(`members_${gender}_${division}`, n);
    ctx.inc('members_expected', n);
  }

  // Programs known for the season but absent from every leaderboard.
  const wanted = new Set(genders);
  for (const ps of seasons) {
    if (listed.has(ps.program_id)) continue;
    const p = programs.find((x) => x.id === ps.program_id);
    if (!p || !wanted.has(p.gender) || !divisions.includes(ps.division)) continue;
    if (ps.conference_id) { patches.set(ps.program_id, { program_id: ps.program_id, season, division: ps.division, conference_id: ps.conference_id, ncaa_member: true, member_source: 'conference' }); ctx.inc('members_unlisted'); }
    else { patches.set(ps.program_id, { program_id: ps.program_id, season, division: ps.division, conference_id: null, ncaa_member: false, member_source: 'none' }); ctx.inc('non_members'); }
  }
  if (patches.size) await upsertProgramSeasons(db, [...patches.values()] as any);
  ctx.inc('program_seasons_updated', patches.size);
  void upsertChunked;
}

registerJob('verify-membership', verifyMembership);
