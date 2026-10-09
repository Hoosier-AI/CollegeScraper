import React, { lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useParams } from 'react-router-dom';
import './index.css';
import App from './App';
import { NotFound, RouteError } from './components/shell';
import { RequireAdmin } from './pages/Admin';

// Each page is its own chunk so the first paint only loads what the visitor asked for.
const Home = lazy(() => import('./pages/Home'));
const Teams = lazy(() => import('./pages/Teams'));
const Team = lazy(() => import('./pages/Team'));
const Match = lazy(() => import('./pages/Match'));
const Matches = lazy(() => import('./pages/Matches'));
const Player = lazy(() => import('./pages/Player'));
const Conference = lazy(() => import('./pages/Conference'));
const Rankings = lazy(() => import('./pages/Rankings'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const Admin = lazy(() => import('./pages/Admin'));
const Console = lazy(() => import('./pages/Console'));
// Plaibook Stats Pro.
const ProHome = lazy(() => import('./pages/pro/ProHome'));
const ProMatches = lazy(() => import('./pages/pro/ProMatches'));
const ProLeagues = lazy(() => import('./pages/pro/ProLeagues'));
const ProLeague = lazy(() => import('./pages/pro/ProLeague'));
const ProTeam = lazy(() => import('./pages/pro/ProTeam'));
const ProPlayer = lazy(() => import('./pages/pro/ProPlayer'));
const ProMatch = lazy(() => import('./pages/pro/ProMatch'));
const ProDirectory = lazy(() => import('./pages/pro/ProDirectory'));
const ProCountries = lazy(() => import('./pages/pro/ProCountries').then((m) => ({ default: m.ProCountries })));
const ProCountry = lazy(() => import('./pages/pro/ProCountries').then((m) => ({ default: m.ProCountry })));
const ProCompare = lazy(() => import('./pages/pro/ProCompare'));
const ProTransfers = lazy(() => import('./pages/pro/ProTransfers'));
const ProCollege = lazy(() => import('./pages/pro/ProCollege'));

// A deploy replaces the chunk files; a page opened before it would fail to load the next chunk. Reload once.
window.addEventListener('vite:preloadError', (e) => {
  const key = 'chunk-reloaded';
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  e.preventDefault();
  window.location.reload();
});

/** A moved page: the query string (season, gender, tab…) travels along. */
function Redirect({ to, extra, params: extraParams }: { to: (params: Record<string, string | undefined>) => string; extra?: string; params?: (p: Record<string, string | undefined>) => Record<string, string | undefined> }) {
  const params = useParams(); const { search } = useLocation();
  const more = extraParams ? Object.entries(extraParams(params)).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&') : '';
  const qs = [search.replace(/^\?/, ''), extra, more].filter(Boolean).join('&');
  return <Navigate to={`${to(params)}${qs ? `?${qs}` : ''}`} replace />;
}

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  {
    path: '/', element: <App />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Home /> },
          { path: 'teams', element: <Teams /> },
          { path: 'teams/:id', element: <Team /> },
          { path: 'teams/:school/:gender', element: <Team /> },
          { path: 'matches', element: <Matches /> },
          { path: 'matches/:id', element: <Match /> },
          { path: 'conferences', element: <Redirect to={() => '/rankings'} extra="view=standings" /> },
          { path: 'conferences/:id', element: <Conference /> },
          // Old addresses keep working.
          { path: 'games/:id', element: <Redirect to={(p) => `/matches/${p.id}`} /> },
          { path: 'standings', element: <Redirect to={() => '/rankings'} /> },
          { path: 'leaders', element: <Redirect to={() => '/rankings'} extra="view=leaders" /> },
          { path: 'players/:id', element: <Player /> },
          { path: 'rankings', element: <Rankings /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'admin', element: <Admin /> },
          { path: 'console', element: <RequireAdmin><Console /></RequireAdmin> },
          { path: 'jobs', element: <Redirect to={() => '/console'} extra="tab=jobs" /> },
          { path: 'quality', element: <Redirect to={() => '/console'} extra="tab=quality" /> },
          { path: 'pro', element: <ProHome /> },
          { path: 'pro/matches', element: <ProMatches /> },
          { path: 'pro/matches/:slug', element: <ProMatch /> },
          { path: 'pro/leagues', element: <ProLeagues /> },
          { path: 'pro/leagues/:slug', element: <ProLeague /> },
          { path: 'pro/teams/:slug', element: <ProTeam /> },
          { path: 'pro/players/:slug', element: <ProPlayer /> },
          { path: 'pro/players', element: <ProDirectory key="players" mode="players" /> },
          { path: 'pro/leaders', element: <ProDirectory key="leaders" mode="leaders" /> },
          { path: 'pro/countries', element: <ProCountries /> },
          { path: 'pro/countries/:slug', element: <ProCountry /> },
          { path: 'pro/compare', element: <ProCompare /> },
          { path: 'pro/transfers', element: <ProTransfers /> },
          { path: 'pro/college', element: <ProCollege /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
