// Where Plaibook Stats Pro's data comes from, its terms, and how other sources are checked (/pro/sources).
import { PageHeader, Section } from '../../components/primitives';

const SOURCES = [
  { name: 'API-Football', url: 'https://www.api-football.com', what: 'Fixtures, results, tables, lineups, match events, player match stats, squads, transfers, injuries, coaches and honours for competitions worldwide.', terms: 'Licensed (paid plan).' },
  { name: 'American Soccer Analysis', url: 'https://www.americansocceranalysis.com', what: 'Expected goals and assists, passing over expected, goals added, shot maps, attendance, referees and grounds for MLS, NWSL, USL Championship, USL League One, MLS Next Pro and USL Super League.', terms: 'Free public data, credited on every page that shows it.' },
  { name: 'Wikidata', url: 'https://www.wikidata.org', what: 'Which professional players played college soccer.', terms: 'Public domain (CC0).' },
];

export default function ProSources() {
  return (
    <div className="space-y-5">
      <PageHeader title="Where the data comes from" meta="Plaibook Stats Pro combines a licensed data feed with free public sources, and checks one against the other." />
      <Section title="Sources">
        <ul className="frame divide-y divide-field-700 text-sm">
          {SOURCES.map((s) => (
            <li key={s.name} className="space-y-1 px-3 py-2.5">
              <a href={s.url} target="_blank" rel="noopener" className="font-medium text-chalk-100 hover:text-pitch-300">{s.name}</a>
              <p className="text-chalk-300">{s.what}</p>
              <p className="text-2xs text-chalk-500">{s.terms}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="How the numbers are checked">
        <p className="max-w-prose text-sm text-chalk-300">Numbers from other sources are compared with API-Football before they are shown: every score, and each player&apos;s minutes, goals and assists. A competition season only shows them when at least 97% agree, and a player row whose minutes disagree is left out.</p>
      </Section>
    </div>
  );
}
