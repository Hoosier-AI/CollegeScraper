import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import App from './App';
import Teams from './pages/Teams';
import Team from './pages/Team';
import Game from './pages/Game';
import Player from './pages/Player';
import Leaders from './pages/Leaders';
import Standings from './pages/Standings';
import Rankings from './pages/Rankings';
import Jobs from './pages/Jobs';
import Quality from './pages/Quality';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  {
    path: '/', element: <App />,
    children: [
      { index: true, element: <Teams /> },
      { path: 'teams', element: <Teams /> },
      { path: 'teams/:id', element: <Team /> },
      { path: 'games/:id', element: <Game /> },
      { path: 'players/:id', element: <Player /> },
      { path: 'leaders', element: <Leaders /> },
      { path: 'standings', element: <Standings /> },
      { path: 'rankings', element: <Rankings /> },
      { path: 'jobs', element: <Jobs /> },
      { path: 'quality', element: <Quality /> },
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
