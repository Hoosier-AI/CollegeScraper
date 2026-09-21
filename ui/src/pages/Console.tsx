// The owner's console: one page, seven tabs, everything needed to run the service.
import { lazy, Suspense } from 'react';
import { useUrlState } from '../lib/urlState';
import { useHref } from '../lib/filters';
import { clearToken } from '../lib/api';
import { PageHeader, Skeleton, TabsNav } from '../components/primitives';

const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'jobs', label: 'Jobs' }, { id: 'quality', label: 'Quality' }, { id: 'crawl', label: 'Crawl' },
  { id: 'api', label: 'API' }, { id: 'deploy', label: 'Deploy' }, { id: 'settings', label: 'Settings' },
] as const;
type Tab = typeof TABS[number]['id'];

const Overview = lazy(() => import('./console/Overview'));
const JobsTab = lazy(() => import('./console/JobsTab'));
const QualityTab = lazy(() => import('./console/QualityTab'));
const CrawlTab = lazy(() => import('./console/CrawlTab'));
const ApiTab = lazy(() => import('./console/ApiTab'));
const DeployTab = lazy(() => import('./console/DeployTab'));
const SettingsTab = lazy(() => import('./console/SettingsTab'));

export default function Console() {
  const [tabParam] = useUrlState('tab', 'overview', { allow: TABS.map((t) => t.id) as unknown as string[] });
  const tab = tabParam as Tab;
  const href = useHref();
  return (
    <div className="space-y-4">
      <PageHeader title="Console" meta="Jobs, data quality, crawl health, the API and the Render service.">
        <button className="btn-ghost btn-sm" onClick={() => clearToken()}>Sign out</button>
      </PageHeader>
      <TabsNav label="Console sections" tabs={[...TABS]} value={tab} hrefFor={(t) => href('/console', { tab: t === 'overview' ? null : t })} />
      <Suspense fallback={<div className="space-y-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-48" /></div>}>
        {tab === 'overview' && <Overview />}
        {tab === 'jobs' && <JobsTab />}
        {tab === 'quality' && <QualityTab />}
        {tab === 'crawl' && <CrawlTab />}
        {tab === 'api' && <ApiTab />}
        {tab === 'deploy' && <DeployTab />}
        {tab === 'settings' && <SettingsTab />}
      </Suspense>
    </div>
  );
}
