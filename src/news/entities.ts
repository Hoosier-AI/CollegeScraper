// Linking a story to our pages, by rules (no AI). Teams, leagues and conferences are matched in memory against the
// story's words (longest name first); people are looked up in the database by name key, and only linked when the
// name is unique among people we show or their team is in the same story. One-word names never link a person.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { nameKey, stripDiacritics } from '../normalize/names.js';
import { teamKey } from '../normalize/teamIdentity.js';
import { buildAliasIndex, type AliasProgramLike, type AliasSchoolLike } from '../normalize/aliasIndex.js';
import { currentSeason } from '../jobs/seasons.js';

export type EntityType = 'program' | 'college_player' | 'conference' | 'pro_team' | 'pro_player' | 'pro_league';
export interface Link { type: EntityType; id: string; label: string; href: string; method: 'scope' | 'exact' | 'context' | 'tag'; primary: boolean; gender?: 'm' | 'w' | null; national?: boolean; intl?: boolean; country?: string | null; priority?: number; american?: boolean }
export type Scope = 'college' | 'pro' | 'international';

/** Lower-case ASCII words (accents folded); apostrophes dropped so "Women's" is one word. */
export function words(text: string): string[] {
  return stripDiacritics(text).toLowerCase().replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}
const fold = (s: string) => words(s).join(' ');

interface TeamRef { id: number; label: string; slug: string; gender: 'm' | 'w'; national: boolean; country: string | null; priority: number }
interface LeagueRef { id: number; label: string; slug: string; priority: number; country: string | null; gender: string | null; intl: boolean }
interface ProgramRef { id: string; label: string; seo: string; gender: 'm' | 'w'; conference: string | null }
interface ConfRef { id: string; label: string; seo: string }

// Club names that are also ordinary words or places: never linked from one word alone.
const WEAK_ONE_WORD = new Set(['united', 'city', 'real', 'sporting', 'athletic', 'inter', 'national', 'nacional', 'olympic', 'olympique', 'union', 'america', 'liberty', 'pride', 'spirit', 'courage', 'current', 'reign', 'thorns', 'wave', 'dash', 'red', 'stars', 'fire', 'galaxy', 'crew', 'union', 'revolution', 'dynamo', 'force', 'rangers', 'wanderers', 'rovers', 'town', 'county', 'army', 'navy', 'air', 'state', 'college', 'tech', 'william', 'mary', 'brown', 'rice', 'north', 'south', 'east', 'west', 'central', 'wales', 'scotland', 'england', 'ireland', 'georgia', 'jordan', 'chad', 'cuba', 'canada', 'usa', 'mexico', 'brazil', 'spain', 'france', 'italy', 'germany', 'japan']);

