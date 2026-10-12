// Plaibook Elo rankings: every FIFA nation that played in the last four years, rated from every result since 1872
// with the World Football Elo method. Our own number, not FIFA's ranking.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { useUrlState } from '../../lib/urlState';
import { CONFEDERATIONS, CONFEDERATION_LABEL, type IntlRankings as Rankings } from '../../lib/intl';
import { DataTable, type Column } from '../../components/DataTable';
import { Credits, nationHref } from '../../components/intl/NationHistory';
import { ErrorBox, Field, PageHeader, Select, TeamLogo } from '../../components/primitives';
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
    { key: 'change', label: '1 year', title: 'Change over the last year', num: true, value: (r) => r.change_1y, render: (r) => (r.change_1y == null ? '–' : <span className={r.change_1y > 0 ? 'text-win' : r.change_1y < 0 ? 'text-loss' : ''}>{r.change_1y > 0 ? '+' : ''}{r.change_1y}</span>) },
    { key: 'best', label: 'Best', title: 'Highest rating ever', num: true, priority: 2, value: (r) => r.best, render: (r) => `${r.best} (${r.best_date.slice(0, 4)})` },
    { key: 'matches', label: 'Matches', num: true, priority: 3, value: (r) => r.matches },
    { key: 'last', label: 'Last match', priority: 3, value: (r) => r.last_match, render: (r) => fmt.date(r.last_match) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title={`${gender === 'w' ? "Women's" : "Men's"} national team rankings`} meta={q.data?.updated_at ? `Plaibook Elo, updated ${fmt.date(q.data.updated_at)}` : 'Plaibook Elo'}>
        <Field label="Confederation">{(id) => <Select id={id} value={conf} onChange={setConf} options={[{ value: '', label: 'Every confederation' }, ...CONFEDERATIONS.filter((c) => c !== 'FIFA').map((c) => ({ value: c, label: CONFEDERATION_LABEL[c] ?? c }))]} />}</Field>
      </PageHeader>
      <p className="max-w-3xl text-xs text-chalk-400">Plaibook Elo is our own rating, worked out from every international result since 1872 with the World Football Elo method: a win against a strong side is worth more, a World Cup match more than a friendly, a big win more than a narrow one, and home advantage counts. It is not FIFA's ranking. Sides that have not played in four years are left out.{gender === 'w' ? " Women's ratings use the results our sources have, which are thinner before 2010." : ''}</p>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.nation.key} caption="Plaibook Elo rankings" rowHref={(r) => nationHref(r.nation)} loading={q.isPending} dense
        empty={<p className="p-4 text-sm text-chalk-400">Ratings appear after the first results sync.</p>} />
      {q.data?.credit && <Credits credits={[q.data.credit, { name: 'international_results (Mart Jürisoo)', url: 'https://github.com/martj42/international_results', license: 'public domain (CC0)' }]} />}
    </div>
  );
}
