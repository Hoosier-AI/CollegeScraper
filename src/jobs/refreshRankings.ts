// Rankings: every United Soccer Coaches poll of the season for all six lists (unitedsoccercoaches.org),
// cross-checked against NCAA.com's D1 copy, plus NCAA.com stat-category national ranks (team + individual).
// params: { season?, gender?, division?, categories?: boolean }
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { parseUscPoll, uscPollUrl, parseStatCategories, parseStatTable, statUrl, sportPath } from '../sources/ncaa/index.js';
import { parseUscSite, uscSiteUrl } from '../sources/usc/polls.js';
import { listPrograms, listSchools, listProgramSeasons, statLineCandidates } from '../db/repos.js';
import { upsertChunked, kvSet } from '../db/client.js';
import { setMembership, setKnownConferences, buildAliasIndex, resolveName } from '../normalize/aliasIndex.js';
import { listConferences } from '../db/standingsRepo.js';
import { splitName, nameKey, looseNameMatch } from '../normalize/names.js';
import { currentSeason } from './seasons.js';
import type { Division, Gender } from '../model.js';
import { log } from '../log.js';

export async function refreshRankings(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const fetcher = makeFetcher(db);
  const genders: Gender[] = ctx.params.gender ? [ctx.params.gender as Gender] : ['m', 'w'];
  const divisions: Division[] = ctx.params.division ? [ctx.params.division as Division] : ['d1', 'd2', 'd3'];
  const programs = await listPrograms(db);
  const schools = new Map((await listSchools(db)).map((s) => [s.seo, s]));
  const seasons = await listProgramSeasons(db, season);
  const divisionOf = new Map(seasons.map((s) => [s.program_id, s.division as string]));
  const conferenceOf = new Map(seasons.map((s) => [s.program_id, (s.conference_id as string | null) ?? null]));
  const bySeo = new Map<string, string>(); for (const p of programs) bySeo.set(`${p.school_seo}|${p.gender}`, p.id);
  setKnownConferences((await listConferences(db)).map((c) => c.name));
  setMembership(new Map(seasons.map((x) => [x.program_id, (x as { ncaa_member?: boolean }).ncaa_member !== false])));
  const index = buildAliasIndex(programs, schools);
  const resolve = (gender: Gender, division: Division, name: string) => resolveName(index, { gender, ownDivision: division, ownConference: null, divisionOf, conferenceOf }, name);
  const today = new Date().toISOString().slice(0, 10);
  const unresolved: Record<string, string[]> = {};
  const checks: Record<string, unknown> = {};

  for (const gender of genders) for (const division of divisions) {
    if (await ctx.cancelled()) return;
    const tag = `${gender}/${division}`;
    // ---- USC polls (all weeks) ----
    try {
      const url = uscSiteUrl(gender, division);
      const site = parseUscSite((await fetcher.get(url, { skipCache: true })).text);
      for (const poll of site.polls) {
        if (!poll.publishedOn) { ctx.inc('usc_polls_without_date'); continue; }
        const rows: Record<string, unknown>[] = [];
        const push = (rank: number, school: string, extra: Record<string, unknown>, label: string) => {
          const pid = resolve(gender, division, school);
          if (!pid) { ctx.inc('usc_unresolved'); (unresolved[tag] ??= []).push(school); }
          rows.push({ season, gender, division, poll: 'usc', week_of: poll.publishedOn, rank, program_id: pid, subject_name: school, label, source_url: url, ...extra });
        };
        for (const r of poll.rows) push(r.rank, r.school, { value: r.points, previous_rank: r.previous, first_place_votes: r.firstPlaceVotes, record: r.record }, poll.label);
        poll.alsoReceiving.forEach((o, i) => push(poll.rows.length + 1 + i, o.school, { value: o.points }, `${poll.label} (RV)`));
        // Re-resolution may change subject keys: replace the week wholesale.
        await db.from('college_rankings').delete().eq('season', season).eq('poll', 'usc').eq('gender', gender).eq('division', division).eq('week_of', poll.publishedOn);
        const uniq = [...new Map(rows.map((r) => [`${r.program_id ?? ''}|${r.subject_name}`, r])).values()];
        if (uniq.length) await upsertChunked(db, 'college_rankings', uniq, { onConflict: 'season,poll,week_of,subject_key' });
        ctx.inc('usc_rows', uniq.length);
        ctx.inc('usc_polls');
      }
      // Weeks no longer on the site (e.g. snapshots dated by crawl day from older code) are dropped.
      const keep = site.polls.map((p) => p.publishedOn).filter((d): d is string => !!d);
      if (keep.length) await db.from('college_rankings').delete().eq('season', season).eq('poll', 'usc').eq('gender', gender).eq('division', division).not('week_of', 'in', `(${keep.join(',')})`);
      // Cross-check the latest poll with NCAA.com's copy (D1 only on ncaa.com).
      if (division === 'd1' && site.polls.length) {
        try {
          const latest = site.polls[site.polls.length - 1]!;
          const copy = parseUscPoll((await fetcher.get(uscPollUrl(gender, division), { skipCache: true })).text);
          // Compare each ranked team's position; a tie printed as "T23" covers ranks 23..23+k-1.
          const siteRank = new Map<string, number>();
          for (const r of latest.rows) { const pid = resolve(gender, division, r.school); if (pid && !siteRank.has(pid)) siteRank.set(pid, r.rank); }
          const tie = new Map<number, number>(); for (const r of copy.rows) tie.set(r.rank, (tie.get(r.rank) ?? 0) + 1);
          const diffs: string[] = [];
          for (const r of copy.rows) {
            const pid = resolve(gender, division, r.school);
            if (!pid) { diffs.push(`#${r.rank} ncaa.com=${r.school} (unmatched name)`); continue; }
            const sr = siteRank.get(pid); const k = tie.get(r.rank) ?? 1;
            if (sr == null || sr < r.rank || sr >= r.rank + k) diffs.push(`#${r.rank} ncaa.com=${r.school} site=${sr ?? 'unranked'}`);
          }
          if (copy.rows.length !== latest.rows.length) diffs.push(`row count ncaa.com=${copy.rows.length} site=${latest.rows.length}`);
          checks[tag] = { site_poll: latest.label, site_date: latest.publishedOn, ncaa_week: copy.weekOf, ncaa_rows: copy.rows.length, mismatches: diffs };
          ctx.inc('usc_ncaa_mismatch', diffs.length);
        } catch (err) { ctx.inc('usc_ncaa_copy_errors'); log.warn({ tag, err: String(err) }, 'ncaa.com poll copy failed'); }
      }
    } catch (err) { ctx.inc('usc_errors'); log.warn({ tag, err: String(err) }, 'usc site failed'); }

    // ---- NCAA stat categories → national ranks (team + individual) ----
    if (ctx.params.categories !== false) {
      try {
        const landing = (await fetcher.get(`https://www.ncaa.com/stats/${sportPath(gender)}/${division}`, { skipCache: true })).text;
        const cats = parseStatCategories(landing);
        const candCache = new Map<string, Awaited<ReturnType<typeof statLineCandidates>>>();
        for (const cat of [...cats.team, ...cats.individual]) {
          if (await ctx.cancelled()) return;
          const rows: Record<string, unknown>[] = [];
          let page = 1, pages = 1;
          do {
            const t = parseStatTable((await fetcher.get(statUrl(gender, division, 'current', cat.kind, cat.id, page), { skipCache: true })).text);
            pages = t.pages || 1;
            const valueCol = t.columns[t.columns.length - 1]!;
            for (const r of t.rows) {
              const team = r.Team ?? '';
              const pid = (r.teamSeo ? bySeo.get(`${r.teamSeo}|${gender}`) : null) ?? resolve(gender, division, team);
              const rank = Number(String(r.Rank ?? '').replace(/\D/g, '')) || rows.length + 1;
              const value = Number(r[valueCol]) || null;
              if (cat.kind === 'team') {
                rows.push({ season, gender, division, poll: `ncaa:${cat.id}`, week_of: today, rank, program_id: pid, subject_name: `${cat.name}|${team}`, value, label: cat.name });
              } else {
                const name = r.Name ?? '';
                let psId: string | null = null;
                if (pid && name) {
                  let cands = candCache.get(pid);
                  if (!cands) { cands = await statLineCandidates(db, pid, season); candCache.set(pid, cands); }
                  const { firstName, lastName } = splitName(name);
                  const key = nameKey(firstName, lastName);
                  psId = cands.find((c) => c.nameKey === key)?.playerSeasonId ?? cands.find((c) => looseNameMatch(c, { firstName, lastName }))?.playerSeasonId ?? null;
                  if (!psId) ctx.inc('category_players_unresolved');
                }
                rows.push({ season, gender, division, poll: `ncaa:${cat.id}`, week_of: today, rank, program_id: pid, player_season_id: psId, subject_name: `${cat.name}|${name}|${team}`, value, label: cat.name });
              }
            }
            page += 1;
          } while (page <= pages && page <= 12);
          await db.from('college_rankings').delete().eq('season', season).eq('poll', `ncaa:${cat.id}`).eq('gender', gender).eq('division', division);
          // A pager glitch or two identical names on one team would repeat a subject key inside one batch.
          const uniq = [...new Map(rows.map((r) => [`${r.program_id ?? ''}|${r.player_season_id ?? ''}|${r.subject_name}`, r])).values()];
          if (uniq.length) await upsertChunked(db, 'college_rankings', uniq, { onConflict: 'season,poll,week_of,subject_key' });
          ctx.inc('category_rows', rows.length);
          await ctx.heartbeat();
        }
        ctx.inc('categories', cats.team.length + cats.individual.length);
      } catch (err) { ctx.inc('category_errors'); log.warn({ tag, err: String(err) }, 'stat categories failed'); }
    }
  }
  await kvSet(db, `usc:unresolved:${season}`, { at: new Date().toISOString(), by_list: unresolved });
  await kvSet(db, `usc:ncaa_check:${season}`, { at: new Date().toISOString(), lists: checks });
  const flat = Object.entries(unresolved).flatMap(([k, v]) => v.map((s) => `${k}: ${s}`));
  if (flat.length) ctx.note('usc_unresolved_sample', [...new Set(flat)].slice(0, 40));
}

registerJob('refresh-rankings', refreshRankings);
