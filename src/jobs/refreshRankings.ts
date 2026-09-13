// USC poll + NCAA stat-category national ranks + conference standings.
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { loadConfig } from '../config.js';
import { parseUscPoll, uscPollUrl, parseStatCategories, parseStatTable, statUrl, parseStandings, parseHenrygdStandings, standingsUrl } from '../sources/ncaa/index.js';
import { listPrograms, listSchools, listProgramSeasons, upsertConference } from '../db/repos.js';
import { upsertChunked } from '../db/client.js';
import { teamKey } from '../normalize/teamIdentity.js';
import { currentSeason } from './seasons.js';
import type { Division, Gender } from '../model.js';
import { log } from '../log.js';

/** params: { season?, gender?, division?, categories?: boolean } */
export async function refreshRankings(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const fetcher = makeFetcher(db);
  const cfg = loadConfig();
  const genders: Gender[] = ctx.params.gender ? [ctx.params.gender as Gender] : ['m', 'w'];
  const divisions: Division[] = ctx.params.division ? [ctx.params.division as Division] : ['d1', 'd2', 'd3'];
  const programs = await listPrograms(db);
  const schools = new Map((await listSchools(db)).map((s) => [s.seo, s]));
  const seasons = await listProgramSeasons(db, season);
  const divOf = new Map(seasons.map((s) => [s.program_id, s.division]));
  const index = new Map<string, string>(); // `${gender}|${teamKey}` → program id
  for (const p of programs) {
    const s = schools.get(p.school_seo);
    for (const n of [p.name, p.short_name, p.name6, s?.name, s?.long_name, p.school_seo]) if (n) { const k = `${p.gender}|${teamKey(n)}`; if (!index.has(k)) index.set(k, p.id); }
  }
  const resolve = (gender: Gender, name: string, division?: Division) => {
    const id = index.get(`${gender}|${teamKey(name)}`);
    if (!id) return null;
    if (division && divOf.get(id) && divOf.get(id) !== division) return null;
    return id;
  };
  const weekOf = new Date().toISOString().slice(0, 10);

  for (const gender of genders) for (const division of divisions) {
    if (await ctx.cancelled()) return;
    // USC poll
    try {
      const poll = parseUscPoll((await fetcher.get(uscPollUrl(gender, division), { skipCache: true })).text);
      const rows = poll.rows.map((r) => ({ season, gender, division, poll: 'usc', week_of: weekOf, rank: r.rank, program_id: resolve(gender, r.school), subject_name: r.school, value: r.points ?? null }));
      if (rows.length) { await upsertChunked(db, 'college_rankings', rows, { onConflict: 'season,poll,week_of,subject_key' }); ctx.inc('usc_rows', rows.length); }
      ctx.inc('usc_unresolved', rows.filter((r) => !r.program_id).length);
    } catch (err) { ctx.inc('usc_errors'); log.warn({ gender, division, err: String(err) }, 'usc poll failed'); }

    // NCAA team stat categories → national ranks (page 1..n)
    if (ctx.params.categories !== false) {
      try {
        const first = (await fetcher.get(statUrl(gender, division, 'current', 'team', 30), { skipCache: true })).text;
        const cats = parseStatCategories(first);
        for (const cat of cats.team) {
          const rows: Record<string, unknown>[] = [];
          let page = 1, pages = 1;
          do {
            const html = (await fetcher.get(statUrl(gender, division, 'current', 'team', cat.id, page), { skipCache: true })).text;
            const t = parseStatTable(html);
            pages = t.pages || 1;
            const valueCol = t.columns[t.columns.length - 1]!;
            for (const r of t.rows) {
              const team = r.Team ?? r.Name ?? '';
              rows.push({ season, gender, division, poll: `ncaa:${cat.id}`, week_of: weekOf, rank: Number(String(r.Rank ?? '').replace(/\D/g, '')) || rows.length + 1, program_id: resolve(gender, team, division), subject_name: `${cat.name}|${team}`, value: Number(r[valueCol]) || null });
            }
            page += 1;
          } while (page <= pages && page <= 12);
          if (rows.length) await upsertChunked(db, 'college_rankings', rows, { onConflict: 'season,poll,week_of,subject_key' });
          ctx.inc('category_rows', rows.length);
          await ctx.heartbeat();
        }
      } catch (err) { ctx.inc('category_errors'); log.warn({ gender, division, err: String(err) }, 'stat categories failed'); }
    }

    // Standings: HTML first, henrygd JSON if configured and HTML is empty.
    try {
      let st = parseStandings((await fetcher.get(standingsUrl(gender, division), { skipCache: true })).text);
      if (!st.conferences.length && cfg.NCAA_API_BASE) {
        const j = JSON.parse((await fetcher.get(`${cfg.NCAA_API_BASE.replace(/\/$/, '')}/standings/${gender === 'w' ? 'soccer-women' : 'soccer-men'}/${division}`, { accept: 'application/json', skipCache: true })).text);
        st = parseHenrygdStandings(j);
      }
      const rows: Record<string, unknown>[] = [];
      for (const conf of st.conferences) {
        const confName = conf.conference;
        const confId = confName ? await upsertConference(db, teamKey(confName).replace(/\s+/g, '-'), confName, division) : null;
        conf.rows.forEach((r, i) => {
          const rr = r as typeof r & { rank?: number | null; points?: number | null };
          const pid = (r.seo ? index.get(`${gender}|${teamKey(r.seo.replace(/-/g, ' '))}`) : null) ?? resolve(gender, r.school, division);
          if (!pid) { ctx.inc('standings_unresolved'); return; }
          rows.push({ season, program_id: pid, division, conference_id: confId, conf_w: r.conference.w, conf_l: r.conference.l, conf_t: r.conference.t, conf_pts: rr.points ?? null, overall_w: r.overall.w, overall_l: r.overall.l, overall_t: r.overall.t, rank: rr.rank ?? i + 1, fetched_at: new Date().toISOString() });
        });
      }
      if (rows.length) await upsertChunked(db, 'college_standings', rows, { onConflict: 'season,program_id' });
      ctx.inc('standings_rows', rows.length);
    } catch (err) { ctx.inc('standings_errors'); log.warn({ gender, division, err: String(err) }, 'standings failed'); }
  }
}

registerJob('refresh-rankings', refreshRankings);
