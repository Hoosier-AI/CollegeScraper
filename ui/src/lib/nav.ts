// One menu for every area (2026-10-14): the same slots in the same order with the same icons, so a visitor who
// learns College knows where to look on Pro and International. The competitions slot takes the area's own word
// (Conferences, Leagues, Tournaments); pages only one area has sit under More. The header, the phone bar and its
// More sheet all read this table.
import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, BarChart3, CalendarDays, Globe, GraduationCap, Medal, Newspaper, Shield, Swords, Trophy, Users, Map as MapIcon } from 'lucide-react';
import type { Section } from './section';

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
    ],
  },
  pro: {
    slots: [
      slot('matches', '/pro/matches', 'Matches'),
      slot('competitions', '/pro/leagues', 'Leagues'),
      slot('teams', '/pro/teams', 'Teams'),
      slot('players', '/pro/players', 'Players'),
      slot('leaders', '/pro/leaders', 'Leaders'),
      slot('news', '/pro/news', 'News'),
    ],
    more: [
      { key: 'abroad', to: '/pro/abroad', label: 'Americans abroad', icon: Globe, hint: 'Americans at clubs outside the US' },
      { key: 'college', to: '/pro/college', label: 'College to Pro', icon: GraduationCap, hint: 'Pros by the college they played for' },
      { key: 'transfers', to: '/pro/transfers', label: 'Transfers', icon: ArrowLeftRight, hint: 'The latest moves in and out of US clubs' },
      { key: 'compare', to: '/pro/compare', label: 'Compare players', icon: Users, hint: 'Two players side by side' },
      { key: 'h2h', to: '/pro/h2h', label: 'Head to head', icon: Swords, hint: 'Every meeting between two clubs' },
      { key: 'countries', to: '/pro/countries', label: 'Countries', icon: MapIcon, hint: 'Each country\'s leagues, clubs and players' },
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

/** The first three slots stay on the header from the md breakpoint; the rest join More until there is room
 *  (lg shows five, 2xl all). The class hides a slot on the header bar, or its copy in More, at the right width. */
export const slotBarClass = (i: number) => (i < 3 ? 'flex' : i < 5 ? 'hidden lg:flex' : 'hidden 2xl:flex');
export const slotMoreClass = (i: number) => (i < 3 ? 'hidden' : i < 5 ? 'lg:hidden' : '2xl:hidden');

/** The phone bar: Home, then the same four on every area (Matches, the competitions slot, Teams) and More. */
export const PHONE_SLOTS: SlotKey[] = ['matches', 'competitions', 'teams'];

/** Whether a path sits under a menu item: the item itself or a page inside it (/pro/teams/x lights Teams). */
export const under = (path: string, to: string) => path === to || path.startsWith(`${to}/`);

/** The menu item a path belongs to, for the More button's lit state and crumbs. */
export function navItemFor(area: Section, path: string): NavItem | null {
  const n = AREA_NAV[area];
  return [...n.slots, ...n.more].find((i) => under(path, i.to)) ?? null;
}