// Shorthand the press uses for clubs and competitions, resolved to our names when the index is built.
const TEAM_ALIASES: [string, string, 'm' | 'w' | null][] = [
  ['man city', 'manchester city', null], ['man united', 'manchester united', null], ['man utd', 'manchester united', null],
  ['spurs', 'tottenham', null], ['barca', 'barcelona', null], ['psg', 'paris saint germain', null], ['atleti', 'atletico madrid', null],
  ['gotham', 'nj ny gotham fc', 'w'], ['gotham fc', 'nj ny gotham fc', 'w'], ['lafc', 'los angeles fc', 'm'], ['nycfc', 'new york city fc', 'm'],
  ['inter miami', 'inter miami', 'm'], ['the red bulls', 'new york red bulls', 'm'], ['seattle sounders', 'seattle sounders', 'm'],
];
const LEAGUE_ALIASES: [string, string][] = [
  ['mls', 'usa-major-league-soccer'], ['major league soccer', 'usa-major-league-soccer'], ['nwsl', 'usa-nwsl-women'], ['usl championship', 'usa-usl-championship'],
  ['usl super league', 'usa-usl-super-league'], ['epl', 'england-premier-league'], ['premier league', 'england-premier-league'], ['wsl', 'england-fa-wsl'], ['fa wsl', 'england-fa-wsl'], ['concacaf nations league', 'concacaf-nations-league'], ['usl league one', 'usa-usl-league-one'],
  ['womens super league', 'england-fa-wsl'], ['la liga', 'spain-la-liga'], ['serie a', 'italy-serie-a'], ['bundesliga', 'germany-bundesliga'], ['ligue 1', 'france-ligue-1'],
  ['liga mx', 'mexico-liga-mx'], ['champions league', 'uefa-champions-league'], ['europa league', 'uefa-europa-league'], ['leagues cup', 'leagues-cup'],
  ['concacaf champions cup', 'concacaf-champions-league'], ['club world cup', 'fifa-club-world-cup'], ['world cup', 'world-cup'], ['gold cup', 'concacaf-gold-cup'],
  ['copa america', 'copa-america'], ['nations league', 'uefa-nations-league'], ['womens world cup', 'world-cup-women'],
];
// National teams by the names the US press uses. Linked only when the story is about national-team soccer (see NATIONAL_CONTEXT).
const NATIONAL_ALIASES: [string, string][] = [
  ['usmnt', 'usa'], ['us mens national team', 'usa'], ['us men', 'usa'], ['uswnt', 'usa-women'], ['us womens national team', 'usa-women'],
  ['lionesses', 'england-women'], ['three lions', 'england'], ['matildas', 'australia-women'], ['el tri', 'mexico'], ['canmnt', 'canada'], ['canwnt', 'canada-women'],
];
// Club names that are everyday words: never linked from one word, even capitalised (headlines capitalise everything).
const COMMON_WORDS = new Set(['start', 'ideal', 'team', 'elite', 'wake', 'viking', 'progress', 'victory', 'premier', 'champions', 'academy', 'future', 'hope', 'unity', 'glory', 'pride', 'power', 'energy', 'dynamic', 'atletico', 'deportivo', 'club', 'football', 'soccer', 'women', 'ladies', 'lions', 'tigers', 'eagles', 'stars', 'rangers', 'rovers', 'city', 'town', 'flames', 'rapids', 'storm', 'thunder', 'warriors', 'kings', 'royals', 'giants', 'titans', 'heroes', 'legends', 'spirit', 'phoenix', 'santos', 'brothers', 'friends', 'police', 'army', 'customs', 'electric', 'cement', 'gold', 'diamond', 'mining']);
const EDGE_FILLER = /^(at|of|the|vs|v|and|in|on|to|for|university|univ|mens|womens|soccer|u|no|\d+)$/;
const OPPONENT_BEFORE = new Set(['vs', 'v', 'versus', 'at', 'over', 'against', 'host', 'hosts', 'hosting', 'visit', 'visits', 'visiting', 'welcome', 'welcomes', 'beat', 'beats', 'past', 'top', 'tops', 'downs', 'down', 'edge', 'edges', 'face', 'faces', 'facing', 'blank', 'blanks', 'from', 'with', 'by']);
const NATIONAL_CONTEXT = /\b(national team|world cup|qualif|friendl(y|ies)|nations league|gold cup|copa america|olympic|international (break|window|duty)|camp|cap(s|ped)?\b|usmnt|uswnt|lionesses|three lions|matildas|el tri)/i;

/** Every row of news_team_index (the API returns at most 1,000 a request). */
export async function teamIndexRows(db: Db): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.rpc('news_team_index').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as any[]));
    if (!data || data.length < 1000) return out;
  }
}

export class EntityIndex {
  private teams = new Map<string, TeamRef[]>();
  private leagues = new Map<string, LeagueRef[]>();
  private programs = new Map<string, Map<string, string[]>>();
  private programById = new Map<string, ProgramRef>();
  private confs = new Map<string, ConfRef>();
  private nationals = new Map<string, TeamRef>();
  builtAt = 0;
  private maxWords = 5;

