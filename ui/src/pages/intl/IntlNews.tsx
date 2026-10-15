// International news (/intl/news): national teams and international tournaments, the USMNT and USWNT first:
// call-ups, injuries, results, qualifying, coaching changes. Men's or women's from the header toggle.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { proPath } from '../../lib/pro';
import { useProGender } from '../../lib/proGender';
import { PRO_FILTERS } from '../../lib/news';
import { PageHeader, Section } from '../../components/primitives';
import { NewsFeed, NewsSection } from '../../components/news/News';
import { NewsHub } from '../../components/news/NewsHub';

const FILTERS = [PRO_FILTERS[0]!, { id: 'callups', label: 'Call-ups', kinds: ['callup' as const] }, PRO_FILTERS[1]!, { id: 'results', label: 'Results', kinds: ['report' as const] }, { id: 'coaching', label: 'Coaching', kinds: ['coaching' as const] }];

export default function IntlNews() {
  const [gender] = useProGender();
  const us = useQuery({ queryKey: ['intl-us-team', gender], queryFn: () => api<{ team: { id: number; slug: string; name: string } }>(`/api/pro/teams/${gender === 'w' ? 'usa-women' : 'usa'}`), staleTime: 3600_000 });
  const t = us.data?.team;
  const name = gender === 'w' ? 'USWNT' : 'USMNT';
  return (
    <div className="space-y-6">
      <PageHeader title="International soccer news" meta={`${gender === 'w' ? "Women's" : "Men's"} national teams and tournaments: call-ups, injuries, results and qualifying, the ${name} first.`} />
      <NewsHub base={{ scope: 'international', gender }} filters={FILTERS}
        intro={t && <NewsSection title={name} q={{ team: String(t.id) }} hide={`pro_team:${t.id}`} max={5} right={<Link to={proPath.team(t.slug, null, true)} className="text-sm text-pitch-300 hover:text-pitch-200">Team page</Link>} />}
        aside={<>
          <Section title="Call-ups"><NewsFeed q={{ scope: 'international', gender, kind: ['callup'], limit: 6 }} max={6} dense empty="No call-up news lately" /></Section>
          <Section title="Injuries"><NewsFeed q={{ scope: 'international', gender, kind: ['injury', 'suspension'], limit: 6 }} max={6} dense empty="No injury news lately" /></Section>
        </>} />
    </div>
  );
}
