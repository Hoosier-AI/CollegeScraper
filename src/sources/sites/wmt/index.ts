// WMT Digital athletics sites (Nuxt front end): fightingirish.com, virginiasports.com, gopsusports.com,
// clemsontigers.com, odusports.com and ~80 other member programs.
//
// The roster page embeds the whole page state in <script id="__NUXT_DATA__"> (devalue format, same encoding as the
// newer Sidearm template) under keys like `roster-500-players-list-page-1`:
//   players[]      { jersey_number, jersey_number_label, height_feet, height_inches, weight, is_captain,
//                    player_position: { abbreviation, name }, class_level: { name },
//                    player: { id, first_name, last_name, slug, hometown, high_school, previous_school, major } }
//   rosterStaffs[] { first_name, last_name, position, slug }
//
// Only the roster is read: schedules and box scores for these programs come from NCAA.com and from the opponents'
// sites, which already cover them.
import type { BoxScore, Coach, Fetcher, Gender, PlayerBio, Roster, RosterPlayer, ScheduleEntry, SeasonStats, SiteAdapter, SiteContext } from '../../../model.js';
import { decodeNuxtData } from '../sidearm/devalue.js';
import { isNotFound } from '../sidearm/common.js';
import { cleanName } from '../../../normalize/names.js';
import { int } from '../../../normalize/num.js';

/** Sport path candidates: WMT tenants use either the short or the long spelling. */
export function wmtSportSlugs(gender: Gender): string[] {
  return gender === 'w' ? ['wsoc', 'womens-soccer'] : ['msoc', 'mens-soccer'];
}

