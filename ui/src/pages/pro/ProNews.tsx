// Pro news (/pro/news): club and league news, US first (MLS, NWSL, USL and Americans abroad), then the world. Tagged
// and linked to clubs, players and leagues. Men's or women's from the header toggle.
import { PageHeader, Section } from '../../components/primitives';
import { NewsFeed } from '../../components/news/News';
import { NewsHub } from '../../components/news/NewsHub';
import { useProGender } from '../../lib/proGender';
import { PRO_FILTERS } from '../../lib/news';

const MLS = '253', NWSL = '254';

export default function ProNews() {
  const [gender] = useProGender();
  const base = { scope: 'pro' as const, gender };
  return (
    <div className="space-y-6">
      <PageHeader title="Pro soccer news" meta={`${gender === 'w' ? "Women's" : "Men's"} club soccer: injuries, transfers, coaching changes and results, from the US to the top leagues abroad.`} />
      <NewsHub base={base} filters={PRO_FILTERS} aside={<>
        <Section title={gender === 'w' ? 'NWSL' : 'MLS'}><NewsFeed q={{ league: gender === 'w' ? NWSL : MLS, limit: 6 }} max={6} dense empty="No league news lately" /></Section>
        <Section title="Americans abroad"><NewsFeed q={{ american: true, gender, limit: 6 }} max={6} dense empty="No news about Americans abroad lately" /></Section>
        <Section title="Transfers"><NewsFeed q={{ ...base, kind: ['transfer', 'loan'], limit: 6 }} max={6} dense empty="No transfer news lately" /></Section>
      </>} />
    </div>
  );
}
