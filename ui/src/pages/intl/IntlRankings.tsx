// Plaibook Elo rankings: every FIFA nation that played in the last four years, rated from every result since 1872
// with the World Football Elo method. Our own number, not FIFA's ranking.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { useUrlState } from '../../lib/urlState';
import { CONFEDERATIONS, CONFEDERATION_LABEL, monthLabel, type IntlMover, type IntlRankings as Rankings } from '../../lib/intl';
import { Sparkline } from '../../components/intl/Sparkline';
import { DataTable, type Column } from '../../components/DataTable';
import { Credits, nationHref } from '../../components/intl/NationHistory';
import { ErrorBox, Field, PageHeader, Section, Select, TeamLogo } from '../../components/primitives';
import { useProGender } from '../../lib/proGender';

type Row = Rankings['rows'][number];

export default function IntlRankings() {
  const [gender] = useProGender();
  const [conf, setConf] = useUrlState('conf', '', { allow: [...CONFEDERATIONS] });
  const q = useQuery({ queryKey: ['intl-rankings', gender], queryFn: () => api<Rankings>(`/api/intl/rankings${qs({ gender })}`), staleTime: 600_000 });
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => !conf || r.nation.confederation === conf), [q.data, conf]);
  const cols: Column<Row>[] = [
    { key: 'rank', label: '#', num: true, value: (r) => r.rank },
    { key: 'nation', label: 'Nation', primary: true, value: (r) => r.nation.name, render: (r) => <span className="flex items-center gap-2"><TeamLogo src={r.nation.logo} name={r.nation.name} size={20} /><span className="truncate">{r.nation.name}</span></span> },
    { key: 'conf', label: 'Confederation', priority: 2, value: (r) => r.nation.confederation ?? '' },
    { key: 'rating', label: 'Rating', num: true, value: (r) => r.rating },
    { key: 'trend', label: 'Last 2 years', priority: 2, sortable: false, value: (r) => r.trend?.length ?? 0, render: (r) => <Sparkline points={r.trend ?? []} label={r.nation.name} /> },
    { key: 'change', label: '1 year', title: 'Change over the last year', num: true, value: (r) => r.change_1y, render: (r) => (r.change_1y == null ? '–' : <span className={r.change_1y > 0 ? 'text-win' : r.change_1y < 0 ? 'text-loss' : ''}>{r.change_1y > 0 ? '+' : ''}{r.change_1y}</span>) },
    { key: 'best', label: 'Best rank', title: 'Best world rank ever, and the first month it was held (month-end tables)', num: true, priority: 2, value: (r) => r.best_rank, render: (r) => (r.best_rank ? `#${r.best_rank} (${monthLabel(r.best_rank_date)})` : '–') },
    { key: 'matches', label: 'Matches', num: true, priority: 3, value: (r) => r.matches },
    { key: 'last', label: 'Last match', priority: 3, value: (r) => r.last_match, render: (r) => fmt.date(r.last_match) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title={`${gender === 'w' ? "Women's" : "Men's"} national team rankings`} meta={q.data?.updated_at ? `Plaibook Elo, updated ${fmt.date(q.data.updated_at)}` : 'Plaibook Elo'}>
        <Field label="Confederation">{(id) => <Select id={id} value={conf} onChange={setConf} options={[{ value: '', label: 'Every confederation' }, ...CONFEDERATIONS.filter((c) => c !== 'FIFA').map((c) => ({ value: c, label: CONFEDERATION_LABEL[c] ?? c }))]} />}</Field>
      </PageHeader>
      <p className="max-w-3xl text-xs text-chalk-400">Plaibook Elo is our own rating, worked out from every international result since 1872 with the World Football Elo method: a win against a strong side is worth more, a World Cup match more than a friendly, a big win more than a narrow one, and home advantage counts. A new side's first 15 matches move only its own rating, so ratings do not creep upward over the decades, and a result between confederations moves a little of the whole region, so a strong side in a region that seldom played the world is not rated among the world's best. Today's ratings sit within about 25 points of the published World Football Elo ratings. Ratings from different eras do not compare, so a side's best is its best world rank, dated to the first month it held it. It is not FIFA's ranking. Sides with fewer than {gender === 'w' ? '10' : '30'} matches or none in four years are left out.{gender === 'w' ? " Women's ratings use the results our sources have, which are thinner before 2010." : ''}</p>
      <details className="max-w-3xl text-xs text-chalk-400">
        <summary className="w-fit cursor-pointer text-pitch-300 hover:text-pitch-200">How a rating moves</summary>
        <div className="mt-2 space-y-1.5">
          <p>After every match: <span className="font-mono text-chalk-200">change = K × G × (result − expected)</span>.</p>
          <p><span className="text-chalk-200">Expected</span> comes from the two ratings: a side 100 points better is expected to score about 64% (a win is 1, a draw ½), and the home side counts 100 points extra.</p>
          <p><span className="text-chalk-200">K</span> is the match's weight: 60 a World Cup, 50 a continental championship, 40 a qualifier or nations league, 30 another tournament, 20 a friendly. <span className="text-chalk-200">G</span> rewards the margin: ×1.5 for two goals, more for three or more.</p>
          <p>What one side gains the other loses. When the two sides come from different confederations, a tenth of that move is shared with the rest of the winner's confederation (and taken from the loser's), so regions that seldom meet the world settle at their real level.</p>
          <p>The world rank is the order of these ratings at the end of each month, among FIFA members with {gender === 'w' ? '10' : '30'} or more matches and a match in the last four years. Hover any point on a team's chart to see the numbers behind each match.</p>
        </div>
      </details>
      {q.data?.movers && (q.data.movers.up.length > 0 || q.data.movers.down.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Movers title="Biggest risers this year" rows={q.data.movers.up} />
          <Movers title="Biggest fallers this year" rows={q.data.movers.down} />
        </div>
      )}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.nation.key} caption="Plaibook Elo rankings" rowHref={(r) => nationHref(r.nation)} loading={q.isPending} dense
        empty={<p className="p-4 text-sm text-chalk-400">Ratings appear after the first results sync.</p>} />
      {q.data?.credit && <Credits credits={[q.data.credit, { name: 'international_results (Mart Jürisoo)', url: 'https://github.com/martj42/international_results', license: 'public domain (CC0)' }]} />}
    </div>
  );
}

function Movers({ title, rows }: { title: string; rows: IntlMover[] }) {
  if (!rows.length) return null;
  return (
    <Section title={title}>
      <ol className="frame divide-y divide-field-700 text-sm">
        {rows.map((r) => (
          <li key={r.nation.key}>
            <Link to={nationHref(r.nation)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-field-800">
              <TeamLogo src={r.nation.logo} name={r.nation.name} size={18} />
              <span className="min-w-0 flex-1 truncate text-chalk-100">{r.nation.name}</span>
              <span className="text-2xs tnum text-chalk-500">#{r.rank} · {r.rating}</span>
              <span className={`w-12 text-right font-semibold tnum ${r.change_1y > 0 ? 'text-win' : 'text-loss'}`}>{r.change_1y > 0 ? '+' : ''}{r.change_1y}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}
