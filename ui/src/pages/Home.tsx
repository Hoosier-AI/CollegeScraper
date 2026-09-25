// The front door: a matchday dashboard. Search and what is happening right now up top; then one switch
// (men's/women's, division) drives the matches, the poll, the scoring leaders and the conference races below.
import { SearchBox } from '../components/SearchBox';
import { RightNow } from './home/RightNow';
import { ScopeBar, useScope } from './home/Scope';
import { MatchesPanel } from './home/MatchesPanel';
import { PollPanel } from './home/PollPanel';
import { LeadersPanel } from './home/LeadersPanel';
import { ConferenceRaces } from './home/ConferenceRaces';
import { BrowseGrid } from './home/BrowseGrid';
import { HowChecked } from './home/HowChecked';

export default function Home() {
  const scope = useScope();
  return (
    <div className="space-y-6 pb-4">
      <section className="grid gap-6 pt-2 sm:pt-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div className="max-w-2xl">
          <h1 className="display text-3xl leading-[0.95] text-chalk-100 sm:text-5xl">Every NCAA soccer match, team and number.</h1>
          <p className="mt-3 text-sm text-chalk-300 sm:text-base">Division I, II and III, men's and women's: live scores, lineups, tables and the coaches' poll, checked against each school and NCAA.com.</p>
          <div className="mt-5"><SearchBox size="lg" placeholder="Find a team or player" examples={['Stanford', 'Duke', 'Messiah', 'Wake Forest']} /></div>
        </div>
        <RightNow scope={scope} />
      </section>

      <ScopeBar />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
        <MatchesPanel scope={scope} className="md:col-span-2 lg:col-span-8 lg:row-span-2" />
        <PollPanel scope={scope} className="lg:col-span-4" />
        <LeadersPanel scope={scope} className="lg:col-span-4" />
      </div>

      <ConferenceRaces scope={scope} />

      <div className="grid gap-4 lg:grid-cols-12">
        <BrowseGrid className="lg:col-span-7" />
        <HowChecked className="lg:col-span-5" />
      </div>
    </div>
  );
}