  static async build(db: Db): Promise<EntityIndex> {
    const ix = new EntityIndex();
    const [teams, leagues, programs, schools, conferences, memberships] = await Promise.all([
      teamIndexRows(db),
      selectAll<any>(db, 'pro_leagues', 'id,name,slug,priority,country,gender,scope', (q) => q.eq('enabled', true)),
      selectAll<any>(db, 'college_programs', 'id,school_seo,gender,name,short_name,name6'),
      selectAll<any>(db, 'college_schools', 'seo,name,long_name'),
      selectAll<any>(db, 'college_conferences', 'id,ncaa_seo,name,short_name'),
      selectAll<any>(db, 'college_program_seasons', 'program_id,conference_id', (q) => q.eq('season', currentSeason()).eq('ncaa_member', true)),
    ]);
    ix.load({ teams, leagues, programs, schools, conferences, memberships });
    return ix;
  }

  /** Fills the index from plain rows (tests build it this way). */
  load(d: { teams: any[]; leagues: any[]; programs: any[]; schools: any[]; conferences: any[]; memberships: { program_id: string; conference_id: string | null }[] }): this {
    const addTeam = (key: string, t: TeamRef) => { if (!key) return; const l = this.teams.get(key) ?? []; if (!l.some((x) => x.id === t.id)) l.push(t); this.teams.set(key, l); };
    const bySlug = new Map<string, TeamRef>();
    for (const r of d.teams) {
      const t: TeamRef = { id: r.id, label: r.display_name ?? r.name, slug: r.slug, gender: r.gender === 'w' ? 'w' : 'm', national: !!(r.is_national ?? r.national), country: r.country ?? null, priority: Number(r.priority ?? 999) };
      bySlug.set(t.slug, t);
      if (t.national) continue; // national sides are linked through NATIONAL_ALIASES and "<country> national team" only
      addTeam(fold(t.label), t);
      if (r.name && fold(r.name) !== fold(t.label) && !/ w$/i.test(r.name)) addTeam(fold(r.name), t);
    }
    for (const [alias, name, g] of TEAM_ALIASES) for (const t of this.teams.get(name) ?? []) if (!g || t.gender === g) addTeam(alias, t);
    for (const [alias, slug] of NATIONAL_ALIASES) { const t = bySlug.get(slug); if (t) this.nationals.set(alias, t); }
    for (const t of bySlug.values()) if (t.national) {
      const c = fold(t.label);
      if (t.gender === 'w') this.nationals.set(`${c} womens national team`, t);
      else { this.nationals.set(`${c} national team`, t); this.nationals.set(`${c} mens national team`, t); }
    }
    const leagueBySlug = new Map<string, LeagueRef>();
    for (const r of d.leagues) {
      const l: LeagueRef = { id: r.id, label: r.name, slug: r.slug, priority: Number(r.priority ?? 999), country: r.country ?? null, gender: r.gender ?? null, intl: r.scope === 'intl' };
      leagueBySlug.set(l.slug, l);
      const k = fold(l.label);
      if (k.split(' ').length < 2) continue; // one-word league names ("Bundesliga") come from the alias list
      this.leagues.set(k, [...(this.leagues.get(k) ?? []), l]);
    }
    for (const [alias, slug] of LEAGUE_ALIASES) { const l = leagueBySlug.get(slug); if (l) this.leagues.set(alias, [l]); }
    const schoolMap = new Map<string, AliasSchoolLike>(d.schools.map((s: any) => [s.seo, s]));
    const confOf = new Map(d.memberships.map((m) => [m.program_id, m.conference_id]));
    const members = new Set(d.memberships.map((m) => m.program_id));
    const progs = (d.programs as AliasProgramLike[]).filter((p) => members.has(p.id));
    for (const p of progs) this.programById.set(p.id, { id: p.id, label: schoolMap.get(p.school_seo)?.name ?? p.name, seo: p.school_seo, gender: p.gender === 'w' ? 'w' : 'm', conference: confOf.get(p.id) ?? null });
    this.programs = buildAliasIndex(progs, schoolMap, []);
    for (const c of d.conferences) {
      const ref: ConfRef = { id: c.id, label: c.short_name ?? c.name, seo: c.ncaa_seo };
      for (const n of [c.name, c.short_name]) if (n && fold(n).length > 2) this.confs.set(fold(n), ref);
    }
    this.builtAt = Date.now();
    return this;
  }