export function looksLikeWmt(html: string): boolean {
  if (!html) return false;
  const head = html.length > 400_000 ? html.slice(0, 400_000) : html;
  if (!/__NUXT_DATA__/.test(head)) return false;
  return /wmtdigital|wmt_stats|wmt-|"wmt\b|gameday-?cms/i.test(head);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The `…players-list…` entry of the decoded page state, whatever the roster id and page number are. */
export function findWmtPlayers(root: unknown): Record<string, unknown>[] {
  const data = isObj(root) && isObj(root.data) ? root.data : null;
  if (!data) return [];
  for (const [key, value] of Object.entries(data)) {
    if (!/players-list/.test(key) || !isObj(value)) continue;
    const players = value.players;
    if (Array.isArray(players) && players.length) return players.filter(isObj);
  }
  return [];
}

export function findWmtStaff(root: unknown): Record<string, unknown>[] {
  const data = isObj(root) && isObj(root.data) ? root.data : null;
  if (!data) return [];
  for (const [key, value] of Object.entries(data)) {
    if (!/staff-members-list/.test(key) || !isObj(value)) continue;
    const staff = value.rosterStaffs;
    if (Array.isArray(staff) && staff.length) return staff.filter(isObj);
  }
  return [];
}

/** A WMT photo object: `url` is the full-size imgproxy render; `srcset` lists smaller renders ("… 480w, … 768w"). */
function photoUrl(v: unknown): string | null {
  if (!isObj(v)) return null;
  const srcset = str(v.srcset);
  if (srcset) {
    const candidates = srcset.split(',').map((e) => e.trim().split(/\s+/)).filter((e) => e[0]).map((e) => ({ url: e[0]!, w: parseInt(e[1] ?? '', 10) || Infinity }));
    const smallest = candidates.filter((c) => c.w >= 240).sort((a, b) => a.w - b.w)[0] ?? candidates.sort((a, b) => a.w - b.w)[0];
    if (smallest) return smallest.url;
  }
  return str(v.url);
}

function toPlayer(rec: Record<string, unknown>, rosterUrl: string): RosterPlayer | null {
  const p = isObj(rec.player) ? rec.player : {};
  const firstName = cleanName(str(p.first_name) ?? '');
  const lastName = cleanName(str(p.last_name) ?? '');
  if (!firstName && !lastName) return null;
  const pos = isObj(rec.player_position) ? rec.player_position : {};
  const cls = isObj(rec.class_level) ? rec.class_level : {};
  const feet = int(rec.height_feet), inches = int(rec.height_inches);
  const id = rec.player_id ?? p.id;
  const slug = str(p.slug);
  return {
    sourceKey: id != null ? String(id) : `${lastName}|${firstName}`.toLowerCase(),
    sitePlayerId: id != null ? String(id) : null,
    firstName, lastName,
    jersey: int(rec.jersey_number ?? rec.jersey_number_label),
    positionRaw: str(pos.abbreviation) ?? str(pos.name),
    classRaw: str(cls.name),
    heightRaw: feet != null ? `${feet}-${inches ?? 0}` : null,
    weightLb: int(rec.weight),
    hometownRaw: str(p.hometown),
    highSchool: str(p.high_school),
    previousSchool: str(p.previous_school),
    major: str(p.major),
    isCaptain: rec.is_captain === true,
    // The roster entry's photo is this season's headshot; the player's own photo is an older one.
    headshotUrl: photoUrl(rec.photo) ?? photoUrl(p.photo) ?? photoUrl(p.master_photo),
    bioUrl: slug ? `${rosterUrl.replace(/\/roster.*$/, '/roster')}/${slug}` : null,
  };
}

function toCoach(rec: Record<string, unknown>): Coach | null {
  const name = cleanName([str(rec.first_name), str(rec.last_name)].filter(Boolean).join(' '));
  if (!name) return null;
  const title = str(rec.position);
  return { name, title, isHead: /head coach/i.test(title ?? ''), headshotUrl: photoUrl(rec.photo) ?? photoUrl(isObj(rec.staff_member) ? rec.staff_member.photo : null) };
}

export function parseWmtRoster(html: string, sourceUrl: string): Roster {
  const root = decodeNuxtData(html);
  const players = findWmtPlayers(root).map((r) => toPlayer(r, sourceUrl)).filter((p): p is RosterPlayer => !!p);
  const coaches = findWmtStaff(root).map(toCoach).filter((c): c is Coach => !!c);
  return { players, coaches, sourceUrl };
}

const base = (ctx: SiteContext) => ctx.baseUrl.replace(/\/+$/, '');
const rosterUrl = (ctx: SiteContext, slug: string) => `${base(ctx)}/sports/${slug}/roster`;

export const wmtAdapter: SiteAdapter = {
  platform: 'wmt',

  async discover(fetcher: Fetcher, ctx: SiteContext): Promise<SiteContext | null> {
    for (const slug of ctx.sportSlug ? [ctx.sportSlug, ...wmtSportSlugs(ctx.gender)] : wmtSportSlugs(ctx.gender)) {
      try {
        const res = await fetcher.get(rosterUrl(ctx, slug), { attempts: 1 });
        if (findWmtPlayers(decodeNuxtData(res.text)).length) return { ...ctx, sportSlug: slug, sportId: null, teamSlug: null };
      } catch (err) { if (!isNotFound(err)) throw err; }
    }
    return null;
  },

  async roster(fetcher: Fetcher, ctx: SiteContext): Promise<Roster> {
    const slugs = ctx.sportSlug ? [ctx.sportSlug] : wmtSportSlugs(ctx.gender);
    for (const slug of slugs) {
      const url = rosterUrl(ctx, slug);
      try {
        const res = await fetcher.get(url);
        const roster = parseWmtRoster(res.text, url);
        if (roster.players.length) return roster;
      } catch (err) { if (!isNotFound(err)) throw err; }
    }
    return { players: [], coaches: [], sourceUrl: rosterUrl(ctx, slugs[0]!) };
  },

  // Games for these programs come from NCAA.com and the opponents' sites.
  async schedule(): Promise<ScheduleEntry[]> { return []; },
  async seasonStats(): Promise<SeasonStats | null> { return null; },
  async boxScore(): Promise<BoxScore> { throw new Error('wmt: box scores are not read from this platform'); },
  async playerBio(_fetcher: Fetcher, _ctx: SiteContext, url: string): Promise<PlayerBio> { return { honors: [], bioText: null, sourceUrl: url }; },
};
