// The site's three halves: College (/), Pro (/pro: club football) and International (/intl: national teams). Pro and
// International share their pages (a tournament, team, player or match page is the same component) and their links:
// a link built on an International page goes to /intl, one on a Pro page to /pro. The shell sets which before the
// page renders; a page whose data says it belongs to the other half moves there (useSectionHome).
import { useLocation } from 'react-router-dom';

export type Section = 'college' | 'pro' | 'intl';
export const isIntlPath = (path: string) => path === '/intl' || path.startsWith('/intl/');
export const isProPath = (path: string) => path === '/pro' || path.startsWith('/pro/');
export const sectionOf = (path: string): Section => (isIntlPath(path) ? 'intl' : isProPath(path) ? 'pro' : 'college');

let linkSection: 'pro' | 'intl' = 'pro';
/** Called by the shell on every render, before the page: the half that pro links point into. */
export function setLinkSection(path: string): void { linkSection = isIntlPath(path) ? 'intl' : 'pro'; }
export const currentLinkSection = () => linkSection;

export function useSection(): Section {
  return sectionOf(useLocation().pathname);
}

/** The JSON behind a list page of either half (/api/pro/matches or /api/intl/matches). */
export const listApi = (section: Section, path: string) => `/api/${section === 'intl' ? 'intl' : 'pro'}/${path}`;
