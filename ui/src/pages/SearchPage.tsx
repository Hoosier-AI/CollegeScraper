import { UniversalSearch } from './home/UniversalSearch';

/** The Search tab on phones: the site-wide search, full width, focused on arrival. */
export default function SearchPage() {
  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="display text-2xl">Search</h1>
      <UniversalSearch autoFocus examples={['Indiana', 'Christian Pulisic', 'NWSL', 'USA']} />
      <p className="text-sm text-chalk-400">College teams and players in every NCAA division, pro competitions, clubs and players, and national teams, men's and women's.</p>
    </div>
  );
}
