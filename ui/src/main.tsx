import React, { lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import App from './App';
import { NotFound, RouteError } from './components/shell';
import { RequireAdmin } from './pages/Admin';

// Each page is its own chunk so the first paint only loads what the visitor asked for.
const Home = lazy(() => import('./pages/Home'));
const Teams = lazy(() => import('./pages/Teams'));
const Team = lazy(() => import('./pages/Team'));
const Game = lazy(() => import('./pages/Game'));
const Player = lazy(() => import('./pages/Player'));
const Leaders = lazy(() => import('./pages/Leaders'));
const Standings = lazy(() => import('./pages/Standings'));
const Rankings = lazy(() => import('./pages/Rankings'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const Docs = lazy(() => import('./pages/Docs'));
const Admin = lazy(() => import('./pages/Admin'));
const Jobs = lazy(() => import('./pages/Jobs'));
const Quality = lazy(() => import('./pages/Quality'));

// A deploy replaces the chunk files; a page opened before it would fail to load the next chunk. Reload once.
window.addEventListener('vite:preloadError', (e) => {
  const key = 'chunk-reloaded';
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  e.preventDefault();
  window.location.reload();
});

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
          { path: 'games/:id', element: <Game /> },
          { path: 'players/:id', element: <Player /> },
          { path: 'leaders', element: <Leaders /> },
          { path: 'standings', element: <Standings /> },
          { path: 'rankings', element: <Rankings /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'docs', element: <Docs /> },
          { path: 'admin', element: <Admin /> },
          { path: 'jobs', element: <RequireAdmin><Jobs /></RequireAdmin> },
          { path: 'quality', element: <RequireAdmin><Quality /></RequireAdmin> },
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
