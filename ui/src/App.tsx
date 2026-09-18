import { Suspense, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, clearToken, useAdmin } from './lib/api';
import { FiltersProvider } from './lib/filters';
import { BottomBar, Footer, TopBar, useFocusMain } from './components/shell';
import { Skeleton } from './components/primitives';

export default function App() {
  const admin = useAdmin();
  // /api/meta is public, so probe an admin-only route to notice a secret that has been rotated away.
  const check = useQuery({ queryKey: ['admin-check'], queryFn: () => api('/api/runs?limit=1'), enabled: admin, retry: false, staleTime: 5 * 60_000 });
  const rejected = check.error instanceof ApiError && check.error.status === 401;
  useEffect(() => { if (rejected) clearToken(); }, [rejected]);
  useFocusMain();
  return (
    <FiltersProvider>
      <a href="#main" className="sr-only-focusable">Skip to content</a>
      <div className="flex min-h-[100dvh] flex-col">
        <TopBar />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-page flex-1 px-4 pb-24 pt-5 outline-none sm:px-6 md:pb-6">
          <Suspense fallback={<div className="space-y-4" aria-busy="true"><Skeleton className="h-8 w-64" /><Skeleton lines={3} /><Skeleton className="h-64" /></div>}>
            <Outlet />
          </Suspense>
        </main>
        <Footer />
        <BottomBar />
      </div>
    </FiltersProvider>
  );
}
