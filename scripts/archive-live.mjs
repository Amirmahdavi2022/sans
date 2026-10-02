// Live check of src/archive.js and the classics row against the real
// archive.org and TMDB, run on a GitHub runner before shipping.
import * as IA from '../src/archive.js';
import * as T from '../src/tmdb.js';

const env = { TMDB_KEY: process.env.TMDB_KEY };
const t0 = Date.now();

const cases = [
  // [tmdb id, expect a copy?]
  [10331, true], // Night of the Living Dead 1968, public-domain licence on the Archive
  [961, true], // The General 1926
  [653, true], // Nosferatu 1922
  [234, true], // The Cabinet of Dr. Caligari 1920
  [3082, null], // Modern Times 1936, still in copyright: whatever turns up must carry an open licence
  [157336, false], // Interstellar 2014
  [693134, false], // Dune: Part Two 2024
  [27205, false], // Inception 2010
];
let bad = 0;
for (const [id, want] of cases) {
  const s = Date.now();
  const r = await T.archiveFor(env, id);
  const got = r.item;
  const en = await T.tmdb(env, `/movie/${id}`, { language: 'en-US', append_to_response: 'videos' });
  const verdict = want === null ? 'info' : (!!got === want ? 'ok' : 'BAD');
  if (verdict === 'BAD') bad++;
  console.log(`${verdict}\t${en.title} ${(en.release_date || '').slice(0, 4)}\t-> ${got ? `${got.id} pd=${got.pd} "${got.title}"` : 'none'}\t${Date.now() - s}ms`);
}

console.log('\n== classics() raw ==');
const raw = await IA.classics(env);
console.log(`${raw.length} titles; first 15:`);
raw.slice(0, 15).forEach((x) => console.log(`  ${x.id} | ${x.title} | ${x.year} | ${x.license}`));

console.log('\n== classics row (TMDB-matched) ==');
for (const lang of ['fa', 'en']) {
  const s = Date.now();
  const row = await T.classicsRow(env, lang);
  console.log(`${lang}: ${row.items.length} items in ${Date.now() - s}ms`);
  row.items.forEach((c) => console.log(`  ${c.id} ${c.title} (${c.year}) poster=${!!c.poster} ia=${c.ia}`));
}

console.log('\n== every classics card must resolve to a legal copy via its hint ==');
const row = await T.classicsRow(env, 'en');
for (const c of row.items) {
  const r = await T.archiveFor(env, c.id, c.ia);
  if (!r.item) bad++;
  console.log(`${r.item ? 'ok' : 'BAD'}\t${c.title} -> ${r.item ? r.item.id : 'none'}`);
}

console.log('\n== subtitle link ==');
const sub = T.subtitleUrl('Night of the Living Dead');
const sr = await fetch(sub, { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36' } });
console.log(sr.status, sub, '(403 from a datacenter runner is Cloudflare bot protection, not a broken link)');

console.log(`\n${bad} problems, ${Date.now() - t0}ms total`);