  program(id: string): ProgramRef | undefined { return this.programById.get(id); }

  /**
   * Teams, leagues, conferences and national teams named in the text. College names only for college stories; pro
   * clubs and leagues for pro and international ones. Longest name wins at each position, and its words are used up.
   */
  scan(text: string, scope: Scope, gender: 'm' | 'w' | null): Link[] {
    const w = words(text);
    // A one-word name must be written as a name (capitalised) somewhere in the story: "a fast start" is not Start FK.
    const capitalised = (word: string) => new RegExp(`(^|[^A-Za-z])${word[0]!.toUpperCase()}${word.slice(1)}([^A-Za-z]|$)`).test(stripDiacritics(text).replace(/['’`]/g, ''));
    const out: Link[] = [];
    const seen = new Set<string>();
    const add = (l: Link) => { const k = `${l.type}|${l.id}`; if (!seen.has(k)) { seen.add(k); out.push(l); } };
    const national = NATIONAL_CONTEXT.test(text);
    for (let i = 0; i < w.length; ) {
      let took = 0;
      for (let n = Math.min(this.maxWords, w.length - i); n >= 1 && !took; n -= 1) {
        const key = w.slice(i, i + n).join(' ');
        const one = n === 1;
        if (scope === 'college') {
          // The college name key drops filler words ("Indiana at" would read as "Indiana"): a phrase may not start or end with one.
          if (!one && (EDGE_FILLER.test(w[i]!) || EDGE_FILLER.test(w[i + n - 1]!))) continue;
          const ids = (gender ? [gender] : ['m', 'w']).flatMap((g) => this.programs.get(g)?.get(teamKey(key)) ?? []);
          const uniq = [...new Set(ids)];
          // One-word school names ("Liberty", "Williams", "Xavier") are also words and surnames: only after a word
          // that puts an opponent there ("vs Butler", "at Liberty", "hosts Kentucky").
          // The word before, skipping a ranking ("at No. 10 UCLA", "at #10 UCLA").
          let b = i - 1;
          while (b >= 0 && (/^\d+$/.test(w[b]!) || w[b] === 'no' || w[b] === 'rv')) b -= 1;
          const shortCode = key.length >= 3 && new RegExp(`(^|[^A-Za-z])${key.toUpperCase()}([^A-Za-z]|$)`).test(text);
          if (uniq.length && !(one && ((key.length < 4 && !shortCode) || !OPPONENT_BEFORE.has(w[b] ?? '') || !(capitalised(key) || shortCode)))) {
            // "Indiana" names both the men's and women's team: without a gender, link neither (the scope link covers school feeds).
            const pick = uniq.length === 1 ? uniq[0]! : null;
            const p = pick ? this.programById.get(pick) : undefined;
            if (p) { add({ type: 'program', id: p.id, label: p.label, href: `/teams/${p.seo}/${p.gender === 'w' ? 'women' : 'men'}`, method: 'exact', primary: false, gender: p.gender }); took = n; break; }
          }
          const c = this.confs.get(key);
          if (c && !one) { add({ type: 'conference', id: c.id, label: c.label, href: `/conferences/${c.seo}`, method: 'exact', primary: false }); took = n; break; }
          if (c && one && key.length >= 3 && /^(acc|sec|wac|asun|caa|maac|nec|swac|meac|big)$/.test(key)) { add({ type: 'conference', id: c.id, label: c.label, href: `/conferences/${c.seo}`, method: 'exact', primary: false }); took = n; break; }
          continue;
        }
        const nat = this.nationals.get(key);
        if (nat && (national || !one) && (!gender || nat.gender === gender || /women|wnt|lionesses|matildas/.test(key))) {
          add({ type: 'pro_team', id: String(nat.id), label: `${nat.label}${nat.gender === 'w' ? ' (women)' : ''}`, href: `/intl/teams/${nat.slug}`, method: 'exact', primary: false, gender: nat.gender, national: true, intl: true, country: nat.country, priority: nat.priority });
          took = n; break;
        }
        const lg = this.leagues.get(key);
        if (lg && !one) {
          const best = [...lg].sort((a, b) => a.priority - b.priority)[0]!;
          add({ type: 'pro_league', id: String(best.id), label: best.label, href: `${best.intl ? '/intl/tournaments' : '/pro/leagues'}/${best.slug}`, method: 'exact', primary: false, country: best.country, priority: best.priority, intl: best.intl });
          took = n; break;
        }
        if (lg && one) { const best = lg[0]!; add({ type: 'pro_league', id: String(best.id), label: best.label, href: `${best.intl ? '/intl/tournaments' : '/pro/leagues'}/${best.slug}`, method: 'exact', primary: false, country: best.country, priority: best.priority, intl: best.intl }); took = n; break; }
        const tl = this.teams.get(key);
        if (tl && !(one && (WEAK_ONE_WORD.has(key) || COMMON_WORDS.has(key) || key.length < 4 || !capitalised(key)))) {
          const g = gender ?? null;
          const cands = tl.filter((t) => !g || t.gender === g).sort((a, b) => a.priority - b.priority);
          // Same name in two places: the club in the clearly bigger league, or nothing.
          const t = cands.length === 1 ? cands[0] : cands.length > 1 && cands[0]!.priority <= 60 && cands[1]!.priority - cands[0]!.priority >= 40 ? cands[0] : g === null && cands.length === 2 && cands[0]!.gender !== cands[1]!.gender ? cands.find((x) => x.gender === 'm') : undefined;
          if (t) { add({ type: 'pro_team', id: String(t.id), label: t.label, href: `/pro/teams/${t.slug}`, method: 'exact', primary: false, gender: t.gender, country: t.country, priority: t.priority }); took = n; break; }
        }
      }
      i += took || 1;
    }
    // "Newcastle" next to "Newcastle United": the one-word name is the same club said short, or a namesake. Keep the full one.
    return out.filter((l) => !(l.type === 'pro_team' && !l.national && !l.label.includes(' ') && out.some((o) => o !== l && o.type === 'pro_team' && o.label.toLowerCase().startsWith(`${l.label.toLowerCase()} `))));
  }
}

/** Person names in the original text: two or three capitalised words in a row ("Christian Pulisic", "Ali Krieger"). */
export function personCandidates(text: string): { first: string; last: string; key: string; display: string }[] {
  const out = new Map<string, { first: string; last: string; key: string; display: string }>();
  const cap = "(?:[A-ZÀ-Ý][a-zà-ÿ'’]+(?:-[A-ZÀ-Ý][a-zà-ÿ'’]+)?|Mc[A-Z][a-z]+|Mac[A-Z][a-z]+|O'[A-Z][a-z]+)";
  const re = new RegExp(`\\b(${cap})\\s+((?:(?:de|da|van|von|der|del|dos|la|le)\\s+)?${cap}(?:\\s+${cap})?)`, 'g');
  for (const m of text.matchAll(re)) {
    const first = m[1]!, last = m[2]!.replace(/['’]s$/, '');
    if (STOP_FIRST.has(first.toLowerCase())) continue;
    for (const l of [last, last.split(/\s+/)[0]!]) {
      const key = nameKey(first, l);
      if (key.split('|').every((x) => x.length >= 2)) out.set(key, { first, last: l, key, display: `${first} ${l}` });
    }
  }
  return [...out.values()];
}
// Capitalised words that start headlines but are not first names.
const STOP_FIRST = new Set(['the', 'no', 'how', 'why', 'what', 'who', 'when', 'after', 'before', 'with', 'from', 'as', 'at', 'in', 'on', 'for', 'and', 'but', 'women', 'men', 'mens', 'womens', 'senior', 'head', 'coach', 'manager', 'transfer', 'injury', 'match', 'player', 'premier', 'champions', 'world', 'big', 'new', 'old', 'west', 'east', 'north', 'south', 'san', 'los', 'las', 'fc', 'cf', 'real', 'inter', 'saint', 'st', 'notre', 'boston', 'penn', 'wake', 'ohio', 'texas', 'florida', 'north', 'man', 'live', 'watch', 'preview', 'report', 'recap', 'week', 'day', 'game', 'final', 'semifinal', 'quarterfinal']);

export interface PersonHit { type: 'pro_player' | 'college_player'; id: string; label: string; href: string; key: string; teamIds: string[]; american?: boolean; gender?: string | null }

/** Looks the candidate keys up: pro players we show (or Americans), and college players on a roster this season or last. */
export async function lookupPeople(db: Db, keys: string[], scope: Scope): Promise<Map<string, PersonHit[]>> {
  const out = new Map<string, PersonHit[]>();
  if (!keys.length) return out;
  const add = (h: PersonHit) => out.set(h.key, [...(out.get(h.key) ?? []), h]);
  for (let i = 0; i < keys.length; i += 300) {
    const chunk = keys.slice(i, i + 300);
    if (scope === 'college') {
      const { data } = await db.from('college_players').select('id,display_name,slug,name_key,college_player_seasons(program_id,season)').in('name_key', chunk).eq('suppress', false);
      const minSeason = currentSeason() - 1;
      for (const r of (data ?? []) as any[]) {
        const teams = [...new Set(((r.college_player_seasons ?? []) as any[]).filter((s) => s.season >= minSeason).map((s) => s.program_id as string))];
        if (!teams.length) continue;
        add({ type: 'college_player', id: r.id, label: r.display_name, href: `/players/${r.slug ?? r.id}`, key: r.name_key, teamIds: teams });
      }
    } else {
      const { data } = await db.from('pro_players').select('id,display_name,slug,name_key,current_team_id,american,indexable,minutes_recent,gender').in('name_key', chunk);
      for (const r of (data ?? []) as any[]) {
        if (!r.slug || !(r.indexable || r.american || Number(r.minutes_recent) > 0)) continue;
        add({ type: 'pro_player', id: String(r.id), label: r.display_name, href: `/pro/players/${r.slug}`, key: r.name_key, teamIds: r.current_team_id ? [String(r.current_team_id)] : [], american: !!r.american, gender: r.gender ?? null });
      }
    }
  }
  return out;
}

/**
 * The people of a story: a name links when exactly one person we show has it, or when one of the people with it plays
 * for a team the story already links (or the source's own team). Ambiguous names are left unlinked.
 */
export function resolvePeople(cands: { key: string }[], hits: Map<string, PersonHit[]>, teamIds: Set<string>): (PersonHit & { method: 'exact' | 'context' })[] {
  const out: (PersonHit & { method: 'exact' | 'context' })[] = [];
  const seen = new Set<string>();
  for (const c of cands) {
    const list = hits.get(c.key) ?? [];
    if (!list.length) continue;
    const onTeam = list.filter((h) => h.teamIds.some((t) => teamIds.has(t)));
    const pick = onTeam.length === 1 ? { ...onTeam[0]!, method: 'context' as const } : list.length === 1 ? { ...list[0]!, method: 'exact' as const } : null;
    if (pick && !seen.has(pick.id)) { seen.add(pick.id); out.push(pick); }
  }
  return out;
}
