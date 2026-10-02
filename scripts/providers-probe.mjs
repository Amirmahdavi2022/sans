// One-off probe, run on a GitHub runner: which free/ad-supported services TMDB
// lists, in which regions, and whether each service's search link really loads.
const KEY = process.env.TMDB_KEY;
const api = async (p, q = {}) => {
  const u = new URL('https://api.themoviedb.org/3' + p);
  u.searchParams.set('api_key', KEY);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  const r = await fetch(u);
  return r.json();
};

const regions = ['US', 'CA', 'GB', 'AU', 'DE', 'NL', 'TR'];
for (const type of ['movie', 'tv']) {
  const free = new Map();
  for (const region of regions) {
    // Providers that have at least one free/ads title get counted from a sample.
    const d = await api(`/discover/${type}`, { watch_region: region, with_watch_monetization_types: 'free|ads', sort_by: 'popularity.desc' });
    console.log(`${type} ${region}: free/ads titles total ${d.total_results}`);
    for (const x of (d.results || []).slice(0, 12)) {
      const w = await api(`/${type}/${x.id}/watch/providers`);
      const rr = (w.results || {})[region] || {};
      for (const k of ['free', 'ads']) for (const p of rr[k] || []) {
        const key = p.provider_id;
        const e = free.get(key) || { name: p.provider_name, logo: p.logo_path, regions: new Set(), kinds: new Set(), n: 0 };
        e.regions.add(region); e.kinds.add(k); e.n++;
        free.set(key, e);
      }
    }
  }
  console.log(`\n== ${type}: free/ads providers seen ==`);
  [...free.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([id, e]) => console.log(`${id}\t${e.name}\t${[...e.kinds]}\t${[...e.regions]}\tseen ${e.n}\tlogo ${e.logo}`));
}

// Sample: a famous public-domain film and a recent hit.
for (const [t, id] of [['movie', 10331], ['movie', 157336], ['tv', 1399]]) {
  const w = await api(`/${t}/${id}/watch/providers`);
  const us = (w.results || {}).US || {};
  console.log(`\n${t}/${id} US link=${us.link}`);
  for (const k of ['free', 'ads', 'flatrate', 'rent', 'buy']) console.log(`  ${k}: ${(us[k] || []).map((p) => `${p.provider_id}:${p.provider_name}`).join(', ')}`);
}

// Do the search pages we'd link to actually exist?
const q = 'Night of the Living Dead';
const links = {
  tubi: `https://tubitv.com/search/${encodeURIComponent(q)}`,
  pluto: `https://pluto.tv/us/search/details?query=${encodeURIComponent(q)}`,
  plex: `https://watch.plex.tv/search?q=${encodeURIComponent(q)}`,
  roku: `https://therokuchannel.roku.com/search/${encodeURIComponent(q)}`,
  youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' full movie')}`,
  crackle: `https://www.crackle.com/search?query=${encodeURIComponent(q)}`,
  justwatch: `https://www.justwatch.com/us/search?q=${encodeURIComponent(q)}`,
};
console.log('\n== search links ==');
for (const [n, u] of Object.entries(links)) {
  try {
    const r = await fetch(u, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36' } });
    const body = await r.text();
    console.log(`${n}\t${r.status}\t${r.url}\tlen ${body.length}\tmentions title: ${body.toLowerCase().includes('living dead')}`);
  } catch (e) { console.log(`${n}\tERR ${e.message}`); }
}
