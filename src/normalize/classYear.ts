export interface ClassYear { year: number | null; redshirt: boolean; grad: boolean; raw: string | null }

/** "Fr.", "R-So.", "Gr.", "5th", "Graduate Student", "Junior" → structured. */
export function parseClassYear(raw: string | null | undefined): ClassYear {
  const r = (raw ?? '').trim();
  if (!r) return { year: null, redshirt: false, grad: false, raw: null };
  const s = r.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  const redshirt = /^(r-|rs-|rs |r |redshirt)/.test(s) || /redshirt/.test(s);
  const core = s.replace(/^(r-|rs-|rs |r |redshirt )/, '').trim();
  let year: number | null = null;
  let grad = false;
  // Some PrestoSports rosters print the year in school as a bare digit (1-5).
  if (/^[1-5]$/.test(core)) { year = Number(core); return { year, redshirt, grad: year === 5, raw: r }; }
  if (/^(fr|freshman|first-year|first year|1st)/.test(core)) year = 1;
  else if (/^(so|sophomore|2nd)/.test(core)) year = 2;
  else if (/^(jr|junior|3rd)/.test(core)) year = 3;
  else if (/^(sr|senior|4th)/.test(core)) year = 4;
  else if (/^(5th|fifth)/.test(core)) { year = 5; }
  else if (/^(6th|sixth)/.test(core)) { year = 6; }
  if (/^(gr|grad|graduate|g$)/.test(core) || /graduate/.test(core)) { grad = true; year = year ?? 5; }
  return { year, redshirt, grad, raw: r };
}
