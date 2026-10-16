import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, clearToken, useAdmin } from './lib/api';
import { FiltersProvider } from './lib/filters';
import { BottomBar, Footer, TopBar, useFocusMain } from './components/shell';
import { Skeleton } from './components/primitives';
import { AdRail } from './components/AdRail';
import { AdSlot } from './components/AdSlot';
import { SponsorLine } from './components/SponsorLine';
import { removeServerSummary } from './lib/entity';
import { trackView } from './lib/track';
import { setLinkSection } from './lib/section';

export default function App() {
  const admin = useAdmin();
  const { pathname } = useLocation();
  // Before the page renders: Pro and International share their pages, and their links follow the half the reader is in.
  setLinkSection(pathname);
  // /api/meta is public, so probe an admin-only route to notice a secret that has been rotated away.
  const check = useQuery({ queryKey: ['admin-check'], queryFn: () => api('/api/runs?limit=1'), enabled: admin, retry: false, staleTime: 5 * 60_000 });
  const rejected = check.error instanceof ApiError && check.error.status === 401;
  useEffect(() => { if (rejected) clearToken(); }, [rejected]);
  useFocusMain();
  // The server-rendered summary is for crawlers and the first paint; the app replaces it as soon as it mounts.
  useEffect(() => { removeServerSummary(); }, []);
  // Site analytics: a page view on every page change (query strings are not sent).
  useEffect(() => { trackView(pathname); }, [pathname]);
  return (
    <FiltersProvider>
      <a href="#main" className="sr-only-focusable">Skip to content</a>
      <div className="flex min-h-[100dvh] flex-col">
        <TopBar />
        <SponsorLine />
        {/* From 1600px wide: a 160px rail on each side for advertising (components/AdRail.tsx). */}
        <div className="mx-auto w-full max-w-page flex-1 px-4 sm:px-6 rails:grid rails:grid-cols-[160px_minmax(0,1fr)_160px] rails:gap-6">
          <AdRail side="left" />
          <main id="main" tabIndex={-1} className="min-w-0 pb-24 pt-5 outline-none md:pb-6">
            <Suspense fallback={<div className="space-y-4" aria-busy="true"><Skeleton className="h-8 w-64" /><Skeleton lines={3} /><Skeleton className="h-64" /></div>}>
              <Outlet />
            </Suspense>
          </main>
          <AdRail side="right" />
        </div>
        {/* One ad above the footer on every screen size while ads are on; a new unit for each page. */}
        <AdSlot key={pathname} slot="inline" className="mx-auto mt-10 w-full max-w-page px-4 sm:px-6" />
        <Footer />
        <BottomBar />
      </div>
    </FiltersProvider>
  );
}
