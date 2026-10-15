// The one front door for college, pro and international soccer: a search over all of it, today's board (three
// lanes: College, Pro with the US first, International), then the stories, Americans abroad, the college leaders,
// the coaches' poll, Plaibook Elo and the tournaments on now, and the way into each area. One Men/Women switch drives
// everything on the page.
import { Link } from 'react-router-dom';
import { useFilters } from '../lib/filters';
import { useProGender } from '../lib/proGender';
import { longDay, todayEastern } from '../lib/dates';
import { fmt } from '../lib/api';
import { useNews } from '../lib/news';
import { proPath } from '../lib/pro';
import { NewsList } from '../components/news/News';
import { AbroadCard } from '../components/pro/Abroad';
import { EloTop } from '../components/intl/EloTop';
import { SegmentedControl, Skeleton, TeamLogo } from '../components/primitives';
import { Panel, type Scope } from './home/Panel';
import { PollPanel } from './home/PollPanel';
import { LeadersPanel } from './home/LeadersPanel';
import { Board, collegeLane, intlLane, proLane } from './home/Board';
import { Explore } from './home/Explore';
import { UniversalSearch } from './home/UniversalSearch';
import { FollowingPanel } from './home/Following';
import { useCollegeDays, useIntlHome, useProHome } from './home/data';

const EXAMPLES = { m: ['Indiana', 'Christian Pulisic', 'MLS', 'USA'], w: ['Stanford', 'Trinity Rodman', 'NWSL', 'USA'] } as const;
const linkCls = 'text-sm text-pitch-300 hover:text-pitch-200';

export default function Home() {
  const [gender, setGender] = useProGender();
  const { season } = useFilters();
  const scope: Scope = { season, gender, division: 'd1' };
  const college = useCollegeDays(gender);
  const pro = useProHome();
  const intl = useIntlHome();
  const news = useNews({ top: true, gender, limit: 12 });
  const page = news.data?.pages[0];
  const stories = (page?.top?.length ? page.top : page?.stories ?? []).slice(0, 7);
  const abroad = (pro.data?.abroad?.lines ?? []).filter((l) => l.match.league.gender === gender).slice(0, 6);
  const tournaments = (intl.data?.tournaments ?? []).filter((t) => t.gender === gender && t.state !== 'off')
    .sort((a, b) => Number(b.state === 'live') - Number(a.state === 'live') || (a.starts_on ?? '').localeCompare(b.starts_on ?? '')).slice(0, 6);
  const lanes = [
    collegeLane(college.data, gender, college.isPending, !!college.error),
    proLane(pro.data, gender, pro.isPending, !!pro.error),
    intlLane(intl.data, gender, intl.isPending, !!intl.error),
  ];

  return (
    <div className="space-y-8 pb-4">
      {/* Title on the left, search and the men's/women's switch on the right: on a wide screen the right half was empty
          and the matches started a screen down. */}
      <section className="grid grid-cols-1 items-end gap-x-10 gap-y-5 pt-2 sm:pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        <div className="min-w-0">
          <h1 className="display text-4xl leading-[0.92] text-chalk-100 sm:text-5xl xl:text-6xl">Soccer stats from college to the World Cup</h1>
          <p className="mt-3 max-w-2xl text-base text-chalk-300">Every NCAA program, MLS, the NWSL and the pro leagues abroad, and national teams back to 1872.</p>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex justify-end"><SegmentedControl label="Men's or women's" value={gender} onChange={setGender} options={[{ value: 'm', label: 'Men' }, { value: 'w', label: 'Women' }]} /></div>
          <UniversalSearch examples={[...EXAMPLES[gender]]} />
        </div>
      </section>

      <FollowingPanel />

      <section aria-labelledby="today" className="space-y-3">
        <h2 id="today" className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-chalk-100">Today<span className="text-sm font-normal text-chalk-500">{longDay(todayEastern())}</span></h2>
        <Board lanes={lanes} />
      </section>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <Panel title="Top stories" meta="From the schools, the clubs and the press, across every level"
            action={<span className="flex flex-wrap gap-x-3 gap-y-1"><Link to="/news" className={linkCls}>College</Link><Link to="/pro/news" className={linkCls}>Pro</Link><Link to="/intl/news" className={linkCls}>International</Link></span>}>
            {news.isPending ? <Skeleton lines={6} /> : stories.length ? <div className="-mx-1"><NewsList stories={stories} dense /></div> : <p className="text-sm text-chalk-400">No news yet today.</p>}
          </Panel>
          {abroad.length > 0 && (
            <Panel title="Americans abroad this week" meta={`${gender === 'w' ? 'American women' : 'Americans'} at clubs outside the US`} footer={{ to: '/pro/abroad', label: 'All Americans abroad' }}>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{abroad.map((l) => <AbroadCard key={`${l.player.id}-${l.match.id}`} l={l} />)}</ul>
            </Panel>
          )}
          <LeadersPanel scope={scope} />
        </div>
        <aside className="space-y-4 lg:col-span-4">
          <PollPanel scope={scope} />
          <Panel title="Plaibook Elo" meta="National teams, our own ranking" footer={{ to: '/intl/rankings', label: 'Full rankings' }}>
            <EloTop gender={gender} />
          </Panel>
          {tournaments.length > 0 && (
            <Panel title="Tournaments" meta="Playing now or coming up" footer={{ to: '/intl/tournaments', label: 'All tournaments' }}>
              <ul className="-mx-2 text-sm">
                {tournaments.map((t) => (
                  <li key={t.id}><Link to={proPath.league(t.slug, null, null, 'intl')} className="flex min-h-9 items-center gap-2.5 rounded-md px-2 py-1 hover:bg-field-800">
                    <TeamLogo src={t.logo} name={t.name} size={20} /><span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{t.name}</span>
                    <span className={`shrink-0 text-xs ${t.state === 'live' ? 'font-semibold text-win' : 'text-chalk-500'}`}>{t.state === 'live' ? 'Playing now' : t.starts_on ? fmt.date(t.starts_on) : ''}</span>
                  </Link></li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>

      <Explore pro={pro.data} intl={intl.data} />
    </div>
  );
}
