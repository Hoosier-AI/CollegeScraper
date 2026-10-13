// College news (/news): the schools' own athletics stories and college soccer coverage, tagged and linked to teams,
// players and conferences. Men's or women's from the header filter.
import { PageHeader, Section } from '../components/primitives';
import { NewsFeed } from '../components/news/News';
import { NewsCredit, NewsHub } from '../components/news/NewsHub';
import { useFilters, genderLabel } from '../lib/filters';
import { COLLEGE_FILTERS } from '../lib/news';

export default function News() {
  const { gender } = useFilters();
  const base = { scope: 'college' as const, gender };
  return (
    <div className="space-y-6">
      <PageHeader title="College soccer news" meta={`Every NCAA ${genderLabel(gender)} program's news in one place: results, previews, injuries, commitments, coaching changes and awards.`} />
      <NewsHub base={base} filters={COLLEGE_FILTERS} aside={<>
        <Section title="Coaching changes"><NewsFeed q={{ ...base, kind: ['coaching'], limit: 6 }} max={6} dense empty="No coaching news lately" /></Section>
        <Section title="Commitments"><NewsFeed q={{ ...base, kind: ['commitment'], limit: 6 }} max={6} dense empty="No commitment news lately" /></Section>
        <Section title="Awards"><NewsFeed q={{ ...base, kind: ['award'], limit: 6 }} max={6} dense empty="No awards lately" /></Section>
        <NewsCredit college />
      </>} />
    </div>
  );
}
