// Men's or women's, and which division: every module below follows this switch (kept in the URL).
import { useFilters, divisionLabel, genderLabel } from '../../lib/filters';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { SegmentedControl } from '../../components/primitives';
import type { Scope } from './Panel';

export function useScope(): Scope {
  const f = useFilters();
  const [division] = useUrlState('division', 'd1', { allow: ['d1', 'd2', 'd3'] });
  return { season: f.season, gender: f.gender, division: division as Scope['division'] };
}

export function ScopeBar() {
  const s = useScope();
  const patch = useUrlPatch();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <SegmentedControl label="Men's or women's" value={s.gender} onChange={(v) => patch({ gender: v === 'm' ? null : v }, { replace: true })} options={[{ value: 'm', label: "Men's" }, { value: 'w', label: "Women's" }]} />
      <SegmentedControl label="Division" value={s.division} onChange={(v) => patch({ division: v === 'd1' ? null : v }, { replace: true })} options={[{ value: 'd1', label: 'Division I' }, { value: 'd2', label: 'Division II' }, { value: 'd3', label: 'Division III' }]} />
      <p className="text-sm text-chalk-400">Showing <span className="text-chalk-200">{divisionLabel(s.division)} {genderLabel(s.gender)}</span> soccer, {s.season}.</p>
    </div>
  );
}
