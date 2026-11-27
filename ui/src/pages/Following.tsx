// My teams: everything the reader follows, with what is next for each, and how to add more. Kept in this browser.
import { Star } from 'lucide-react';
import { useFollows } from '../lib/follows';
import { UniversalSearch } from './home/UniversalSearch';
import { MyTeamsList } from './home/MyTeams';

export default function Following() {
  const n = useFollows().length;
  return (
    <div className="mx-auto max-w-2xl stack">
      <header>
        <h1 className="display text-2xl text-chalk-100 sm:text-3xl">My teams</h1>
        <p className="mt-1 text-sm text-chalk-400">{n ? 'Teams and players you follow, shown first on Scores. Kept on this device, no account.' : 'Follow a team or a player and it shows first on Scores. Kept on this device, no account.'}</p>
      </header>
      {n > 0 && <MyTeamsList edit />}
      <section className="stack-sm">
        <h2 className="h-section">{n ? 'Add another' : 'Find a team or player'}</h2>
        <UniversalSearch size="md" />
        <p className="flex items-center gap-2 text-sm text-chalk-400"><Star size={15} aria-hidden className="shrink-0 text-pitch-400" />Open its page and press Follow.</p>
      </section>
    </div>
  );
}
