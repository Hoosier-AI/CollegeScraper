// Linking a story to our pages, by rules (no AI). Teams, leagues and conferences are matched in memory against the
// story's words (longest name first); people are looked up in the database by name key, and only linked when the
// name is unique among people we show or their team is in the same story. One-word names never link a person.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
interface ProgramRef { id: string; label: string; seo: string; gender: 'm' | 'w'; conference: string | null; division: number | null }
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
// Capitalised words after a team's name that are a day, a month, part of a place or the rest of a club's name, never a
// surname ("Charlotte Thursday", "Leeds United", "Brighton & Hove Albion").
const NOT_SURNAME = new Set(['united', 'town', 'rovers', 'rangers', 'wanderers', 'athletic', 'albion', 'hove', 'hotspur', 'villa', 'palace', 'forest', 'argyle', 'orient', 'academical', 'thistle', 'celtic', 'dons', 'harriers', 'borough', 'vale', 'alexandra', 'stanley', 'galaxy', 'crew', 'union', 'revolution', 'dynamo', 'sounders', 'timbers', 'whitecaps', 'rapids', 'earthquakes', 'independence', 'battery', 'legion', 'hearts', 'ladies', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'university', 'college', 'state', 'soccer', 'football', 'women', 'womens', 'men', 'mens', 'stadium', 'field', 'park', 'arena', 'center', 'centre', 'complex', 'area', 'region', 'regional', 'tournament', 'cup', 'league', 'conference', 'international', 'airport', 'city', 'county', 'the', 'and']);

/** "PITTSBURGH, Pa. – A two-goal…", "Colorado Springs, Colo. — UC Davis…": where the story was written, not a team in it. */
const DATELINE = /^\s*[A-Z][A-Za-z.'’-]*(?: [A-Z][A-Za-z.'’-]*){0,3}(?:,\s*[A-Z][A-Za-z.]{1,6})?\s+[-–—]{1,2}\s+/;
export const withoutDateline = (lede: string) => lede.replace(DATELINE, '');

/** First names of 15+ of our players (data/first-names.json, built by scripts/build-first-names.mjs). */
let firstNames: Set<string> | null = null;
function isFirstName(word: string): boolean {
  if (!firstNames) {
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const file = [resolve(here, '../../data/first-names.json'), resolve(process.cwd(), 'data/first-names.json')].find((f) => { try { readFileSync(f); return true; } catch { return false; } });
      firstNames = new Set(file ? (JSON.parse(readFileSync(file, 'utf8')) as string[]) : []);
    } catch { firstNames = new Set(); }
  }
  return firstNames.has(word.toLowerCase());
}

// A full stop after an abbreviation ("St. Louis", "No. 20", "Pa.", "N.C.", "Oct.") or a space ("vs . St . Louis") does not end the sentence.
const ABBREV = 'St|Ste|Mt|Ft|No|Nos|Dr|Jr|Sr|Mr|Mrs|Ms|vs|Univ|Ave|Jan|Feb|Mar|Apr|Aug|Sept?|Oct|Nov|Dec|Ala|Ariz|Ark|Calif|Colo|Conn|Del|Fla|Ga|Ida|Ill|Ind|Kan|Kans|Ky|La|Md|Mass|Me|Mich|Minn|Miss|Mo|Mont|Neb|Nev|Okla|Ore|Pa|Penn|Tenn|Tex|Va|Vt|Wash|Wis|Wyo|[A-Z]|[ap]\\.m';
const SENTENCE_END = new RegExp(`(?<!\\s|\\b(?:${ABBREV}))[.!?]\\s+`);

interface Casing { cased: string[]; sentence: number[]; prose: boolean[]; spaced: boolean[] }
/**
 * Per word of `words(text)`: its spelling as written, its sentence, whether that sentence is written in sentence case
 * (a lede) rather than title case (a headline capitalises every word, so a capital there says nothing), and whether
 * only spaces separate it from the next word ("Liverpool, Chelsea" and "Napoli-Roma" are two names, not one).
 */
function casing(text: string, count: number): Casing | null {
  const out: Casing = { cased: [], sentence: [], prose: [], spaced: [] };
  stripDiacritics(text).replace(/['’`]/g, '').split(SENTENCE_END).forEach((s, n) => {
    const t = [...s.matchAll(/[A-Za-z0-9]+/g)];
    const long = t.slice(1).map((m) => m[0]).filter((x) => /^[A-Za-z]{4,}$/.test(x));
    const prose = long.length >= 3 && long.filter((x) => /^[A-Z]/.test(x)).length / long.length < 0.7;
    t.forEach((m, k) => {
      const next = t[k + 1];
      out.cased.push(m[0]); out.sentence.push(n); out.prose.push(prose);
      out.spaced.push(!!next && /^ +$/.test(s.slice(m.index! + m[0].length, next.index)));
    });
  });
  return out.cased.length === count ? out : null; // a letter that splits differently once lower-cased: no casing rules
}

/**
 * The word at `i` is part of a person's name: a first name followed by a surname ("from Charlotte Hansen", "Charlotte
 * Ferguson was called into action"), or after a first name when the pair is a person we know. In a headline only a
 * person we know by that name counts; in a lede a common first name before a capitalised word does ("the visiting
 * Stanford Cardinal" is the team: Stanford is not a first name).
 */
