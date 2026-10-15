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
const Conferences = lazy(() => import('./pages/Conferences'));
const Leaders = lazy(() => import('./pages/Leaders'));
const Players = lazy(() => import('./pages/Players'));
const Tv = lazy(() => import('./pages/Tv'));
const Referees = lazy(() => import('./pages/Referees'));
const TeamOfWeek = lazy(() => import('./pages/TeamOfWeek'));
const Tournament = lazy(() => import('./pages/Tournament'));
const Records = lazy(() => import('./pages/Records'));
const Legal = lazy(() => import('./pages/Legal'));
const LEGAL_PAGES = ['about', 'contact', 'terms', 'privacy', 'sources', 'data-use', 'copyright', 'corrections', 'accessibility'];
const Referee = lazy(() => import('./pages/Referee'));
const ProReferees = lazy(() => import('./pages/pro/ProReferees'));
const ProReferee = lazy(() => import('./pages/pro/ProReferee'));
const Transfers = lazy(() => import('./pages/Transfers'));
const Compare = lazy(() => import('./pages/Compare'));
const H2H = lazy(() => import('./pages/H2H'));
const Coach = lazy(() => import('./pages/Coach'));
const ProH2H = lazy(() => import('./pages/pro/ProH2H'));
const ProCoach = lazy(() => import('./pages/pro/ProCoach'));
const ProRankings = lazy(() => import('./pages/pro/ProRankings'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const Admin = lazy(() => import('./pages/Admin'));
const Console = lazy(() => import('./pages/Console'));
// Plaibook Stats Pro.
const ProMatches = lazy(() => import('./pages/pro/ProMatches'));
const ProLeagues = lazy(() => import('./pages/pro/ProLeagues'));
const ProLeague = lazy(() => import('./pages/pro/ProLeague'));
const ProTeam = lazy(() => import('./pages/pro/ProTeam'));
const ProTeams = lazy(() => import('./pages/pro/ProTeams'));
const ProPlayer = lazy(() => import('./pages/pro/ProPlayer'));
const ProMatch = lazy(() => import('./pages/pro/ProMatch'));
const ProDirectory = lazy(() => import('./pages/pro/ProDirectory'));
const ProCountries = lazy(() => import('./pages/pro/ProCountries').then((m) => ({ default: m.ProCountries })));
const ProCountry = lazy(() => import('./pages/pro/ProCountries').then((m) => ({ default: m.ProCountry })));
const ProCompare = lazy(() => import('./pages/pro/ProCompare'));
const ProTransfers = lazy(() => import('./pages/pro/ProTransfers'));
const ProCollege = lazy(() => import('./pages/pro/ProCollege'));
const ProAbroad = lazy(() => import('./pages/pro/ProAbroad'));
const ProSources = lazy(() => import('./pages/pro/ProSources'));
// International (national teams): its own lists; a tournament, team, player or match page is Pro's.
const IntlTournaments = lazy(() => import('./pages/intl/IntlTournaments'));
const IntlTeams = lazy(() => import('./pages/intl/IntlTeams'));
const IntlRankings = lazy(() => import('./pages/intl/IntlRankings'));
const IntlH2H = lazy(() => import('./pages/intl/IntlH2H'));
const ProNews = lazy(() => import('./pages/pro/ProNews'));
const IntlNews = lazy(() => import('./pages/intl/IntlNews'));
const News = lazy(() => import('./pages/News'));

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
          { path: 'conferences', element: <Conferences /> },
          { path: 'conferences/:id', element: <Conference /> },
          // Old addresses keep working.
          { path: 'games/:id', element: <Redirect to={(p) => `/matches/${p.id}`} /> },
          { path: 'standings', element: <Redirect to={() => '/conferences'} /> },
          { path: 'leaders', element: <Leaders /> },
          { path: 'players', element: <Players /> },
          { path: 'players/:id', element: <Player /> },
          { path: 'transfers', element: <Transfers /> },
          { path: 'tv', element: <Tv /> },
          { path: 'referees', element: <Referees /> },
          { path: 'team-of-the-week', element: <TeamOfWeek /> },
          { path: 'tournament', element: <Tournament /> },
          { path: 'records', element: <Records /> },
          ...LEGAL_PAGES.map((slug) => ({ path: slug, element: <Legal key={slug} slug={slug} /> })),
          { path: 'referees/:slug', element: <Referee /> },
          { path: 'compare', element: <Compare /> },
          { path: 'h2h', element: <H2H /> },
          { path: 'coaches/:id', element: <Coach /> },
          { path: 'pro/h2h', element: <ProH2H /> },
          { path: 'pro/coaches/:id', element: <ProCoach /> },
          { path: 'pro/referees', element: <ProReferees /> },
          { path: 'pro/referees/:slug', element: <ProReferee /> },
          { path: 'pro/rankings', element: <ProRankings /> },
          { path: 'rankings', element: <Rankings /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'news', element: <News /> },
          { path: 'admin', element: <Admin /> },
          { path: 'console', element: <RequireAdmin><Console /></RequireAdmin> },
          { path: 'jobs', element: <Redirect to={() => '/console'} extra="tab=jobs" /> },
          { path: 'quality', element: <Redirect to={() => '/console'} extra="tab=quality" /> },
          // One home page for every area (2026-10-14): the old Pro and International homes lead there.
          { path: 'pro', element: <Redirect to={() => '/'} /> },
          { path: 'pro/sources', element: <ProSources /> },
          { path: 'pro/matches', element: <ProMatches /> },
          { path: 'pro/matches/:slug', element: <ProMatch /> },
          { path: 'pro/leagues', element: <ProLeagues /> },
          { path: 'pro/leagues/:slug', element: <ProLeague /> },
          { path: 'pro/teams', element: <ProTeams /> },
          { path: 'pro/teams/:slug', element: <ProTeam /> },
          { path: 'pro/players/:slug', element: <ProPlayer /> },
          { path: 'pro/players', element: <ProDirectory key="players" mode="players" /> },
          { path: 'pro/leaders', element: <ProDirectory key="leaders" mode="leaders" /> },
          { path: 'pro/countries', element: <ProCountries /> },
          { path: 'pro/countries/:slug', element: <ProCountry /> },
          { path: 'pro/compare', element: <ProCompare /> },
          { path: 'pro/transfers', element: <ProTransfers /> },
          { path: 'pro/college', element: <ProCollege /> },
          { path: 'pro/abroad', element: <ProAbroad /> },
          { path: 'intl', element: <Redirect to={() => '/'} /> },
          { path: 'intl/matches', element: <ProMatches key="intl" /> },
          { path: 'intl/matches/:slug', element: <ProMatch /> },
          { path: 'intl/tournaments', element: <IntlTournaments /> },
          { path: 'intl/tournaments/:slug', element: <ProLeague /> },
          { path: 'intl/teams', element: <IntlTeams /> },
          { path: 'intl/teams/:slug', element: <ProTeam /> },
          { path: 'intl/players', element: <ProDirectory key="intl-players" mode="players" /> },
          { path: 'intl/leaders', element: <ProDirectory key="intl-leaders" mode="leaders" /> },
          { path: 'intl/players/:slug', element: <ProPlayer /> },
          { path: 'intl/rankings', element: <IntlRankings /> },
          { path: 'intl/h2h', element: <IntlH2H /> },
          { path: 'intl/news', element: <IntlNews /> },
          { path: 'pro/news', element: <ProNews /> },
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
