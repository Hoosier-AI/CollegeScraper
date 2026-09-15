#!/usr/bin/env node
// Read-only probe: for every conference in data/conference-sites.json, fetch
// https://{host}/standings.aspx?path=msoc and ?path=wsoc and report whether a Sidearm standings table
// with W-L rows is served. Prints one line per conference/gender; pass --write to update the JSON
// (platform, standings_path_m/w) from the results. Polite: one request per host at a time, ~1 rps.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.cwd(), 'data/conference-sites.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));
const write = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 PlaibookCollege/1.0 (+https://plaibook.soccer)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(host, path) {
  try {
    const res = await fetch(`https://${host}${path}`, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const html = await res.text();
    const table = /<table[^>]*sidearm-standings-table/i.test(html);
    const rows = (html.match(/\b\d+-\d+(?:-\d+)?\b/g) ?? []).length;
    return { status: res.status, table, rows, host: new URL(res.url).host.replace(/^www\./, '') };
  } catch (err) { return { status: 0, table: false, rows: 0, error: String(err.message ?? err) }; }
}

for (const c of doc.conferences) {
  if (!c.host) { console.log(`${c.ncaa_seo}: no host`); continue; }
  for (const g of ['m', 'w']) {
    const key = `standings_path_${g}`;
    if (c[key] === null) { console.log(`${c.ncaa_seo} ${g}: skipped (null path)`); continue; }
    const path = c[key] ?? `/standings.aspx?path=${g === 'w' ? 'wsoc' : 'msoc'}`;
    const r = await probe(c.host, path);
    console.log(`${c.ncaa_seo} ${g}: ${r.status} table=${r.table} rows=${r.rows}${r.host && r.host !== c.host ? ` (→ ${r.host})` : ''}${r.error ? ' ' + r.error : ''}`);
    if (write) {
      if (r.table && r.rows > 3) { c.platform = 'sidearm'; if (r.host && r.host !== c.host) c.host = r.host; delete c[key]; }
      else if (c.platform === 'sidearm' && !c.notes) { c[key] = null; c.notes = `${g}: ${r.status} no standings table`; }
    }
    await sleep(1100);
  }
}
if (write) { writeFileSync(file, JSON.stringify(doc, null, 2) + '\n'); console.log('updated', file); }