function personWord(c: Casing | null, i: number, people?: Set<string>): boolean {
  if (!c) return false;
  const next = c.cased[i + 1];
  if (next && c.spaced[i] && /^[A-Z][a-z]/.test(next) && !NOT_SURNAME.has(next.toLowerCase()) && ((c.prose[i] && isFirstName(c.cased[i]!)) || people?.has(nameKey(c.cased[i]!, next)))) return true;
  return i > 0 && c.spaced[i - 1]! && !!people?.has(nameKey(c.cased[i - 1]!, c.cased[i]!));
}

/**
 * Why a stored link to a team looks wrong, for the quality check: the team's one-word name is only in the story as a
 * person's first name (or surname of a person we linked), or only in the dateline. Null when it reads as a team.
 */
export function suspectTeamLink(title: string, matchText: string, label: string, linkedPeople: string[] = []): 'name' | 'dateline' | null {
  const name = fold(label.replace(/\s*\((men|women)\)\s*$/i, ''));
  if (!name || name.includes(' ')) return null;
  const text = `${title}. ${withoutDateline(matchText.slice(title.length + 2))}`; // match_text is "<title>. <lede>
  const w = words(text);
  const at = w.flatMap((x, i) => (x === name ? [i] : []));
  if (!at.length) return words(matchText).includes(name) ? 'dateline' : null;
  const c = casing(text, w.length);
  const people = new Set(linkedPeople.map((p) => { const [f, ...l] = p.split(/\s+/); return nameKey(f ?? '', l.join(' ')); }));
  return at.every((i) => personWord(c, i, people)) ? 'name' : null;
}

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
  private sharedNames = new Set<string>();
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
      selectAll<any>(db, 'college_program_seasons', 'program_id,conference_id,division', (q) => q.eq('season', currentSeason()).eq('ncaa_member', true)),
    ]);
    ix.load({ teams, leagues, programs, schools, conferences, memberships });
    return ix;
  }

  /** Fills the index from plain rows (tests build it this way). */
  load(d: { teams: any[]; leagues: any[]; programs: any[]; schools: any[]; conferences: any[]; memberships: { program_id: string; conference_id: string | null; division?: string | null }[] }): this {
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
    const divOf = new Map(d.memberships.map((m) => [m.program_id, Number(/^d([123])$/.exec(m.division ?? '')?.[1]) || null]));
    const members = new Set(d.memberships.map((m) => m.program_id));
    const progs = (d.programs as AliasProgramLike[]).filter((p) => members.has(p.id));
    for (const p of progs) this.programById.set(p.id, { id: p.id, label: schoolMap.get(p.school_seo)?.name ?? p.name, seo: p.school_seo, gender: p.gender === 'w' ? 'w' : 'm', conference: confOf.get(p.id) ?? null, division: divOf.get(p.id) ?? null });
    this.programs = buildAliasIndex(progs, schoolMap, []);
    // "Northwestern" is also the start of "Northwestern-St. Paul", "Cornell" of "Cornell College".
    const labels = new Set([...this.programById.values()].map((p) => fold(p.label)));
    for (const l of labels) { const w = l.split(' '); for (let j = 1; j < w.length; j += 1) if (labels.has(w.slice(0, j).join(' '))) this.sharedNames.add(w.slice(0, j).join(' ')); }
    for (const c of d.conferences) {
      const ref: ConfRef = { id: c.id, label: c.short_name ?? c.name, seo: c.ncaa_seo };
      for (const n of [c.name, c.short_name]) if (n && fold(n).length > 2) this.confs.set(fold(n), ref);
    }
    this.builtAt = Date.now();
    return this;
  }

  program(id: string): ProgramRef | undefined { return this.programById.get(id); }
  /** Another program's name starts with this one's, so the plain name may mean either. */
  sharedName(id: string): boolean { const p = this.programById.get(id); return !!p && this.sharedNames.has(fold(p.label)); }

  /**
   * Teams, leagues, conferences and national teams named in the text. College names only for college stories; pro
   * clubs and leagues for pro and international ones. Longest name wins at each position, and its words are used up.
   * `people` holds the name keys of people we know who are named in the story: their names are never read as teams.
   */
  scan(text: string, scope: Scope, gender: 'm' | 'w' | null, people?: Set<string>): Link[] {
    const w = words(text);
    const cs = casing(text, w.length);
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
        // A name never runs from the headline into the lede ("…Against UMass." + "Dartmouth men's soccer…").
        if (!one && cs && cs.sentence[i] !== cs.sentence[i + n - 1]) continue;
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
          if (cs && cs.sentence[b] !== cs.sentence[i]) b = -1; // "…NPI Top 10." is not an opponent word for the lede's first team
          const shortCode = key.length >= 3 && new RegExp(`(^|[^A-Za-z])${key.toUpperCase()}([^A-Za-z]|$)`).test(text);
          if (uniq.length && !(one && ((key.length < 4 && !shortCode) || !OPPONENT_BEFORE.has(w[b] ?? '') || !(capitalised(key) || shortCode) || personWord(cs, i, people)))) {
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
        if (tl && !(one && (WEAK_ONE_WORD.has(key) || COMMON_WORDS.has(key) || key.length < 4 || !capitalised(key) || personWord(cs, i, people)))) {
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
