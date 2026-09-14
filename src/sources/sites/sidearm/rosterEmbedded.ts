// Legacy Sidearm roster pages (Vue template, /api/v2/Rosters returns 404 or 204) embed the whole roster
// object in the page script: `data: () => ({ roster: {...,"players":[{"rp_id":...}],"coaches":[...]} })`.
// Field names are snake_case versions of the JSON API's.
import type { Coach, Roster, RosterPlayer, SiteContext } from '../../../model.js';
import { cleanName } from '../../../normalize/names.js';
import { int } from '../../../normalize/num.js';

/** Find the JSON object that contains `"players":[{"rp_id"` by matching braces outward, then parse it. */
export function extractEmbeddedRoster(html: string): Record<string, unknown> | null {
  const i = html.indexOf('"players":[{"rp_id"');
  if (i < 0) return null;
  // walk back to the unmatched '{' that opens the enclosing object (skipping string literals)
  let depth = 0; let k = i - 1; let inStr = false;
  for (; k >= 0; k--) {
    const c = html[k];
    if (c === '"' && html[k - 1] !== '\\') inStr = !inStr;
    else if (!inStr) { if (c === '}') depth++; else if (c === '{') { if (depth === 0) break; depth--; } }
  }
  if (k < 0) return null;
  const start = k;
  depth = 0; inStr = false;
  for (k = start; k < html.length; k++) {
    const c = html[k];
    if (c === '"' && html[k - 1] !== '\\') inStr = !inStr;
    else if (!inStr) { if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } }
  }
  try { const obj = JSON.parse(html.slice(start, k + 1)); return obj && typeof obj === 'object' ? obj as Record<string, unknown> : null; } catch { return null; }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function parseRosterEmbedded(obj: Record<string, unknown>, ctx: SiteContext, sourceUrl: string): Roster {
  const players = (Array.isArray(obj.players) ? obj.players : []) as Record<string, unknown>[];
  const sportSlug = ((obj.sport as Record<string, unknown> | undefined)?.global_sport_name_slug as string | undefined) ?? ctx.sportSlug ?? 'mens-soccer';
  const out: RosterPlayer[] = players.filter((p) => !p.rp_hide).map((p) => {
    const first = cleanName(str(p.first_name) ?? ''); const last = cleanName(str(p.last_name) ?? '');
    const rpId = p.rp_id != null ? String(p.rp_id) : null; const playerId = p.player_id != null ? String(p.player_id) : null;
    const jersey = int(str(p.jersey_number));
    const hf = int(p.height_feet), hi = int(p.height_inches);
    const img = p.image as Record<string, unknown> | null;
    const imgUrl = img ? (str(img.absolute_url) ?? (str(img.url) ? `${ctx.baseUrl}${str(img.url)}` : null) ?? (str(img.path) && str(img.filename) ? `${ctx.baseUrl}${str(img.path)}/${str(img.filename)}` : null)) : null;
    const slug = `${first} ${last}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      sourceKey: playerId ?? rpId ?? `${last}|${first}|${jersey ?? ''}`.toLowerCase(), sitePlayerId: playerId ?? rpId,
      firstName: first, lastName: last, jersey,
      positionRaw: str(p.position_short) ?? str(p.position_long), classRaw: str(p.academic_year_short) ?? str(p.academic_year_long),
      heightRaw: hf ? `${hf}-${hi ?? 0}` : null, weightLb: int(p.weight) || null,
      hometownRaw: str(p.hometown), highSchool: str(p.highschool), previousSchool: str(p.previous_school), major: str(p.major),
      isCaptain: !!p.is_captain, headshotUrl: imgUrl,
      bioUrl: rpId ? `${ctx.baseUrl}/sports/${sportSlug}/roster/${slug}/${rpId}` : null,
    };
  });
  const coaches: Coach[] = ((Array.isArray(obj.coaches) ? obj.coaches : []) as Record<string, unknown>[]).map((c) => {
    const name = cleanName(`${str(c.firstname) ?? ''} ${str(c.lastname) ?? ''}`);
    const title = str(c.title);
    const img = c.image as Record<string, unknown> | null;
    return { name, title, isHead: !!title && /head coach/i.test(title) && !/assistant|associate/i.test(title), headshotUrl: img && str(img.path) && str(img.filename) ? `${ctx.baseUrl}${str(img.path)}/${str(img.filename)}` : null };
  }).filter((c) => c.name);
  return { players: out, coaches, sourceUrl };
}
