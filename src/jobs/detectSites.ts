// Classify every school's athletics site and discover the soccer sport on it (slug / sportId / team slug).
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { detectSite, adapterFor } from '../sources/sites/detect.js';
import { listSchools, listPrograms, upsertSchools } from '../db/repos.js';
import { currentSeason } from './seasons.js';
import type { SiteContext } from '../model.js';
import { log } from '../log.js';

/** params: { season?, program? (seo), only_unknown?, platforms?: string[], program_status?: string[], force? } */
export async function detectSites(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const fetcher = makeFetcher(db);
  const onlySeo = typeof ctx.params.program === 'string' ? ctx.params.program : null;
  // `platforms` re-probes only schools currently classified a certain way (e.g. ['other','unknown'] after adding an adapter).
  const wantPlatforms = Array.isArray(ctx.params.platforms) ? new Set((ctx.params.platforms as string[]).map(String)) : null;
  const reprobe = !!ctx.params.force || !!wantPlatforms;
  const schools = (await listSchools(db)).filter((s) => s.athletics_url && (!onlySeo || s.seo === onlySeo) && (!wantPlatforms || wantPlatforms.has(s.site_platform)));
  const programs = await listPrograms(db);
  // program_status: only schools with a program in one of these states (e.g. ['unknown','failed'] = sport never found).
  const wantStatus = Array.isArray(ctx.params.program_status) ? new Set((ctx.params.program_status as string[]).map(String)) : null;
  for (const s of schools) {
    if (await ctx.cancelled()) return;
    const mine = programs.filter((p) => p.school_seo === s.seo && (!wantStatus || wantStatus.has(p.site_status)));
    if (!mine.length) continue;
    // only_unknown restricts the set of schools; force only decides whether an already-classified school is re-probed.
    if (ctx.params.only_unknown && s.site_platform !== 'unknown') continue;
    let platform = s.site_platform;
    let baseUrl = `https://${s.athletics_host}`;
    let host = s.athletics_host!;
    if (platform === 'unknown' || reprobe) {
      const d = await detectSite(fetcher, s.athletics_url!);
      platform = d.platform; baseUrl = d.baseUrl; host = d.host;
      await upsertSchools(db, [{ seo: s.seo, name: s.name, site_platform: platform, site_detected_at: new Date().toISOString(), athletics_host: host }]);
      ctx.inc(`platform_${platform}`);
    }
    const adapter = adapterFor(platform);
    for (const p of mine) {
      if (!adapter) { await db.from('college_programs').update({ site_status: 'not_found' }).eq('id', p.id); continue; }
      if (p.site_status === 'ok' && p.site_sport_slug && !reprobe && !wantStatus) continue;
      const base: SiteContext = { host, baseUrl, gender: p.gender, season, sportSlug: p.site_sport_slug, sportId: p.site_sport_id, teamSlug: p.site_team_slug };
      try {
        const found = await adapter.discover(fetcher, base);
        if (found) {
          await db.from('college_programs').update({ site_sport_slug: found.sportSlug, site_sport_id: found.sportId, site_team_slug: found.teamSlug, site_status: 'ok' }).eq('id', p.id);
          ctx.inc('sports_found');
        } else {
          await db.from('college_programs').update({ site_status: 'not_found' }).eq('id', p.id);
          ctx.inc('sports_not_found');
        }
      } catch (err) {
        await db.from('college_programs').update({ site_status: 'failed' }).eq('id', p.id);
        ctx.inc('discover_errors');
        log.warn({ seo: s.seo, gender: p.gender, err: err instanceof Error ? err.message : String(err) }, 'site discover failed');
      }
    }
    await ctx.heartbeat();
  }
}

registerJob('detect-sites', detectSites);
