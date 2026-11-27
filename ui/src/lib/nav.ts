// One menu for every area (2026-10-14): the same slots in the same order with the same icons, so a visitor who
// learns College knows where to look on Pro and International. The competitions slot takes the area's own word
// (Conferences, Leagues, Tournaments); pages only one area has sit under More. The header, the phone bar and its
// More sheet all read this table.
import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, BarChart3, CalendarDays, Flag, Star, Network, Flame, Globe, GraduationCap, Medal, Newspaper, Shield, Swords, Trophy, Users, Map as MapIcon, Tv } from 'lucide-react';
import type { Section } from './section';
import { isNative } from './platform';

export type SlotKey = 'matches' | 'competitions' | 'teams' | 'players' | 'leaders' | 'rankings' | 'news';
export interface NavItem { key: string; to: string; label: string; icon: LucideIcon; /** One line for the More sheet. */ hint?: string }

const SLOT_ICON: Record<SlotKey, LucideIcon> = { matches: CalendarDays, competitions: Trophy, teams: Shield, players: Users, leaders: BarChart3, rankings: Medal, news: Newspaper };
const slot = (key: SlotKey, to: string, label: string): NavItem => ({ key, to, label, icon: SLOT_ICON[key] });

export const AREA_LABEL: Record<Section, string> = { college: 'College', pro: 'Pro', intl: 'International' };

export const AREA_NAV: Record<Section, { slots: NavItem[]; more: NavItem[] }> = {
  college: {
    slots: [
      slot('matches', '/matches', 'Matches'),
      slot('competitions', '/conferences', 'Conferences'),
      slot('teams', '/teams', 'Teams'),
      slot('players', '/players', 'Players'),
      slot('leaders', '/leaders', 'Leaders'),
      slot('rankings', '/rankings', 'Rankings'),
      slot('news', '/news', 'News'),
    ],
    more: [
      { key: 'transfers', to: '/transfers', label: 'Transfers', icon: ArrowLeftRight, hint: 'Players at a new school this season' },
      { key: 'compare', to: '/compare', label: 'Compare players', icon: Users, hint: 'Two players side by side' },
      { key: 'h2h', to: '/h2h', label: 'Head to head', icon: Swords, hint: 'Every meeting between two teams' },
      { key: 'tournament', to: '/tournament', label: 'NCAA tournament', icon: Network, hint: 'The bracket, conference tournaments and the odds' },
      { key: 'records', to: '/records', label: 'Records and streaks', icon: Flame, hint: 'Runs still going and the best games this season' },
      { key: 'totw', to: '/team-of-the-week', label: 'Team of the week', icon: Star, hint: 'The best-rated XI of each week' },
      { key: 'tv', to: '/tv', label: 'On TV', icon: Tv, hint: 'Games on TV and streaming this week' },
      { key: 'referees', to: '/referees', label: 'Referees', icon: Flag, hint: 'Cards, fouls and penalty kicks a game by referee' },
    ],
  },
  pro: {
    slots: [
      slot('matches', '/pro/matches', 'Matches'),
      slot('competitions', '/pro/leagues', 'Leagues'),
      slot('teams', '/pro/teams', 'Teams'),
      slot('players', '/pro/players', 'Players'),
      slot('leaders', '/pro/leaders', 'Leaders'),
      slot('rankings', '/pro/rankings', 'Rankings'),
      slot('news', '/pro/news', 'News'),
    ],
    more: [
      { key: 'abroad', to: '/pro/abroad', label: 'Americans abroad', icon: Globe, hint: 'Americans at clubs outside the US' },
      { key: 'college', to: '/pro/college', label: 'College to Pro', icon: GraduationCap, hint: 'Pros by the college they played for' },
      { key: 'transfers', to: '/pro/transfers', label: 'Transfers', icon: ArrowLeftRight, hint: 'The latest moves in and out of US clubs' },
      { key: 'compare', to: '/pro/compare', label: 'Compare players', icon: Users, hint: 'Two players side by side' },
      { key: 'h2h', to: '/pro/h2h', label: 'Head to head', icon: Swords, hint: 'Every meeting between two clubs' },
      { key: 'countries', to: '/pro/countries', label: 'Countries', icon: MapIcon, hint: 'Each country\'s leagues, clubs and players' },
      { key: 'referees', to: '/pro/referees', label: 'Referees', icon: Flag, hint: 'Cards, penalties and VAR checks by referee' },
    ],
  },
  intl: {
    slots: [
      slot('matches', '/intl/matches', 'Matches'),
      slot('competitions', '/intl/tournaments', 'Tournaments'),
      slot('teams', '/intl/teams', 'Teams'),
      slot('players', '/intl/players', 'Players'),
      slot('leaders', '/intl/leaders', 'Leaders'),
      slot('rankings', '/intl/rankings', 'Rankings'),
      slot('news', '/intl/news', 'News'),
    ],
    more: [
      { key: 'h2h', to: '/intl/h2h', label: 'Head to head', icon: Swords, hint: 'Every meeting between two nations' },
    ],
  },
};

/** The phone bar (2026-11 redesign): the same five on every page. Scores, My teams, Competitions and Stats, then More.
 *  Competitions and Stats open the current area's own page (conferences, leagues or tournaments; that area's leaders). */
export function phoneBar(area: Section): (NavItem & { lit: string[] })[] {
  const s = Object.fromEntries(AREA_NAV[area].slots.map((x) => [x.key, x.to])) as Record<SlotKey, string>;
  return [
    { key: 'scores', to: '/', label: 'Scores', icon: CalendarDays, lit: [s.matches] },
    { key: 'following', to: '/following', label: 'My teams', icon: Star, lit: ['/following'] },
    { key: 'competitions', to: s.competitions, label: 'Competitions', icon: Trophy, lit: [s.competitions, ...(area === 'college' ? ['/tournament'] : [])] },
    { key: 'stats', to: s.leaders, label: 'Stats', icon: BarChart3, lit: [s.leaders, s.players, s.rankings] },
  ];
}
/** What the phone's More sheet lists from the area's slots (the rest are on the bar). */
export const SHEET_SLOTS: SlotKey[] = ['matches', 'teams', 'players', 'rankings', 'news'];
/** About and legal: in the footer on wide screens, in the More sheet on phones. */
const ALL_ABOUT_LINKS: [string, string][] = [['/about', 'About'], ['/contact', 'Contact'], ['/corrections', 'Report an error'], ['/sources', 'Credits'], ['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/privacy-choices', 'Privacy choices'], ['/copyright', 'Copyright'], ['/accessibility', 'Accessibility'], ['/data-use', 'Data use'], ['/advertise', 'Advertise']];
/** The phone app has no ads, so no page about buying them and none about ad choices. */
const WEB_ONLY_ABOUT = ['/advertise', '/privacy-choices'];
export const ABOUT_LINKS: [string, string][] = isNative ? ALL_ABOUT_LINKS.filter(([to]) => !WEB_ONLY_ABOUT.includes(to)) : ALL_ABOUT_LINKS;

/** Whether a path sits under a menu item: the item itself or a page inside it (/pro/teams/x lights Teams). */
export const under = (path: string, to: string) => path === to || path.startsWith(`${to}/`);

/** The menu item a path belongs to, for the More button's lit state and crumbs. */
export function navItemFor(area: Section, path: string): NavItem | null {
  const n = AREA_NAV[area];
  return [...n.slots, ...n.more].find((i) => under(path, i.to)) ?? null;
}
