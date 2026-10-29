// Builds data/first-names.json: the first names of the players we hold (college rosters, and the pro players we show),
// lower-case ASCII, used by at least 15 of them (fewer is mostly first and last swapped: "Smith" 10, "Stanford" 3, while
// "Kent" has 15 and "Charlotte" 238). News linking reads "from Charlotte Hansen" as a person, not the
// Charlotte 49ers, only when "Charlotte" is a first name (so "the visiting Stanford Cardinal" stays a team).
// Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/build-first-names.mjs   (the Stats database)
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const counts = new Map();
async function read(table, apply) {
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select('id,first_name').order('id').range(from, from + 999);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data) { const f = fold(String(r.first_name ?? '').split(/[\s-]+/)[0]); if (f.length >= 2) counts.set(f, (counts.get(f) ?? 0) + 1); }
    if (data.length < 1000) return;
  }
}
await read('college_players');
await read('pro_players', (q) => q.or('indexable.eq.true,american.eq.true,minutes_recent.gt.0'));
const names = [...counts].filter(([, n]) => n >= 15).map(([f]) => f).sort();
writeFileSync('data/first-names.json', `${JSON.stringify(names)}\n`);
console.log('first names', names.length);
