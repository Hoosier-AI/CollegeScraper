import { SearchBox } from '../components/SearchBox';

/** The Search tab on phones: the same combobox, full width, focused on arrival. */
export default function SearchPage() {
  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="display text-2xl">Search</h1>
      <SearchBox size="lg" autoFocus placeholder="Team, school or player name" examples={['Stanford', 'Duke', 'Messiah', 'Wake Forest']} />
      <p className="text-sm text-chalk-400">Teams match on school and program name; players on their name. Results cover every NCAA division, men's and women's.</p>
    </div>
  );
}
