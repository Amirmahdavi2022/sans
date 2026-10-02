// Probe on a GitHub runner: can Sans find free, legal, region-free copies of a
// film on the Internet Archive, and do Persian subtitle search links resolve?
// Nothing here ships; it only tells us which lookup actually works.
const KEY = process.env.TMDB_KEY;
const tmdb = async (p, q = {}) => {
  const u = new URL('https://api.themoviedb.org/3' + p);
  u.searchParams.set('api_key', KEY);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return (await fetch(u)).json();
};
const ia = async (q, rows = 5) => {
  const u = new URL('https://archive.org/advancedsearch.php');
  u.searchParams.set('q', q);
  for (const f of ['identifier', 'title', 'year', 'downloads', 'external-identifier', 'runtime']) u.searchParams.append('fl[]', f);
  u.searchParams.append('sort[]', 'downloads desc');
  u.searchParams.set('rows', String(rows));
  u.searchParams.set('output', 'json');
  const r = await fetch(u);
  if (!r.ok) return { error: r.status };
  return (await r.json()).response;
};
const files = async (id) => {
  const r = await fetch(`https://archive.org/metadata/${id}`);
  if (!r.ok) return { error: r.status };
  const d = await r.json();
  const vids = (d.files || []).filter((f) => /\.(mp4|ogv|webm)$/i.test(f.name));
  return { n: vids.length, sample: vids.slice(0, 3).map((f) => `${f.name} ${f.size || '?'}B ${f.format}`), rights: d.metadata && (d.metadata.licenseurl || d.metadata.rights || '') };
};
const clean = (s) => s.replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

// Known public-domain films, with TMDB ids.
const KNOWN = [
  [10331, 'Night of the Living Dead 1968'],
  [961, 'The General 1926'],
  [653, 'Nosferatu 1922'],
  [234, 'The Cabinet of Dr. Caligari 1920'],
  [1585, "It's a Wonderful Life 1946"],
  [3078, 'His Girl Friday 1940'],
  [11645, 'Charade 1963'],
  [21451, 'Plan 9 from Outer Space'],
];

async function match(type, id) {
  const d = await tmdb(`/${type}/${id}`, { append_to_response: 'external_ids' });
  const title = d.title || d.name;
  const orig = d.original_title || d.original_name;
  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const imdb = (d.external_ids && d.external_ids.imdb_id) || d.imdb_id;
  const out = { title, year, imdb };
  out.byImdb = imdb ? await ia(`external-identifier:"urn:imdb:${imdb}"`) : null;
  out.byTitle = await ia(`collection:(feature_films OR moviesandfilms OR silent_films OR classic_tv) AND title:(${clean(title)}) AND year:[${+year - 1} TO ${+year + 1}]`);
  if (orig && orig !== title) out.byOrig = await ia(`mediatype:movies AND title:(${clean(orig)}) AND year:[${+year - 1} TO ${+year + 1}]`);
  return out;
}

const show = (label, r) => {
  if (!r) return console.log(`  ${label}: -`);
  if (r.error) return console.log(`  ${label}: HTTP ${r.error}`);
  console.log(`  ${label}: ${r.numFound} found`);
  for (const x of r.docs || []) console.log(`    ${x.identifier} | ${x.title} | ${x.year} | dl ${x.downloads} | ${[].concat(x['external-identifier'] || []).join(',')}`);
};

console.log('== known public-domain films ==');
for (const [id, label] of KNOWN) {
  const m = await match('movie', id);
  console.log(`\n${label} -> tmdb "${m.title}" ${m.year} ${m.imdb}`);
  show('by imdb', m.byImdb);
  show('by title+year', m.byTitle);
  if (m.byOrig) show('by original title', m.byOrig);
  const top = (m.byImdb && m.byImdb.docs && m.byImdb.docs[0]) || (m.byTitle && m.byTitle.docs && m.byTitle.docs[0]);
  if (top) console.log('  files:', JSON.stringify(await files(top.identifier)));
}

console.log('\n== false-positive check: popular modern films (should be 0) ==');
const pop = await tmdb('/movie/popular', { region: 'US' });
let fp = 0;
for (const x of (pop.results || []).slice(0, 12)) {
  const m = await match('movie', x.id);
  const n = (m.byImdb && m.byImdb.numFound) || 0;
  const t = (m.byTitle && m.byTitle.numFound) || 0;
  if (n || t) fp++;
  console.log(`${m.title} ${m.year}: imdb ${n}, title ${t}${t ? ' -> ' + m.byTitle.docs.map((d) => d.identifier).join(',') : ''}`);
}
console.log(`popular with any hit: ${fp}/12`);

console.log('\n== coverage: TMDB top-rated pre-1960 films ==');
const old = await tmdb('/discover/movie', { 'primary_release_date.lte': '1959-12-31', sort_by: 'vote_count.desc' });
let hit = 0;
for (const x of (old.results || []).slice(0, 20)) {
  const m = await match('movie', x.id);
  const n = (m.byImdb && m.byImdb.numFound) || 0;
  const t = (m.byTitle && m.byTitle.numFound) || 0;
  if (n || t) hit++;
  console.log(`${m.title} ${m.year}: imdb ${n}, title ${t}${n ? ' -> ' + m.byImdb.docs[0].identifier : t ? ' -> ' + m.byTitle.docs[0].identifier : ''}`);
}
console.log(`old films with a hit: ${hit}/20`);

console.log('\n== Persian subtitle links ==');
for (const u of [
  'https://www.opensubtitles.org/en/search/sublanguageid-per/imdbid-0063350',
  'https://subdl.com/search/night%20of%20the%20living%20dead',
  'https://api.subdl.com/api/v1/subtitles?imdb_id=tt0063350&languages=FA',
  'https://www.subtitlecat.com/index.php?search=night+of+the+living+dead',
]) {
  try {
    const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0' } });
    const body = r.status < 300 ? (await r.text()) : '';
    console.log(`${r.status} ${u} ${r.headers.get('location') || ''} len ${body.length} persian-mention ${/persian|farsi|فارسی/i.test(body)}`);
  } catch (e) {
    console.log(`ERR ${u} ${e.message}`);
  }
}
