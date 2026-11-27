// The front door (2026-11 redesign): today's scores first. One line of title, the teams you follow, then every match
// of the day across college, pro and international on one list with a switch to narrow it. Wide screens add a rail on
// each side (what you follow and the competitions; the stories and the poll). The rest of the old home page follows.
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
import { TotwPanel } from './home/TotwPanel';
import { LeadersPanel } from './home/LeadersPanel';
import { AreaFilter, Scores, useAreaPick } from './home/Scores';
import { MyTeamsList, MyTeamsStrip } from './home/MyTeams';
import { useFollows } from '../lib/follows';
import { Explore } from './home/Explore';
import { useCollegeDays, useIntlHome, useProHome } from './home/data';

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
  const follows = useFollows().length;
  const [area, setArea] = useAreaPick();
  const live = (college.data?.live ?? 0) + (pro.data?.matches.live ?? 0) + (intl.data?.matches.live ?? 0);
  const leagues = (pro.data?.featured ?? []).filter((l) => l.gender === gender).slice(0, 8);
  const railLink = 'flex min-h-9 items-center gap-2.5 rounded-md px-2 text-sm text-chalk-200 hover:bg-field-800 hover:text-chalk-100';

  return (
    <div className="stack pb-4">
      {/* Scores first: the title is one line, and the matches start under it. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="display text-2xl text-chalk-100 sm:text-3xl">Scores</h1>
          <p className="text-sm text-chalk-400">{longDay(todayEastern())}{live > 0 && <span className="font-semibold text-live">, {live} live</span>}</p>
        </div>
        <SegmentedControl size="sm" label="Men's or women's" value={gender} onChange={setGender} options={[{ value: 'm', label: 'Men' }, { value: 'w', label: 'Women' }]} />
      </header>

      <MyTeamsStrip />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_21rem]">
        {/* Wide screens: what you follow and the competitions, always in the same place. */}
        <aside className="hidden stack lg:block">
          {follows > 0 && (
            <section aria-labelledby="rail-mine">
              <div className="mb-1 flex items-baseline justify-between"><h2 id="rail-mine" className="h-section">My teams</h2><Link to="/following" className="text-xs font-medium text-pitch-400 hover:text-pitch-300">Edit</Link></div>
              <MyTeamsList />
            </section>
          )}
          <nav aria-labelledby="rail-comps">
            <h2 id="rail-comps" className="h-section mb-1">Competitions</h2>
            <ul className="-mx-2">
              <li><Link to="/tournament" className={railLink}>NCAA tournament</Link></li>
              <li><Link to="/conferences" className={railLink}>College conferences</Link></li>
              {leagues.map((l) => <li key={l.id}><Link to={proPath.league(l.slug, null, null, l.scope)} className={railLink}><TeamLogo src={l.logo} name={l.name} size={18} /><span className="truncate">{l.name}</span></Link></li>)}
              <li><Link to="/pro/leagues" className={`${railLink} text-pitch-400`}>All leagues</Link></li>
              <li><Link to="/intl/tournaments" className={`${railLink} text-pitch-400`}>International tournaments</Link></li>
            </ul>
          </nav>
        </aside>

        <section aria-labelledby="today" className="min-w-0 stack-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="today" className="sr-only">Today</h2>
            <AreaFilter value={area} onChange={setArea} />
          </div>
          <Scores area={area} gender={gender} college={college.data} pro={pro.data} intl={intl.data} loading={college.isPending || pro.isPending} />
        </section>

        <aside className="stack lg:col-span-2 xl:col-span-1">
          <Panel title="Top stories" action={<span className="flex flex-wrap gap-x-3 gap-y-1"><Link to="/news" className={linkCls}>College</Link><Link to="/pro/news" className={linkCls}>Pro</Link><Link to="/intl/news" className={linkCls}>International</Link></span>}>
            {news.isPending ? <Skeleton lines={6} /> : stories.length ? <div className="-mx-1"><NewsList stories={stories} dense /></div> : <p className="text-sm text-chalk-400">No news yet today.</p>}
          </Panel>
          <PollPanel scope={scope} />
          <TotwPanel scope={scope} />
        </aside>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="stack lg:col-span-8">
          {abroad.length > 0 && (
            <Panel title="Americans abroad this week" footer={{ to: '/pro/abroad', label: 'All Americans abroad' }}>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{abroad.map((l) => <AbroadCard key={`${l.player.id}-${l.match.id}`} l={l} />)}</ul>
            </Panel>
          )}
          <LeadersPanel scope={scope} />
        </div>
        <aside className="stack lg:col-span-4">
          <Panel title="Plaibook Elo" meta="National teams, our own ranking" footer={{ to: '/intl/rankings', label: 'Full rankings' }}>
            <EloTop gender={gender} />
          </Panel>
          {tournaments.length > 0 && (
            <Panel title="Tournaments" footer={{ to: '/intl/tournaments', label: 'All tournaments' }}>
              <ul className="-mx-2 text-sm">
                {tournaments.map((t) => (
                  <li key={t.id}><Link to={proPath.league(t.slug, null, null, 'intl')} className="flex min-h-9 items-center gap-2.5 rounded-md px-2 py-1 hover:bg-field-800">
                    <TeamLogo src={t.logo} name={t.name} size={20} /><span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{t.name}</span>
                    <span className={`shrink-0 text-xs ${t.state === 'live' ? 'font-semibold text-live' : 'text-chalk-500'}`}>{t.state === 'live' ? 'Playing now' : t.starts_on ? fmt.date(t.starts_on) : ''}</span>
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
